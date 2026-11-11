import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { DATABASE_KEY_BYTES } from '../db/connection';

/**
 * Fichier de sauvegarde (B.3, 4.10) :
 *   « BGSAUV01 » | longueur de l'en-tête (u32) | en-tête JSON | contenu chiffré | étiquette GCM (16 o)
 * L'en-tête (date, boutique, versions, paramètres de dérivation) est lisible sans mot de passe pour
 * l'aperçu avant restauration, mais authentifié (données associées AES-GCM) : le modifier rend le
 * fichier invalide. Le contenu chiffré porte la copie de la base, sa clé et le séquestre de la clé ;
 * la clé AES-256 est dérivée du mot de passe du propriétaire par Argon2id (D70).
 */
const MAGIC = Buffer.from('BGSAUV01', 'ascii');
const TAG_BYTES = 16;
export const BACKUP_EXTENSION = 'bgsauv';

export const kdfSchema = z.strictObject({
  algorithm: z.literal('argon2id'),
  // Bornes : un en-tête modifié ne doit pas pouvoir bloquer le poste pendant la dérivation.
  memoryCost: z.number().int().min(8192).max(262_144),
  timeCost: z.number().int().min(1).max(10),
  parallelism: z.number().int().min(1).max(8),
  salt: z.base64(),
});
export type KdfInfo = z.infer<typeof kdfSchema>;

export const backupHeaderSchema = z.strictObject({
  format: z.literal(1),
  kind: z.enum(['auto', 'manual', 'safety']),
  createdAt: z.string(),
  appVersion: z.string().max(32),
  schemaVersion: z.number().int().min(1),
  shopName: z.string().max(120),
  kdf: kdfSchema,
  cipher: z.literal('aes-256-gcm'),
  iv: z.base64(),
});
export type BackupHeader = z.infer<typeof backupHeaderSchema>;

const manifestSchema = z.strictObject({
  databaseKey: z.base64(),
  escrow: z.string().nullable(),
  databaseSha256: z.string().regex(/^[0-9a-f]{64}$/),
  databaseBytes: z.number().int().min(1),
});

export interface BackupContent {
  database: Buffer;
  databaseKey: Buffer;
  /** Séquestre de la clé de la base (chiffré par la clé de récupération), s'il existe. */
  escrow: string | null;
}

const INVALID = 'Ce fichier n’est pas une sauvegarde de l’application ou il est endommagé.';
const WRONG = 'Mot de passe incorrect, ou sauvegarde modifiée depuis sa création.';

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/** Chiffre une sauvegarde complète avec la clé dérivée du mot de passe. */
export function encodeBackup(
  header: Omit<BackupHeader, 'format' | 'cipher' | 'iv'>,
  wrappingKey: Buffer,
  content: BackupContent,
): Buffer {
  const iv = randomBytes(12);
  const headerBytes = Buffer.from(
    JSON.stringify({ format: 1, ...header, cipher: 'aes-256-gcm', iv: iv.toString('base64') }),
    'utf8',
  );
  const prefix = Buffer.concat([MAGIC, u32(headerBytes.length), headerBytes]);
  const manifest = Buffer.from(
    JSON.stringify({
      databaseKey: content.databaseKey.toString('base64'),
      escrow: content.escrow,
      databaseSha256: sha256(content.database),
      databaseBytes: content.database.length,
    }),
    'utf8',
  );
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  cipher.setAAD(prefix);
  const encrypted = Buffer.concat([
    cipher.update(u32(manifest.length)),
    cipher.update(manifest),
    cipher.update(content.database),
    cipher.final(),
  ]);
  return Buffer.concat([prefix, encrypted, cipher.getAuthTag()]);
}

function split(file: Buffer): { prefix: Buffer; header: BackupHeader; body: Buffer; tag: Buffer } {
  if (file.length < MAGIC.length + 4 + TAG_BYTES || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError('VALIDATION_ERROR', INVALID);
  }
  const headerLength = file.readUInt32BE(MAGIC.length);
  const headerEnd = MAGIC.length + 4 + headerLength;
  if (headerLength > 64_000 || headerEnd + TAG_BYTES > file.length) {
    throw new AppError('VALIDATION_ERROR', INVALID);
  }
  let header: BackupHeader;
  try {
    header = backupHeaderSchema.parse(
      JSON.parse(file.subarray(MAGIC.length + 4, headerEnd).toString('utf8')),
    );
  } catch {
    throw new AppError('VALIDATION_ERROR', INVALID);
  }
  return {
    prefix: file.subarray(0, headerEnd),
    header,
    body: file.subarray(headerEnd, file.length - TAG_BYTES),
    tag: file.subarray(file.length - TAG_BYTES),
  };
}

/** En-tête lisible sans mot de passe (aperçu avant restauration) ; non garanti avant déchiffrement. */
export function readBackupHeader(file: Buffer): BackupHeader {
  return split(file).header;
}

/** Déchiffre et vérifie une sauvegarde : étiquette GCM, empreinte et taille de la base. */
export function decodeBackup(
  file: Buffer,
  wrappingKey: Buffer,
): { header: BackupHeader } & BackupContent {
  const { prefix, header, body, tag } = split(file);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(header.iv, 'base64'));
    decipher.setAAD(prefix);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new AppError('INVALID_CREDENTIALS', WRONG);
  }
  const manifestLength = plain.readUInt32BE(0);
  const manifest = manifestSchema.parse(
    JSON.parse(plain.subarray(4, 4 + manifestLength).toString('utf8')),
  );
  const database = plain.subarray(4 + manifestLength);
  const databaseKey = Buffer.from(manifest.databaseKey, 'base64');
  if (
    database.length !== manifest.databaseBytes ||
    sha256(database) !== manifest.databaseSha256 ||
    databaseKey.length !== DATABASE_KEY_BYTES
  ) {
    throw new AppError('VALIDATION_ERROR', INVALID);
  }
  return { header, database, databaseKey, escrow: manifest.escrow };
}

/** Empreinte du fichier entier, enregistrée dans `backup_log`. */
export function fileChecksum(file: Buffer): string {
  return sha256(file);
}
