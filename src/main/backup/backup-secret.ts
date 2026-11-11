import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { ARGON2_OPTIONS, deriveKey } from '../auth/hashing';
import type { KeyProtector } from '../db/keystore';
import { kdfSchema, type KdfInfo } from './backup-format';

const storedSchema = z.strictObject({
  version: z.literal(1),
  kdf: kdfSchema,
  key: z.base64(),
});

/** Paramètres de dérivation d'un mot de passe de sauvegarde (sel neuf à chaque changement). */
export function newKdf(): KdfInfo {
  return {
    algorithm: 'argon2id',
    memoryCost: ARGON2_OPTIONS.memoryCost ?? 65536,
    timeCost: ARGON2_OPTIONS.timeCost ?? 3,
    parallelism: ARGON2_OPTIONS.parallelism ?? 1,
    salt: randomBytes(16).toString('base64'),
  };
}

export function deriveBackupKey(password: string, kdf: KdfInfo): Promise<Buffer> {
  return deriveKey(password, Buffer.from(kdf.salt, 'base64'), {
    memoryCost: kdf.memoryCost,
    timeCost: kdf.timeCost,
    parallelism: kdf.parallelism,
  });
}

/**
 * Secret des sauvegardes automatiques (accord du client, D70) : le mot de passe n'est jamais
 * conservé ; seule la clé qui en est dérivée (Argon2id) l'est, protégée par DPAPI comme la clé de
 * la base. Restaurer exige toujours le mot de passe.
 */
export class BackupSecretStore {
  constructor(
    private readonly path: string,
    private readonly protector: KeyProtector,
  ) {}

  has(): boolean {
    return existsSync(this.path);
  }

  async set(password: string): Promise<void> {
    const kdf = newKdf();
    await this.adopt(kdf, await deriveBackupKey(password, kdf));
  }

  /** Garde une clé déjà dérivée (restauration sur un poste neuf, depuis le mot de passe saisi). */
  async adopt(kdf: KdfInfo, key: Buffer): Promise<void> {
    const sealed = await this.protector.protect(
      Buffer.from(JSON.stringify({ version: 1, kdf, key: key.toString('base64') }), 'utf8'),
    );
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, sealed, { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }

  async read(): Promise<{ kdf: KdfInfo; key: Buffer }> {
    if (!this.has()) {
      throw new AppError('CONFLICT', 'Définissez d’abord le mot de passe des sauvegardes.');
    }
    const { plain } = await this.protector.unprotect(readFileSync(this.path));
    const stored = storedSchema.parse(JSON.parse(plain.toString('utf8')));
    return { kdf: stored.kdf, key: Buffer.from(stored.key, 'base64') };
  }
}
