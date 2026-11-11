import type { Dashboard, ReportRequest, ReportResult } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { balancesReport, cashReport, followupsReport } from './finance-reports';
import { currentPeriods, daysOf, utcBounds } from './period';
import type { ReportContext } from './report-kit';
import { productsReport, salesReport } from './sales-reports';
import { movementsReport, stockReport } from './stock-reports';

/** Calcul d'un rapport : fonction pure de la base, appelée dans le thread des rapports. */
export function runReport(db: Db, request: ReportRequest, context: ReportContext): ReportResult {
  switch (request.kind) {
    case 'sales':
      return salesReport(db, request, context);
    case 'products':
      return productsReport(db, request, context);
    case 'stock':
      return stockReport(db, request, context);
    case 'movements':
      return movementsReport(db, request, context);
    case 'balances':
      return balancesReport(db, context);
    case 'cash':
      return cashReport(db, request, context);
    case 'followups':
      return followupsReport(db, context);
  }
}

export interface DashboardContext {
  canSeeCost: boolean;
  canSeeStock: boolean;
  now: Date;
}

interface Totals {
  count: number;
  revenue_ttc: number;
  margin: number;
}

function periodTotals(db: Db, period: { from: string; to: string }, canSeeCost: boolean) {
  const [from, to] = utcBounds(period);
  const row = db
    .prepare<[string, string], Totals>(
      `SELECT count(DISTINCT sale_id) AS count, coalesce(sum(revenue_ttc), 0) AS revenue_ttc,
              coalesce(sum(margin), 0) AS margin
       FROM v_sale_lines_net WHERE completed_at >= ? AND completed_at < ?`,
    )
    .get(from, to) ?? { count: 0, revenue_ttc: 0, margin: 0 };
  return { count: row.count, revenueTtc: row.revenue_ttc, margin: canSeeCost ? row.margin : null };
}

function dailySeries(db: Db, period: { from: string; to: string }, canSeeCost: boolean) {
  const [from, to] = utcBounds(period);
  const found = new Map(
    db
      .prepare<[string, string], { day: string; revenue_ttc: number; margin: number }>(
        `SELECT day, sum(revenue_ttc) AS revenue_ttc, sum(margin) AS margin
         FROM v_sale_lines_net WHERE completed_at >= ? AND completed_at < ? GROUP BY day`,
      )
      .all(from, to)
      .map((row) => [row.day, row]),
  );
  return daysOf(period).map((day) => ({
    day,
    revenueTtc: found.get(day)?.revenue_ttc ?? 0,
    margin: canSeeCost ? (found.get(day)?.margin ?? 0) : null,
  }));
}

function familySeries(db: Db, period: { from: string; to: string }, canSeeCost: boolean) {
  const [from, to] = utcBounds(period);
  return db
    .prepare<[string, string], { name: string; revenue_ttc: number; margin: number }>(
      `SELECT family_name AS name, sum(revenue_ttc) AS revenue_ttc, sum(margin) AS margin
       FROM v_sale_lines_net WHERE completed_at >= ? AND completed_at < ?
       GROUP BY family_id ORDER BY revenue_ttc DESC`,
    )
    .all(from, to)
    .map((row) => ({
      name: row.name,
      revenueTtc: row.revenue_ttc,
      margin: canSeeCost ? row.margin : null,
    }));
}

function latestSales(db: Db): Dashboard['latestSales'] {
  return db
    .prepare<
      [],
      {
        saleId: number;
        invoiceNumber: string;
        completedAt: string;
        customerName: string | null;
        total: number;
      }
    >(
      `SELECT s.id AS saleId, s.invoice_number AS invoiceNumber, s.completed_at AS completedAt,
              c.full_name AS customerName, s.total
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.status = 'completed'
       ORDER BY s.completed_at DESC, s.id DESC LIMIT 6`,
    )
    .all();
}

function latestMovements(db: Db): NonNullable<Dashboard['latestMovements']> {
  return db
    .prepare<[], NonNullable<Dashboard['latestMovements']>[number]>(
      `SELECT m.id, m.created_at AS createdAt, p.name AS productName, m.movement_type AS movementType,
              m.quantity_delta AS quantity, sl.name AS locationName
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN stock_locations sl ON sl.id = m.location_id
       ORDER BY m.id DESC LIMIT 6`,
    )
    .all();
}

function count(db: Db, sql: string): number {
  return db.prepare<[], number>(sql).pluck().get() ?? 0;
}

/** Tableau de bord (4.8, A.4) : ventes du jour, de la semaine et du mois, alertes, dernières opérations. */
export function dashboard(db: Db, context: DashboardContext): Dashboard {
  const periods = currentPeriods(context.now);
  return {
    today: periodTotals(db, periods.today, context.canSeeCost),
    week: periodTotals(db, periods.week, context.canSeeCost),
    month: periodTotals(db, periods.month, context.canSeeCost),
    lowStock: context.canSeeStock ? count(db, 'SELECT count(*) FROM v_low_stock') : null,
    overdueInstallments: count(db, 'SELECT count(*) FROM v_overdue_installments'),
    openClaims: count(
      db,
      "SELECT count(*) FROM warranty_claims WHERE status NOT IN ('closed', 'rejected')",
    ),
    days: dailySeries(db, periods.last30, context.canSeeCost),
    families: familySeries(db, periods.month, context.canSeeCost),
    latestSales: latestSales(db),
    latestMovements: context.canSeeStock ? latestMovements(db) : null,
  };
}
