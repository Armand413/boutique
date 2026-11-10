import type { AuditVerification } from '@shared/schemas/auth';
import { nowIsoUtc } from '@shared/format/date';
import { redact } from '../logging/redact';
import { AUDIT_GENESIS_HASH, auditHash } from '../db/sql-functions';
import type { Db } from '../db/types';

export interface AuditEvent {
  userId: number | null;
  /** Forme `domaine.action`, par exemple `auth.login_failed`. */
  action: string;
  entityType?: string;
  entityId?: number;
  /** Jamais de secret : les clés sensibles sont masquées par sécurité. */
  details?: Record<string, unknown>;
}

interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: string;
  created_at: string;
  prev_hash: string;
  hash: string;
}

/** Ajoute une ligne chaînée au journal d'audit (le trigger revérifie l'empreinte). */
export function appendAudit(db: Db, event: AuditEvent): void {
  const last = db
    .prepare<[], { hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
    .get();
  const entry = {
    prevHash: last?.hash ?? AUDIT_GENESIS_HASH,
    userId: event.userId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    details: JSON.stringify(redact(event.details ?? {})),
    createdAt: nowIsoUtc(),
  };
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at, prev_hash, hash)
     VALUES (@userId, @action, @entityType, @entityId, @details, @createdAt, @prevHash, @hash)`,
  ).run({ ...entry, hash: auditHash(entry) });
}

/**
 * Vérifie toute la chaîne : chaque ligne doit pointer sur l'empreinte de la précédente
 * et son empreinte doit correspondre à son contenu. Renvoie la première ligne altérée.
 */
export function verifyAuditChain(db: Db): AuditVerification {
  const rows = db
    .prepare<[], AuditRow>(
      `SELECT id, user_id, action, entity_type, entity_id, details, created_at, prev_hash, hash
       FROM audit_log ORDER BY id`,
    )
    .iterate();
  let previous = AUDIT_GENESIS_HASH;
  let checked = 0;
  for (const row of rows) {
    const expected = auditHash({
      prevHash: row.prev_hash,
      userId: row.user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details,
      createdAt: row.created_at,
    });
    if (row.prev_hash !== previous || row.hash !== expected) {
      return { ok: false, checked, brokenAtId: row.id };
    }
    previous = row.hash;
    checked += 1;
  }
  return { ok: true, checked, brokenAtId: null };
}
