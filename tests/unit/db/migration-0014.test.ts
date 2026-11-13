import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, migrate } from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import { createTestDatabase, insertUser, insertVariant, type TestDatabase } from './helpers';

let test: TestDatabase | null = null;

afterEach(() => {
  test?.cleanup();
  test = null;
});

const NOW = '2026-11-13T08:00:00.000Z';

/** Base au niveau 13 avec un paiement fournisseur par chèque, puis passage à la 0014. */
function upgradedDatabase() {
  test = createTestDatabase({ migrateAndSeed: false });
  const { db } = test;
  migrate(db, bundledMigrations().slice(0, 13));
  seedSystem(db);
  const userId = insertUser(db);
  const { variantId } = insertVariant(db);
  const location = db.prepare('SELECT id FROM stock_locations LIMIT 1').pluck().get() as number;
  const supplierId = Number(
    db.prepare("INSERT INTO suppliers (name) VALUES ('Grossiste')").run().lastInsertRowid,
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
    'INSERT INTO goods_receipt_lines (receipt_id, variant_id, quantity, unit_cost) VALUES (?, ?, 1, 9000)',
  ).run(receiptId, variantId);
  db.prepare(
    "UPDATE goods_receipts SET total_cost = 9000, status = 'validated', validated_at = ? WHERE id = ?",
  ).run(NOW, receiptId);
  const pay = (method: string) =>
    db
      .prepare(
        `INSERT INTO supplier_payments (supplier_id, receipt_id, amount, method, paid_at, user_id)
         VALUES (?, ?, 1000, ?, ?, ?)`,
      )
      .run(supplierId, receiptId, method, NOW, userId);
  pay('cheque');
  const applied = migrate(db, bundledMigrations().slice(0, 14));
  return { db, applied, pay };
}

describe('migration 0014 : moyens de paiement de la boutique', () => {
  it('garde les paiements enregistrés avec un ancien moyen', () => {
    const { db, applied } = upgradedDatabase();
    expect(applied.map((migration) => migration.version)).toEqual([14]);
    expect(db.prepare('SELECT method FROM supplier_payments').pluck().all()).toEqual(['cheque']);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('accepte Orange, Moov, Telecel Money et Wave, refuse un moyen inconnu, reste immuable', () => {
    const { db, pay } = upgradedDatabase();
    for (const method of ['orange_money', 'moov_money', 'telecel_money', 'wave']) pay(method);
    expect(() => pay('bitcoin')).toThrow(/CHECK/);
    expect(() => db.prepare('DELETE FROM supplier_payments').run()).toThrow(/IMMUTABLE/);
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('v_cash_session_summary')")
      .pluck()
      .all();
    expect(columns).toEqual(
      expect.arrayContaining([
        'orange_money_in',
        'moov_money_in',
        'telecel_money_in',
        'wave_in',
        'other_in',
      ]),
    );
  });
});
