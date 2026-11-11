import type { Dashboard, ReportRequest, ReportResult } from '@shared/schemas/reports';
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
  | { type: 'dashboard'; canSeeCost: boolean; canSeeStock: boolean; nowIso: string };

export type TaskResult<T extends ReportTask> = T extends { type: 'report' }
  ? ReportResult
  : Dashboard;

export function executeTask(db: Db, task: ReportTask): ReportResult | Dashboard {
  const now = new Date(task.nowIso);
  if (task.type === 'dashboard') {
    return dashboard(db, { canSeeCost: task.canSeeCost, canSeeStock: task.canSeeStock, now });
  }
  return runReport(db, task.request, { canSeeCost: task.canSeeCost, now, limit: task.limit });
}

/** Message échangé avec le thread : une réponse par identifiant de demande. */
export type WorkerReply =
  | { id: number; ok: true; data: ReportResult | Dashboard }
  | { id: number; ok: false; code: string; message: string };
