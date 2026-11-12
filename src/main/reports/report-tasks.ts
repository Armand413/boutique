import type { Dashboard, ReportRequest, ReportResult } from '@shared/schemas/reports';
import { integrityProblems } from '../db/connection';
import type { Db } from '../db/types';
import { dashboard, runReport } from './report-queries';

/** Travail confié au thread des rapports ; uniquement des données clonables (pas de session). */
export type ReportTask =
  | {
      type: 'report';
      request: ReportRequest;
      canSeeCost: boolean;
      nowIso: string;
      limit: number | null;
    }
  | {
      type: 'dashboard';
      canSeeCost: boolean;
      canSeeStock: boolean;
      canSeeAudit: boolean;
      nowIso: string;
    }
  /** Copie cohérente de la base (`VACUUM INTO`), chiffrée avec la même clé, vers `path`. */
  | { type: 'snapshot'; path: string }
  /** `PRAGMA integrity_check` complet, lancé au démarrage hors du processus principal (D77). */
  | { type: 'integrity' };

export type TaskResult<T extends ReportTask> = T extends { type: 'report' }
  ? ReportResult
  : T extends { type: 'dashboard' }
    ? Dashboard
    : T extends { type: 'integrity' }
      ? string[]
      : null;

/** Copie la base vers `path` ; la connexion du thread est en lecture seule, la copie reste possible. */
export function snapshot(db: Db, path: string): null {
  const queryOnly = db.pragma('query_only', { simple: true }) === 1;
  if (queryOnly) db.pragma('query_only = OFF');
  try {
    db.prepare('VACUUM INTO ?').run(path);
  } finally {
    if (queryOnly) db.pragma('query_only = ON');
  }
  return null;
}

type TaskData = ReportResult | Dashboard | string[] | null;

export function executeTask(db: Db, task: ReportTask): TaskData {
  if (task.type === 'snapshot') return snapshot(db, task.path);
  if (task.type === 'integrity') return integrityProblems(db);
  const now = new Date(task.nowIso);
  if (task.type === 'dashboard') {
    return dashboard(db, {
      canSeeCost: task.canSeeCost,
      canSeeStock: task.canSeeStock,
      canSeeAudit: task.canSeeAudit,
      now,
    });
  }
  return runReport(db, task.request, { canSeeCost: task.canSeeCost, now, limit: task.limit });
}

/** Message échangé avec le thread : une réponse par identifiant de demande. */
export type WorkerReply =
  | { id: number; ok: true; data: TaskData }
  | { id: number; ok: false; code: string; message: string };
