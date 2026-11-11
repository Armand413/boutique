import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import type { BackupPreview } from '@shared/schemas/backup';
import { integrityProblems, openDatabase } from '../db/connection';
import { bundledMigrations } from '../db/migrations';
import { decodeBackup, readBackupHeader, type BackupHeader } from './backup-format';
import { deriveBackupKey } from './backup-secret';

const TOKEN_TTL_MS = 15 * 60_000;

/** Fichiers choisis pour une restauration : l'interface ne manipule qu'un jeton, jamais un chemin. */
export class RestoreTokens {
  private readonly tokens = new Map<string, { path: string; expires: number }>();

  issue(path: string): string {
    const token = randomBytes(16).toString('hex');
    this.tokens.set(token, { path, expires: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  take(token: string): string {
    const entry = this.tokens.get(token);
    this.tokens.delete(token);
    if (entry === undefined || entry.expires < Date.now()) {
      throw new AppError('NOT_FOUND', 'Choisissez de nouveau le fichier de sauvegarde.');
    }
    return entry.path;
  }
}

function latestSchemaVersion(): number {
  return Math.max(...bundledMigrations().map((migration) => migration.version));
}

/** Aperçu d'un fichier choisi (en-tête lisible sans mot de passe). */
export function previewBackup(path: string, token: string): BackupPreview {
  const header = readBackupHeader(readFileSync(path));
  return {
    token,
    fileName: basename(path),
    kind: header.kind,
    createdAt: header.createdAt,
    shopName: header.shopName,
    appVersion: header.appVersion,
    compatible: header.schemaVersion <= latestSchemaVersion(),
  };
}

export interface PreparedRestore {
  header: BackupHeader;
  /** Base déchiffrée, vérifiée, écrite à côté de la base courante. */
  temporaryFile: string;
  databaseKey: Buffer;
  escrow: string | null;
  wrappingKey: Buffer;
}

/**
 * Prépare une restauration sans toucher à la base courante : mot de passe, étiquette GCM,
 * empreinte, version du schéma, puis ouverture et `integrity_check` de la copie (B.3, B.8).
 */
export async function prepareRestore(
  path: string,
  password: string,
  dataDirectory: string,
): Promise<PreparedRestore> {
  const file = readFileSync(path);
  const header = readBackupHeader(file);
  if (header.schemaVersion > latestSchemaVersion()) {
    throw new AppError(
      'CONFLICT',
      'Cette sauvegarde vient d’une version plus récente de l’application : mettez-la à jour d’abord.',
    );
  }
  const wrappingKey = await deriveBackupKey(password, header.kdf);
  const content = decodeBackup(file, wrappingKey);
  const temporaryFile = join(dataDirectory, `restauration-${randomBytes(6).toString('hex')}.db`);
  writeFileSync(temporaryFile, content.database, { mode: 0o600 });
  try {
    const db = openDatabase(temporaryFile, content.databaseKey);
    const problems = integrityProblems(db);
    db.close();
    if (problems.length > 0)
      throw new AppError(
        'VALIDATION_ERROR',
        'La base contenue dans cette sauvegarde est endommagée.',
      );
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    for (const suffix of ['-wal', '-shm']) rmSync(`${temporaryFile}${suffix}`, { force: true });
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', 'La base contenue dans cette sauvegarde est illisible.');
  }
  for (const suffix of ['-wal', '-shm']) rmSync(`${temporaryFile}${suffix}`, { force: true });
  return {
    header,
    temporaryFile,
    databaseKey: content.databaseKey,
    escrow: content.escrow,
    wrappingKey,
  };
}
