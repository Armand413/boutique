import { createHash } from 'node:crypto';
import type { Db } from './types';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILE_NAME = /(?:^|[\\/])(\d{4})_([a-z0-9_]+)\.sql$/;

/** Migrations embarquées dans le build : aucune lecture de fichier à l'exécution. */
export function bundledMigrations(): Migration[] {
  const files = import.meta.glob<string>('../../../db/migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  return parseMigrations(files);
}

/** Valide et ordonne les migrations : numéros 0001, 0002... sans trou ni doublon. */
export function parseMigrations(files: Readonly<Record<string, string>>): Migration[] {
  const migrations = Object.entries(files).map(([path, content]) => {
    const match = FILE_NAME.exec(path);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new MigrationError(`Nom de migration invalide : ${path}`);
    }
    const sql = content.replace(/\r\n/g, '\n');
    return {
      version: Number(match[1]),
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    };
  });
  migrations.sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(`Migration manquante ou en double avant ${migration.name}.`);
    }
  });
  return migrations;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

function ensureMigrationTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS trg_schema_migrations_no_update BEFORE UPDATE ON schema_migrations
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: schema_migrations'); END;
    CREATE TRIGGER IF NOT EXISTS trg_schema_migrations_no_delete BEFORE DELETE ON schema_migrations
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: schema_migrations'); END;
  `);
}

/** Migrations déjà appliquées : chacune doit exister à l'identique dans le build. */
function checkApplied(applied: readonly AppliedRow[], migrations: readonly Migration[]): void {
  for (const row of applied) {
    const known = migrations.find((migration) => migration.version === row.version);
    if (known === undefined) {
      throw new MigrationError(
        `La base contient la migration ${row.version} (${row.name}) inconnue de cette version : ` +
          'l’application est plus ancienne que la base.',
      );
    }
    if (known.checksum !== row.checksum) {
      throw new MigrationError(
        `La migration ${row.version} (${row.name}) a été modifiée après son application.`,
      );
    }
  }
}

export interface MigrateOptions {
  /** Appelée une fois avant d'appliquer des migrations à une base existante. */
  backupBeforeMigrating?: (pending: readonly Migration[]) => void;
}

export function pendingMigrations(db: Db, migrations: readonly Migration[]): Migration[] {
  ensureMigrationTable(db);
  const applied = db
    .prepare<[], AppliedRow>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    )
    .all();
  checkApplied(applied, migrations);
  const last = applied.at(-1)?.version ?? 0;
  return migrations.filter((migration) => migration.version > last);
}

/** Applique les migrations en attente, chacune dans sa transaction (tout ou rien). */
export function migrate(
  db: Db,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Migration[] {
  const pending = pendingMigrations(db, migrations);
  if (pending.length === 0) return [];
  const isExistingDatabase = pending[0]?.version !== 1;
  if (isExistingDatabase) options.backupBeforeMigrating?.(pending);
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, migration.checksum, new Date().toISOString());
    })();
  }
  return pending;
}
