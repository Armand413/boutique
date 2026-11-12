import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, migrate } from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import { createTestDatabase, insertUser, insertVariant, type TestDatabase } from './helpers';

let test: TestDatabase | null = null;

afterEach(() => {
  test?.cleanup();
  test = null;
});

const NOW = '2026-11-12T08:00:00.000Z';

/** Base au niveau 11 avec une entrée validée, ses lignes et un paiement, puis passage à la 0012. */
function upgradedDatabase() {
  test = createTestDatabase({ migrateAndSeed: false });
  const { db } = test;
  migrate(db, bundledMigrations().slice(0, 11));
  seedSystem(db);
  const userId = insertUser(db);
  const { variantId } = insertVariant(db);
  const location = db.prepare('SELECT id FROM stock_locations LIMIT 1').pluck().get() as number;
  const supplierId = Number(
    db.prepare("INSERT INTO suppliers (name) VALUES ('Grossiste Adjamé')").run().lastInsertRowid,
  );
  const receiptId = Number(
    db
      .prepare(
        `INSERT INTO goods_receipts (number, supplier_id, location_id, received_at, status, user_id)
         VALUES ('BR-2026-00001', ?, ?, ?, 'draft', ?)`,
      )
      .run(supplierId, location, NOW, userId).lastInsertRowid,
  );
  db.prepare(
    'INSERT INTO goods_receipt_lines (receipt_id, variant_id, quantity, unit_cost) VALUES (?, ?, 2, 1500)',
  ).run(receiptId, variantId);
  db.prepare(
    "UPDATE goods_receipts SET total_cost = 3000, status = 'validated', validated_at = ? WHERE id = ?",
  ).run(NOW, receiptId);
  db.prepare(
    `INSERT INTO supplier_payments (supplier_id, receipt_id, amount, method, paid_at, user_id)
     VALUES (?, ?, 1000, 'cash', ?, ?)`,
  ).run(supplierId, receiptId, NOW, userId);
  const applied = migrate(db, bundledMigrations().slice(0, 12));
  return { db, applied, receiptId, variantId, location, userId };
}

describe('migration 0012 : entrée de marchandise sans fournisseur', () => {
  it('conserve les entrées, leurs lignes et les paiements qui les référencent', () => {
    const { db, applied, receiptId } = upgradedDatabase();
    expect(applied.map((migration) => migration.version)).toEqual([12]);
    expect(
      db
        .prepare('SELECT number, total_cost, status FROM goods_receipts WHERE id = ?')
        .get(receiptId),
    ).toEqual({ number: 'BR-2026-00001', total_cost: 3000, status: 'validated' });
    expect(db.prepare('SELECT count(*) FROM goods_receipt_lines').pluck().get()).toBe(1);
    expect(
      db
        .prepare('SELECT count(*) FROM supplier_payments WHERE receipt_id = ?')
        .pluck()
        .get(receiptId),
    ).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('accepte une entrée sans fournisseur et garde les règles des entrées', () => {
    const { db, receiptId, location, userId, variantId } = upgradedDatabase();
    expect(() =>
      db.prepare("UPDATE goods_receipts SET notes = 'x' WHERE id = ?").run(receiptId),
    ).toThrow(/RECEIPT_LOCKED/);
    expect(() => db.prepare('DELETE FROM goods_receipts WHERE id = ?').run(receiptId)).toThrow(
      /NO_DELETE/,
    );
    const free = Number(
      db
        .prepare(
          `INSERT INTO goods_receipts (number, supplier_id, location_id, received_at, status, user_id)
           VALUES ('BR-2026-00002', NULL, ?, ?, 'draft', ?)`,
        )
        .run(location, NOW, userId).lastInsertRowid,
    );
    expect(() =>
      db
        .prepare(
          "UPDATE goods_receipts SET total_cost = 0, status = 'validated', validated_at = ? WHERE id = ?",
        )
        .run(NOW, free),
    ).toThrow(/RECEIPT_EMPTY/);
    db.prepare(
      'INSERT INTO goods_receipt_lines (receipt_id, variant_id, quantity, unit_cost) VALUES (?, ?, 1, 500)',
    ).run(free, variantId);
    db.prepare(
      "UPDATE goods_receipts SET total_cost = 500, status = 'validated', validated_at = ? WHERE id = ?",
    ).run(NOW, free);
    expect(
      db.prepare('SELECT supplier_id FROM goods_receipts WHERE id = ?').pluck().get(free),
    ).toBe(null);
  });
});
