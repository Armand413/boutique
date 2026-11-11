import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WrongKeyError, integrityProblems, openDatabase } from '../../../src/main/db/connection';
import {
  MigrationError,
  bundledMigrations,
  migrate,
  parseMigrations,
} from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import { ROLE_PERMISSIONS, ROLES } from '@shared/permissions';
import { createTestDatabase, type TestDatabase } from './helpers';

let test: TestDatabase | undefined;

afterEach(() => {
  test?.cleanup();
  test = undefined;
});

describe('base chiffrée', () => {
  it('est illisible sans la clé et refuse une mauvaise clé', () => {
    test = createTestDatabase();
    test.db.pragma('wal_checkpoint(TRUNCATE)');
    const raw = readFileSync(test.file);
    expect(raw.subarray(0, 16).toString('latin1')).not.toContain('SQLite format 3');
    expect(raw.includes(Buffer.from('Téléphonie'))).toBe(false);
    test.db.close();
    expect(() => openDatabase(test?.file ?? '', Buffer.alloc(32, 7))).toThrow(WrongKeyError);
  });

  it('applique les réglages imposés à chaque ouverture (E.1)', () => {
    test = createTestDatabase();
    const db = test.reopen();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('cipher', { simple: true })).toBe('sqlcipher');
  });

  it('refuse une clé de mauvaise taille', () => {
    expect(() => openDatabase(':memory:', Buffer.alloc(16))).toThrow();
  });
});

describe('migrations', () => {
  it('s’appliquent sur une base vide, sans anomalie, puis ne se rejouent pas', () => {
    test = createTestDatabase({ migrateAndSeed: false });
    const applied = migrate(test.db, bundledMigrations());
    expect(applied.map((m) => m.version)).toEqual(bundledMigrations().map((m) => m.version));
    expect(migrate(test.db, bundledMigrations())).toEqual([]);
    expect(integrityProblems(test.db)).toEqual([]);
    expect(test.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('déclare toutes les tables en STRICT (E.1)', () => {
    test = createTestDatabase();
    const tables = test.db
      .prepare<[], { name: string; strict: number }>(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table'",
      )
      .all()
      .filter((t) => !t.name.startsWith('sqlite_') && !t.name.startsWith('products_fts'));
    // 39 tables métier de l'Annexe E + inventory_unit_scans (migration 0009) + schema_migrations.
    expect(tables).toHaveLength(41);
    expect(tables.filter((t) => t.strict !== 1).map((t) => t.name)).toEqual([]);
  });

  it('détecte une migration modifiée après application', () => {
    test = createTestDatabase();
    const tampered = bundledMigrations().map((m, i) =>
      i === 0 ? { ...m, checksum: 'f'.repeat(64) } : m,
    );
    expect(() => migrate(test?.db as never, tampered)).toThrow(MigrationError);
  });

  it('refuse une base plus récente que l’application', () => {
    test = createTestDatabase();
    expect(() => migrate(test?.db as never, bundledMigrations().slice(0, 2))).toThrow(
      /plus ancienne/,
    );
  });

  it('sauvegarde une base existante avant de la migrer', () => {
    test = createTestDatabase({ migrateAndSeed: false });
    const all = bundledMigrations();
    migrate(test.db, all.slice(0, 3));
    const backups: number[] = [];
    migrate(test.db, all, { backupBeforeMigrating: (pending) => backups.push(pending.length) });
    expect(backups).toEqual([all.length - 3]);
  });

  it('annule entièrement une migration qui échoue', () => {
    test = createTestDatabase();
    const current = bundledMigrations();
    const broken = [
      ...current,
      {
        version: current.length + 1,
        name: 'casse',
        sql: 'CREATE TABLE t1 (a INTEGER) STRICT; INSERT INTO inconnue VALUES (1);',
        checksum: 'a'.repeat(64),
      },
    ];
    expect(() => migrate(test?.db as never, broken)).toThrow();
    expect(
      test.db.prepare("SELECT count(*) FROM sqlite_schema WHERE name = 't1'").pluck().get(),
    ).toBe(0);
    expect(test.db.prepare('SELECT max(version) FROM schema_migrations').pluck().get()).toBe(
      current.length,
    );
  });

  it('refuse des fichiers mal numérotés', () => {
    expect(() => parseMigrations({ '0001_a.sql': '', '0003_b.sql': '' })).toThrow(MigrationError);
    expect(() => parseMigrations({ 'init.sql': '' })).toThrow(MigrationError);
  });

  it('protège le registre des migrations', () => {
    test = createTestDatabase();
    expect(() => test?.db.exec('DELETE FROM schema_migrations')).toThrow(/IMMUTABLE/);
  });
});

describe('seed système', () => {
  it('reprend exactement les droits du référentiel partagé', () => {
    test = createTestDatabase();
    for (const role of ROLES) {
      const granted = test.db
        .prepare(
          `SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id WHERE r.code = ? ORDER BY p.code`,
        )
        .pluck()
        .all(role);
      expect(granted).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('crée les quatre familles, les taxes, l’emplacement et les paramètres, une seule fois', () => {
    test = createTestDatabase();
    seedSystem(test.db);
    seedSystem(test.db);
    const families = test.db
      .prepare('SELECT name FROM categories WHERE parent_id IS NULL ORDER BY sort_order')
      .pluck()
      .all();
    expect(families).toEqual([
      'Téléphonie',
      'Électronique et audio',
      'Électroménager',
      'Énergie solaire',
    ]);
    expect(
      test.db.prepare('SELECT count(*) FROM stock_locations WHERE is_default = 1').pluck().get(),
    ).toBe(1);
    expect(
      test.db.prepare("SELECT value FROM settings WHERE key = 'shop.currency'").pluck().get(),
    ).toBe('{"code":"XOF","symbol":"FCFA","decimals":0}');
    expect(test.db.prepare('SELECT count(*) FROM tax_rates').pluck().get()).toBe(2);
  });
});
