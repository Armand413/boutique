import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { ARGON2_OPTIONS, deriveKey } from '../auth/hashing';
import { normalizeRecoveryKey } from '../auth/recovery-key';
import { DATABASE_KEY_BYTES } from './connection';

/** Protection de la clé par le système : DPAPI via `safeStorage` dans l'application. */
export interface KeyProtector {
  isAvailable(): Promise<boolean>;
  protect(plain: Buffer): Promise<Buffer>;
  /** `stale` : la protection doit être renouvelée (rotation de la clé du système). */
  unprotect(sealed: Buffer): Promise<{ plain: Buffer; stale: boolean }>;
}

export class KeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyUnavailableError';
  }
}

const ESCROW_AAD = Buffer.from('boutique-gestion/cle-base/v1', 'utf8');

const escrowSchema = z.strictObject({
  version: z.literal(1),
  kdf: z.strictObject({
    algorithm: z.literal('argon2id'),
    memoryCost: z.number().int().positive(),
    timeCost: z.number().int().positive(),
    parallelism: z.number().int().positive(),
    salt: z.base64(),
  }),
  cipher: z.literal('aes-256-gcm'),
  iv: z.base64(),
  tag: z.base64(),
  data: z.base64(),
});

/** Écriture atomique : fichier temporaire puis renommage (jamais de fichier à moitié écrit). */
function writeAtomic(path: string, content: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * Clé de chiffrement de la base (B.3) : 256 bits aléatoires, protégés par DPAPI dans `keyPath`,
 * et séquestrés sous la clé de récupération dans `escrowPath` (AES-256-GCM, clé dérivée Argon2id).
 * La clé n'est jamais écrite en clair ni journalisée.
 */
export class KeyStore {
  constructor(
    readonly keyPath: string,
    readonly escrowPath: string,
    private readonly protector: KeyProtector,
  ) {}

  hasKey(): boolean {
    return existsSync(this.keyPath);
  }

  hasEscrow(): boolean {
    return existsSync(this.escrowPath);
  }

  async createKey(): Promise<Buffer> {
    const key = randomBytes(DATABASE_KEY_BYTES);
    await this.saveKey(key);
    return key;
  }

  async saveKey(key: Buffer): Promise<void> {
    if (!(await this.protector.isAvailable())) {
      throw new KeyUnavailableError(
        'Le coffre de Windows (DPAPI) est indisponible : la clé ne peut pas être protégée.',
      );
    }
    writeAtomic(this.keyPath, await this.protector.protect(key));
  }

  async readKey(): Promise<Buffer> {
    let unprotected: { plain: Buffer; stale: boolean };
    try {
      unprotected = await this.protector.unprotect(readFileSync(this.keyPath));
    } catch {
      throw new KeyUnavailableError(
        'La clé de la base ne peut pas être lue sur ce compte Windows.',
      );
    }
    const key = unprotected.plain;
    if (key.length !== DATABASE_KEY_BYTES) {
      throw new KeyUnavailableError('La clé de la base est corrompue.');
    }
    if (unprotected.stale) await this.saveKey(key);
    return key;
  }

  async writeEscrow(key: Buffer, recoveryKey: string): Promise<void> {
    const canonical = normalizeRecoveryKey(recoveryKey);
    if (canonical === null) throw new AppError('INTERNAL_ERROR', 'Clé de récupération invalide.');
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const wrappingKey = await deriveKey(canonical, salt);
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    cipher.setAAD(ESCROW_AAD);
    const data = Buffer.concat([cipher.update(key), cipher.final()]);
    const escrow: z.infer<typeof escrowSchema> = {
      version: 1,
      kdf: {
        algorithm: 'argon2id',
        memoryCost: ARGON2_OPTIONS.memoryCost ?? 65536,
        timeCost: ARGON2_OPTIONS.timeCost ?? 3,
        parallelism: ARGON2_OPTIONS.parallelism ?? 1,
        salt: salt.toString('base64'),
      },
      cipher: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    writeAtomic(this.escrowPath, JSON.stringify(escrow, null, 2));
  }

  /** Retrouve la clé de la base grâce à la clé de récupération ; échoue si la clé est fausse. */
  async recoverKey(recoveryKey: string): Promise<Buffer> {
    const canonical = normalizeRecoveryKey(recoveryKey);
    const invalid = new AppError('INVALID_CREDENTIALS', 'Clé de récupération incorrecte.');
    if (canonical === null) throw invalid;
    let escrow: z.infer<typeof escrowSchema>;
    try {
      escrow = escrowSchema.parse(JSON.parse(readFileSync(this.escrowPath, 'utf8')));
    } catch {
      throw new AppError('NOT_FOUND', 'Le fichier de séquestre de la clé est absent ou illisible.');
    }
    const wrappingKey = await deriveKey(canonical, Buffer.from(escrow.kdf.salt, 'base64'), {
      memoryCost: escrow.kdf.memoryCost,
      timeCost: escrow.kdf.timeCost,
      parallelism: escrow.kdf.parallelism,
    });
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        wrappingKey,
        Buffer.from(escrow.iv, 'base64'),
      );
      decipher.setAAD(ESCROW_AAD);
      decipher.setAuthTag(Buffer.from(escrow.tag, 'base64'));
      const key = Buffer.concat([
        decipher.update(Buffer.from(escrow.data, 'base64')),
        decipher.final(),
      ]);
      if (key.length !== DATABASE_KEY_BYTES) throw invalid;
      return key;
    } catch {
      throw invalid;
    }
  }
}
