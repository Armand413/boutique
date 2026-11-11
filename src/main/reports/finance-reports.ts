import type { ReportRequest, ReportResult, ReportRow } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { localDay, utcBounds } from './period';
import { col, finish, sum, type ReportContext } from './report-kit';

type CashRequest = Extract<ReportRequest, { kind: 'cash' }>;

/** Créances clients et dettes fournisseurs (4.8), soldes calculés par les vues. */
export function balancesReport(db: Db, context: ReportContext): ReportResult {
  const today = localDay(context.now);
  const customers = db
    .prepare<[string], ReportRow>(
      `SELECT 'customer' AS party, b.full_name AS name, c.phone, b.balance,
              coalesce((SELECT sum(i.amount - i.paid_amount) FROM sale_installments i
                        JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
                        WHERE s.customer_id = c.id AND i.paid_amount < i.amount AND i.due_date < ?), 0) AS overdue,
              (SELECT min(s.due_date) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'
                 AND s.amount_paid < s.total) AS due_date
       FROM v_customer_balances b JOIN customers c ON c.id = b.customer_id
       WHERE b.balance > 0
       ORDER BY b.balance DESC`,
    )
    .all(today);
  const suppliers = db
    .prepare<[], ReportRow>(
      `SELECT 'supplier' AS party, b.name, sp.phone, b.balance, NULL AS overdue, NULL AS due_date
       FROM v_supplier_balances b JOIN suppliers sp ON sp.id = b.supplier_id
       WHERE b.balance > 0
       ORDER BY b.balance DESC`,
    )
    .all();
  return finish(
    'balances',
    {
      columns: [
        col('party', 'enum', { enumKey: 'party' }),
        col('name', 'text'),
        col('phone', 'text'),
        col('balance', 'money'),
        col('overdue', 'money'),
        col('due_date', 'date'),
      ],
      rows: [...customers, ...suppliers],
      totals: null,
      summary: [
        { key: 'receivables', type: 'money', value: sum(customers, 'balance') },
        { key: 'overdue', type: 'money', value: sum(customers, 'overdue') },
        { key: 'payables', type: 'money', value: sum(suppliers, 'balance') },
      ],
      chart: null,
    },
    context,
  );
}

/** Rapports de caisse (4.8) : sessions ouvertes sur la période, encaissements et écarts. */
export function cashReport(db: Db, request: CashRequest, context: ReportContext): ReportResult {
  const [from, to] = utcBounds(request.period);
  const rows = db
    .prepare<[string, string], ReportRow>(
      `SELECT v.opened_at, v.closed_at, uo.full_name AS opened_by, uc.full_name AS closed_by,
              (SELECT count(*) FROM sales s WHERE s.cash_session_id = cs.id AND s.status = 'completed') AS sales_count,
              (SELECT coalesce(sum(s.total), 0) FROM sales s WHERE s.cash_session_id = cs.id AND s.status = 'completed') AS sales_total,
              v.opening_float, v.cash_in, v.card_in, v.mobile_money_in, v.transfer_in, v.cheque_in,
              v.cash_movements_in - v.cash_movements_out AS cash_movements, v.cash_refunds,
              cs.expected_amount, cs.counted_amount, cs.difference
       FROM v_cash_session_summary v
       JOIN cash_sessions cs ON cs.id = v.cash_session_id
       JOIN users uo ON uo.id = cs.opened_by
       LEFT JOIN users uc ON uc.id = cs.closed_by
       WHERE v.opened_at >= ? AND v.opened_at < ?
       ORDER BY v.opened_at DESC`,
    )
    .all(from, to);
  const differences = rows.filter(
    (row) => typeof row.difference === 'number' && row.difference !== 0,
  );
  return finish(
    'cash',
    {
      columns: [
        col('opened_at', 'datetime'),
        col('closed_at', 'datetime'),
        col('opened_by', 'text'),
        col('closed_by', 'text'),
        col('sales_count', 'int'),
        col('sales_total', 'money'),
        col('opening_float', 'money'),
        col('cash_in', 'money'),
        col('card_in', 'money'),
        col('mobile_money_in', 'money'),
        col('transfer_in', 'money'),
        col('cheque_in', 'money'),
        col('cash_movements', 'money'),
        col('cash_refunds', 'money'),
        col('expected_amount', 'money'),
        col('counted_amount', 'money'),
        col('difference', 'money'),
      ],
      rows,
      totals: {
        opened_at: 'Total',
        sales_count: sum(rows, 'sales_count'),
        sales_total: sum(rows, 'sales_total'),
        cash_in: sum(rows, 'cash_in'),
        card_in: sum(rows, 'card_in'),
        mobile_money_in: sum(rows, 'mobile_money_in'),
        transfer_in: sum(rows, 'transfer_in'),
        cheque_in: sum(rows, 'cheque_in'),
        cash_refunds: sum(rows, 'cash_refunds'),
        difference: sum(rows, 'difference'),
      },
      summary: [
        { key: 'sessions_count', type: 'int', value: rows.length },
        { key: 'sales_total', type: 'money', value: sum(rows, 'sales_total') },
        { key: 'differences_count', type: 'int', value: differences.length },
        { key: 'difference', type: 'money', value: sum(rows, 'difference') },
      ],
      chart: null,
    },
    context,
  );
}

/** État des devis et des échéances (4.12) : devis en cours et échéances non soldées. */
export function followupsReport(db: Db, context: ReportContext): ReportResult {
  const today = localDay(context.now);
  const quotes = db
    .prepare<[string], ReportRow>(
      `SELECT 'quote' AS type, q.number, q.full_name AS customer, c.phone, q.valid_until AS date,
              q.total AS amount, q.total AS remaining,
              CAST(julianday(q.valid_until) - julianday(?) AS INTEGER) AS days
       FROM v_open_quotes q LEFT JOIN customers c ON c.id = q.customer_id
       ORDER BY q.valid_until`,
    )
    .all(today);
  const installments = db
    .prepare<[string], ReportRow>(
      `SELECT 'installment' AS type, s.invoice_number AS number, c.full_name AS customer, c.phone,
              i.due_date AS date, i.amount, i.amount - i.paid_amount AS remaining,
              CAST(julianday(i.due_date) - julianday(?) AS INTEGER) AS days
       FROM sale_installments i
       JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE i.paid_amount < i.amount
       ORDER BY i.due_date`,
    )
    .all(today);
  const overdue = installments.filter((row) => typeof row.days === 'number' && row.days < 0);
  return finish(
    'followups',
    {
      columns: [
        col('type', 'enum', { enumKey: 'followup' }),
        col('number', 'text'),
        col('customer', 'text'),
        col('phone', 'text'),
        col('date', 'date'),
        col('amount', 'money'),
        col('remaining', 'money'),
        col('days', 'int'),
      ],
      rows: [...installments, ...quotes],
      totals: null,
      summary: [
        { key: 'open_quotes', type: 'int', value: quotes.length },
        { key: 'quotes_total', type: 'money', value: sum(quotes, 'amount') },
        { key: 'installments_remaining', type: 'money', value: sum(installments, 'remaining') },
        { key: 'overdue', type: 'money', value: sum(overdue, 'remaining') },
      ],
      chart: null,
    },
    context,
  );
}
