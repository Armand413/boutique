import type { AuditEntry, AuditVerification } from '@shared/schemas/auth';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { appendAudit, verifyAuditChain } from './audit-log';

interface AuditListRow {
  id: number;
  created_at: string;
  action: string;
  username: string | null;
  entity_type: string | null;
  entity_id: number | null;
  details: string;
}

/** Consultation du journal d'audit (audit.view), du plus récent au plus ancien. */
export class AuditService {
  constructor(private readonly db: Db) {}

  list(actor: Session, limit: number, beforeId?: number): AuditEntry[] {
    requirePermission(actor, 'audit.view');
    const rows = this.db
      .prepare<[number, number], AuditListRow>(
        `SELECT a.id, a.created_at, a.action, u.username, a.entity_type, a.entity_id, a.details
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`,
      )
      .all(beforeId ?? Number.MAX_SAFE_INTEGER, limit);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      username: row.username,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: JSON.parse(row.details) as Record<string, unknown>,
    }));
  }

  verify(actor: Session): AuditVerification {
    requirePermission(actor, 'audit.view');
    const result = verifyAuditChain(this.db);
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'audit.verified',
      details: { ok: result.ok, checked: result.checked, brokenAtId: result.brokenAtId },
    });
    return result;
  }
}
