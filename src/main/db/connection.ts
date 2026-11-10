import Database from 'better-sqlite3-multiple-ciphers';
import { AppError } from '@shared/ipc/errors';
import { registerSqlFunctions } from './sql-functions';
import type { Db } from './types';

export const DATABASE_KEY_BYTES = 32;

export class WrongKeyError extends Error {
  constructor() {
    super('Clé de la base incorrecte ou fichier qui n’est pas une base de l’application.');
    this.name = 'WrongKeyError';
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== DATABASE_KEY_BYTES) {
    throw new AppError('INTERNAL_ERROR', 'Clé de chiffrement de la base invalide.');
  }
}

/**
 * Ouvre (ou crée) la base chiffrée SQLCipher v4 (AES-256) avec une clé brute de 256 bits,
 * puis applique les réglages imposés à chaque ouverture (E.1).
 * La clé n'apparaît que dans le PRAGMA, jamais dans un journal.
 */
export function openDatabase(file: string, key: Buffer): Db {
  assertKey(key);
  const db = new Database(file);
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key.toString('hex')}'"`);
    verifyKey(db);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    registerSqlFunctions(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function verifyKey(db: Db): void {
  try {
    db.prepare('SELECT count(*) FROM sqlite_schema').get();
  } catch (error) {
    if (error instanceof Database.SqliteError && error.code === 'SQLITE_NOTADB') {
      throw new WrongKeyError();
    }
    throw error;
  }
}

/** `PRAGMA integrity_check` : liste vide si la base est saine. */
export function integrityProblems(db: Db): string[] {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  return rows.map((row) => row.integrity_check).filter((message) => message !== 'ok');
}

export function foreignKeyProblems(db: Db): number {
  return (db.pragma('foreign_key_check') as unknown[]).length;
}

/** Fermeture propre : optimisation des statistiques puis point de contrôle du journal WAL. */
export function closeDatabase(db: Db): void {
  if (!db.open) return;
  db.pragma('optimize');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}
