import { createHash } from 'node:crypto';
import type { Db } from './types';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export interface AuditHashInput {
  prevHash: string;
  userId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string;
  createdAt: string;
}

/** Empreinte d'une ligne du journal d'audit : SHA-256 de l'empreinte précédente et du contenu. */
export function auditHash(entry: AuditHashInput): string {
  const content = JSON.stringify([
    entry.prevHash,
    entry.userId,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.details,
    entry.createdAt,
  ]);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError('audit_hash : identifiant non numérique');
}

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('audit_hash : texte attendu');
  return value;
}

function asNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : asText(value);
}

/**
 * Fonctions SQL propres à l'application, utilisées par les triggers. Elles n'existent que sur
 * la connexion de l'application : un autre outil ne peut pas écrire dans le journal d'audit.
 */
export function registerSqlFunctions(db: Db): void {
  // L'arité SQL est déduite du nombre de paramètres déclarés : ils sont donc explicites.
  db.function(
    'audit_hash',
    { deterministic: true },
    (prevHash, userId, action, entityType, entityId, details, createdAt) =>
      auditHash({
        prevHash: asText(prevHash),
        userId: asNullableNumber(userId),
        action: asText(action),
        entityType: asNullableText(entityType),
        entityId: asNullableNumber(entityId),
        details: asText(details),
        createdAt: asText(createdAt),
      }),
  );
}
