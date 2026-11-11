import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, migrate } from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import { createTestDatabase, insertUser, insertVariant, move, type TestDatabase } from './helpers';

let test: TestDatabase | null = null;

afterEach(() => {
  test?.cleanup();
  test = null;
});

const IMEI = '490154203237518';

/** Base au niveau 6 avec une unité suivie déjà mouvementée, puis passage à la migration 0007. */
function upgradedDatabase() {
  test = createTestDatabase({ migrateAndSeed: false });
  const { db } = test;
  migrate(db, bundledMigrations().slice(0, 6));
  seedSystem(db);
  const userId = insertUser(db);
  const { variantId } = insertVariant(db, { type: 'phone' });
  const unitId = Number(
    db
      .prepare('INSERT INTO serial_units (variant_id, serial_number) VALUES (?, ?)')
      .run(variantId, IMEI).lastInsertRowid,
  );
  move(db, { variantId, delta: 1, userId, serialUnitId: unitId });
  const applied = migrate(db, bundledMigrations());
  return { db, applied, unitId, variantId, userId };
}

describe('migration 0007 : états de sortie des unités suivies', () => {
  it('conserve les unités et les mouvements qui les référencent', () => {
    const { db, applied, unitId } = upgradedDatabase();
    expect(applied.map((m) => m.version)).toEqual([7]);
    expect(
      db.prepare('SELECT serial_number, status FROM serial_units WHERE id = ?').get(unitId),
    ).toEqual({
      serial_number: IMEI,
      status: 'in_stock',
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(
      db
        .prepare('SELECT count(*) FROM stock_movements WHERE serial_unit_id = ?')
        .pluck()
        .get(unitId),
    ).toBe(1);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('accepte les sorties hors vente et garde les règles de l’unité', () => {
    const { db, unitId, variantId } = upgradedDatabase();
    const setStatus = (status: string) =>
      db.prepare('UPDATE serial_units SET status = ? WHERE id = ?').run(status, unitId);
    setStatus('written_off');
    setStatus('in_stock');
    setStatus('supplier_returned');
    expect(() => setStatus('in_stock')).toThrow(/SERIAL_STATUS/);
    expect(() => db.prepare('DELETE FROM serial_units WHERE id = ?').run(unitId)).toThrow(
      /NO_DELETE/,
    );
    expect(() =>
      db
        .prepare('INSERT INTO serial_units (variant_id, serial_number) VALUES (?, ?)')
        .run(variantId, '123'),
    ).toThrow(/IMEI_INVALID/);
    expect(() =>
      db
        .prepare('UPDATE serial_units SET serial_number = ? WHERE id = ?')
        .run('356938035643809', unitId),
    ).toThrow(/SERIAL_LOCKED/);
  });
});
