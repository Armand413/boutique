import type { Dashboard, ReportRequest, ReportResult } from '@shared/schemas/reports';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import type { ReportExecutor } from './report-executor';
import { writeReport, type ExportFormat } from './report-export';
import { DISPLAY_LIMIT } from './report-kit';

const FILTERS: Readonly<Record<ExportFormat, { name: string; extensions: string[] }>> = {
  pdf: { name: 'Document PDF', extensions: ['pdf'] },
  xlsx: { name: 'Classeur Excel', extensions: ['xlsx'] },
  csv: { name: 'Fichier CSV', extensions: ['csv'] },
};

/**
 * Tableau de bord et rapports (4.8, 4.12). Les droits sont vérifiés ici ; le calcul part dans le
 * thread des rapports avec les seuls droits utiles (coûts visibles ou non), jamais la session.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly executor: ReportExecutor,
    private readonly dialogs: FileDialogs,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async dashboard(actor: Session): Promise<Dashboard> {
    requirePermission(actor, 'dashboard.view');
    return await this.executor.execute({
      type: 'dashboard',
      canSeeCost: actor.permissions.has('cost.view'),
      canSeeStock: actor.permissions.has('stock.view'),
      nowIso: this.clock().toISOString(),
    });
  }

  async run(actor: Session, request: ReportRequest): Promise<ReportResult> {
    requirePermission(actor, 'report.view');
    return await this.compute(actor, request, DISPLAY_LIMIT);
  }

  /** Export complet (toutes les lignes), tracé dans le journal d'audit (B.3). */
  async export(
    actor: Session,
    request: ReportRequest,
    format: ExportFormat,
  ): Promise<{ saved: boolean }> {
    requirePermission(actor, 'report.view');
    requirePermission(actor, 'export.run');
    const result = await this.compute(actor, request, null);
    const path = await this.dialogs.saveFile({
      title: 'Enregistrer le rapport',
      defaultName: `rapport-${request.kind}-${result.generatedAt.slice(0, 10)}.${format}`,
      filters: [FILTERS[format]],
    });
    if (path === null) return { saved: false };
    await writeReport(path, format, request, result);
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'report.exported',
      entityType: 'report',
      details: {
        kind: request.kind,
        format,
        rows: result.rows.length,
        costs: actor.permissions.has('cost.view'),
      },
    });
    return { saved: true };
  }

  close(): Promise<void> {
    return this.executor.close();
  }

  private compute(actor: Session, request: ReportRequest, limit: number | null) {
    return this.executor.execute({
      type: 'report',
      request,
      canSeeCost: actor.permissions.has('cost.view'),
      nowIso: this.clock().toISOString(),
      limit,
    });
  }
}
