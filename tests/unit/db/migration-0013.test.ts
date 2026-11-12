import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, migrate } from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import {
  createTestDatabase,
  insertUser,
  insertVariant,
  move,
  stockOf,
  type TestDatabase,
} from './helpers';

let test: TestDatabase | null = null;

afterEach(() => {
  test?.cleanup();
  test = null;
});

const IMEI = '490154203237518';

/** Base au niveau 12 avec un téléphone suivi par IMEI déjà mouvementé, puis passage à la 0013. */
function upgradedDatabase() {
  test = createTestDatabase({ migrateAndSeed: false });
  const { db } = test;
  migrate(db, bundledMigrations().slice(0, 12));
  seedSystem(db);
  const userId = insertUser(db);
  const { productId, variantId } = insertVariant(db, { type: 'phone', tracking: 'imei' });
  const unitId = Number(
    db
      .prepare('INSERT INTO serial_units (variant_id, serial_number) VALUES (?, ?)')
      .run(variantId, IMEI).lastInsertRowid,
  );
  move(db, { variantId, delta: 1, userId, serialUnitId: unitId });
  const applied = migrate(db, bundledMigrations());
  return { db, applied, productId, variantId, userId };
}

describe('migration 0013 : plus de suivi unitaire', () => {
  it('conserve les produits, variantes et mouvements, et passe tout sans suivi', () => {
    const { db, applied, productId, variantId } = upgradedDatabase();
    expect(applied.map((migration) => migration.version)).toEqual([13]);
    expect(
      db.prepare('SELECT product_type, tracking_mode FROM products WHERE id = ?').get(productId),
    ).toEqual({ product_type: 'phone', tracking_mode: 'none' });
    expect(
      db
        .prepare("SELECT count(*) FROM categories WHERE default_tracking_mode <> 'none'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(stockOf(db, variantId)).toBe(1);
    expect(db.prepare('SELECT count(*) FROM serial_units').pluck().get()).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('vend un téléphone par quantité et garde les règles des produits', () => {
    const { db, productId, variantId, userId } = upgradedDatabase();
    move(db, { variantId, delta: 3, userId });
    move(db, { variantId, delta: -2, userId });
    expect(stockOf(db, variantId)).toBe(2);
    expect(() =>
      db.prepare("UPDATE products SET tracking_mode = 'imei' WHERE id = ?").run(productId),
    ).toThrow(/PRODUCT_TYPE_LOCKED/);
    expect(() => db.prepare('DELETE FROM products WHERE id = ?').run(productId)).toThrow(
      /NO_DELETE/,
    );
    const { productId: fresh } = insertVariant(db, { type: 'phone', tracking: 'none' });
    expect(db.prepare('SELECT tracking_mode FROM products WHERE id = ?').pluck().get(fresh)).toBe(
      'none',
    );
  });
});
