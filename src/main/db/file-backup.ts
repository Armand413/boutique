import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Db } from './types';

export interface FileBackup {
  path: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Copie du fichier de base, déjà chiffré sur le disque : la copie reste chiffrée avec la même clé.
 * Le journal WAL est d'abord reversé dans le fichier pour que la copie soit complète.
 * Utilisée avant une migration (E.7) ; les sauvegardes complètes viennent en phase 8.
 */
export function copyDatabaseFile(db: Db, destinationDir: string, reason: string): FileBackup {
  db.pragma('wal_checkpoint(TRUNCATE)');
  mkdirSync(destinationDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(destinationDir, `${basename(db.name, '.db')}-${reason}-${stamp}.db`);
  copyFileSync(db.name, path);
  const content = readFileSync(path);
  return {
    path,
    sizeBytes: statSync(path).size,
    checksum: createHash('sha256').update(content).digest('hex'),
  };
}
