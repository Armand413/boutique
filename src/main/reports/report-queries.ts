import type { Dashboard, ReportRequest, ReportResult } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { balancesReport, cashReport, followupsReport } from './finance-reports';
import { sensitiveReport, sensitiveRows } from './fraud-report';
import { currentPeriods, daysOf, utcBounds } from './period';
import type { ReportContext } from './report-kit';
import { productsReport, salesReport } from './sales-reports';
import { inventoryReport, movementsReport, stockReport } from './stock-reports';

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
    case 'sensitive':
      return sensitiveReport(db, request, context);
    case 'inventory':
      return inventoryReport(db, request, context);
  }
}

export interface DashboardContext {
  canSeeCost: boolean;
  canSeeStock: boolean;
  canSeeAudit: boolean;
  now: Date;
  /** Vendeur (sans accès aux rapports) : seulement les ventes du jour (D93). */
  todayOnly?: boolean;
}

/** Nombre maximal de ventes du jour listées au vendeur. */
const TODAY_SALES_LIMIT = 200;

interface DayTotals {
  count: number;
  revenue_ttc: number;
  margin: number;
}

/**
 * Totaux par jour sur toute la plage utile au tableau de bord, en une seule lecture : une vente
 * appartient à un seul jour, les totaux du jour, de la semaine et du mois s'en déduisent.
 */
function dailyTotals(db: Db, period: { from: string; to: string }): Map<string, DayTotals> {
  const [from, to] = utcBounds(period);
  return new Map(
    db
      .prepare<[string, string], DayTotals & { day: string }>(
        `SELECT day, count(DISTINCT sale_id) AS count, sum(revenue_ttc) AS revenue_ttc, sum(margin) AS margin
         FROM v_sale_lines_net WHERE completed_at >= ? AND completed_at < ? GROUP BY day`,
      )
      .all(from, to)
      .map(({ day, ...totals }) => [day, totals]),
  );
}

function periodTotals(
  days: Map<string, DayTotals>,
  period: { from: string; to: string },
  canSeeCost: boolean,
) {
  let count = 0;
  let revenueTtc = 0;
  let margin = 0;
  for (const day of daysOf(period)) {
    const totals = days.get(day);
    if (totals === undefined) continue;
    count += totals.count;
    revenueTtc += totals.revenue_ttc;
    margin += totals.margin;
  }
  return { count, revenueTtc, margin: canSeeCost ? margin : null };
}

function dailySeries(
  days: Map<string, DayTotals>,
  period: { from: string; to: string },
  canSeeCost: boolean,
) {
  return daysOf(period).map((day) => ({
    day,
    revenueTtc: days.get(day)?.revenue_ttc ?? 0,
    margin: canSeeCost ? (days.get(day)?.margin ?? 0) : null,
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

/** Dernières ventes ; `since` : seulement celles faites depuis cet instant (ventes du jour). */
function latestSales(db: Db, since: string | null = null): Dashboard['latestSales'] {
  return db
    .prepare<
      [string | null, string | null, number],
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
       WHERE s.status = 'completed' AND (? IS NULL OR s.completed_at >= ?)
       ORDER BY s.completed_at DESC, s.id DESC LIMIT ?`,
    )
    .all(since, since, since === null ? 6 : TODAY_SALES_LIMIT);
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
  if (context.todayOnly === true) return todayDashboard(db, context);
  const periods = currentPeriods(context.now);
  const earliest =
    [periods.last30.from, periods.month.from, periods.week.from].sort()[0] ?? periods.today.from;
  const days = dailyTotals(db, { from: earliest, to: periods.today.to });
  return {
    todayOnly: false,
    today: periodTotals(days, periods.today, context.canSeeCost),
    week: periodTotals(days, periods.week, context.canSeeCost),
    month: periodTotals(days, periods.month, context.canSeeCost),
    lowStock: context.canSeeStock ? count(db, 'SELECT count(*) FROM v_low_stock') : null,
    overdueInstallments: count(db, 'SELECT count(*) FROM v_overdue_installments'),
    sensitive: context.canSeeAudit
      ? sensitiveRows(db, { from: periods.last7.from, to: periods.last7.to }).length
      : null,
    openClaims: count(
      db,
      "SELECT count(*) FROM warranty_claims WHERE status NOT IN ('closed', 'rejected')",
    ),
    days: dailySeries(days, periods.last30, context.canSeeCost),
    families: familySeries(db, periods.month, context.canSeeCost),
    latestSales: latestSales(db),
    latestMovements: context.canSeeStock ? latestMovements(db) : null,
  };
}

/** Tableau du vendeur (D93) : total et liste des ventes du jour, rien d'autre. */
function todayDashboard(db: Db, context: DashboardContext): Dashboard {
  const { today } = currentPeriods(context.now);
  const days = dailyTotals(db, today);
  const [since] = utcBounds(today);
  return {
    todayOnly: true,
    today: periodTotals(days, today, context.canSeeCost),
    week: null,
    month: null,
    lowStock: null,
    overdueInstallments: 0,
    sensitive: null,
    openClaims: 0,
    days: [],
    families: [],
    latestSales: latestSales(db, since),
    latestMovements: null,
  };
}
