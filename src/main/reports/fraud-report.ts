import { z } from 'zod';
import type { ReportRequest, ReportResult, ReportRow } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { getSetting } from '../settings/settings-repository';
import { utcBounds } from './period';
import { col, finish, type ReportContext } from './report-kit';

type SensitiveRequest = Extract<ReportRequest, { kind: 'sensitive' }>;

const MANUAL_EXITS = "('adjustment', 'loss', 'damage', 'theft', 'internal_use')";

export interface FraudThresholds {
  discountAlert: number;
  adjustmentsPerDay: number;
  cashDifference: number;
}

export function fraudThresholds(db: Db): FraudThresholds {
  return {
    discountAlert: getSetting(db, 'fraud.discount_alert', z.number().int()),
    adjustmentsPerDay: getSetting(db, 'fraud.adjustments_per_day', z.number().int()),
    cashDifference: getSetting(db, 'fraud.cash_difference', z.number().int()),
  };
}

function cancellations(db: Db, from: string, to: string): ReportRow[] {
  return db
    .prepare<[string, string], ReportRow>(
      `SELECT s.cancelled_at AS created_at, 'cancellation' AS category, u.full_name AS user,
              s.invoice_number AS reference, s.cancel_reason AS detail, s.total AS amount
       FROM sales s JOIN users u ON u.id = s.cancelled_by
       WHERE s.status = 'cancelled' AND s.cancelled_at >= ? AND s.cancelled_at < ?`,
    )
    .all(from, to);
}

function discounts(db: Db, from: string, to: string, threshold: number): ReportRow[] {
  return db
    .prepare<[string, string, number], ReportRow>(
      `SELECT s.completed_at AS created_at, 'discount' AS category, u.full_name AS user,
              s.invoice_number AS reference,
              p.name || ' : ' || CAST(round(l.discount * 100.0 / (l.quantity * l.unit_price), 1) AS TEXT) || ' %' AS detail,
              l.discount AS amount
       FROM sale_lines l
       JOIN sales s ON s.id = l.sale_id AND s.status = 'completed'
       JOIN users u ON u.id = s.user_id
       JOIN product_variants v ON v.id = l.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE s.completed_at >= ? AND s.completed_at < ? AND l.line_type <> 'kit_component'
         AND l.unit_price > 0 AND l.discount * 10000 > ? * l.quantity * l.unit_price`,
    )
    .all(from, to, threshold);
}

function belowCost(db: Db, from: string, to: string): ReportRow[] {
  return db
    .prepare<[string, string], ReportRow>(
      `SELECT n.completed_at AS created_at, 'below_cost' AS category, u.full_name AS user,
              n.invoice_number AS reference, p.name AS detail, n.margin AS amount
       FROM v_sale_lines_net n
       JOIN users u ON u.id = n.user_id
       JOIN products p ON p.id = n.product_id
       WHERE n.completed_at >= ? AND n.completed_at < ? AND n.quantity > 0 AND n.margin < 0`,
    )
    .all(from, to);
}

function repeatedAdjustments(db: Db, from: string, to: string, threshold: number): ReportRow[] {
  return db
    .prepare<[string, string, number], ReportRow>(
      `SELECT max(m.created_at) AS created_at, 'adjustments' AS category, u.full_name AS user,
              date(m.created_at, 'localtime') AS reference,
              CAST(count(*) AS TEXT) || ' sorties ou ajustements manuels' AS detail,
              sum(abs(m.quantity_delta) * m.unit_cost) AS amount
       FROM stock_movements m JOIN users u ON u.id = m.user_id
       WHERE m.created_at >= ? AND m.created_at < ? AND m.movement_type IN ${MANUAL_EXITS}
       GROUP BY m.user_id, date(m.created_at, 'localtime')
       HAVING count(*) >= ?`,
    )
    .all(from, to, threshold);
}

function cashDifferences(db: Db, from: string, to: string, threshold: number): ReportRow[] {
  return db
    .prepare<[string, string, number], ReportRow>(
      `SELECT cs.closed_at AS created_at, 'cash_difference' AS category, u.full_name AS user,
              'Session ' || CAST(cs.id AS TEXT) AS reference,
              'Attendu ' || CAST(cs.expected_amount AS TEXT) || ', compté ' || CAST(cs.counted_amount AS TEXT) AS detail,
              cs.difference AS amount
       FROM cash_sessions cs JOIN users u ON u.id = cs.closed_by
       WHERE cs.status = 'closed' AND cs.closed_at >= ? AND cs.closed_at < ?
         AND abs(cs.difference) >= ? AND cs.difference <> 0`,
    )
    .all(from, to, threshold);
}

/**
 * Activités sensibles (B.4b) : annulations, remises au-delà du seuil, ventes sous le coût,
 * ajustements de stock répétés, écarts de caisse. Réservé à l'administrateur (`audit.view`).
 */
export function sensitiveRows(db: Db, period: { from: string; to: string }): ReportRow[] {
  const [from, to] = utcBounds(period);
  const limits = fraudThresholds(db);
  return [
    ...cancellations(db, from, to),
    ...discounts(db, from, to, limits.discountAlert),
    ...belowCost(db, from, to),
    ...repeatedAdjustments(db, from, to, limits.adjustmentsPerDay),
    ...cashDifferences(db, from, to, limits.cashDifference),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function sensitiveReport(
  db: Db,
  request: SensitiveRequest,
  context: ReportContext,
): ReportResult {
  const rows = sensitiveRows(db, request.period);
  const count = (category: string) => rows.filter((row) => row.category === category).length;
  return finish(
    'sensitive',
    {
      columns: [
        col('created_at', 'datetime'),
        col('category', 'enum', { enumKey: 'fraud' }),
        col('user', 'text'),
        col('reference', 'text'),
        col('detail', 'text'),
        col('amount', 'money'),
      ],
      rows,
      totals: null,
      summary: [
        { key: 'alerts', type: 'int', value: rows.length },
        { key: 'cancellations', type: 'int', value: count('cancellation') },
        { key: 'discounts', type: 'int', value: count('discount') },
        { key: 'below_cost', type: 'int', value: count('below_cost') },
        { key: 'adjustments', type: 'int', value: count('adjustments') },
        { key: 'cash_differences', type: 'int', value: count('cash_difference') },
      ],
      chart: null,
    },
    context,
  );
}
