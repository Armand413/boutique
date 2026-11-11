import { AppError } from '@shared/ipc/errors';
import { variantLabel } from '@shared/catalog/tree';
import type { Condition } from '@shared/catalog/constants';
import type { SaleDetail, SaleListInput, SaleSummary } from '@shared/schemas/sales';
import type { PaymentMethod } from '@shared/schemas/stock';
import type { Db } from '../db/types';
import { includedTax } from './pricing';

interface SaleRow {
  id: number;
  invoice_number: string | null;
  status: SaleDetail['status'];
  customer_id: number | null;
  full_name: string | null;
  phone: string | null;
  user_name: string;
  completed_at: string | null;
  subtotal: number;
  discount_total: number;
  total: number;
  amount_paid: number;
  due_date: string | null;
  cancel_reason: string | null;
  session_status: string | null;
}

/** Détail complet d'une vente ; coûts et marge seulement avec cost.view. */
export function readSaleDetail(db: Db, saleId: number, withCost: boolean): SaleDetail {
  const sale = db
    .prepare<[number], SaleRow>(
      `SELECT s.id, s.invoice_number, s.status, s.customer_id, c.full_name, c.phone, u.full_name AS user_name,
              s.completed_at, s.subtotal, s.discount_total, s.total, s.amount_paid, s.due_date, s.cancel_reason,
              cs.status AS session_status
       FROM sales s JOIN users u ON u.id = s.user_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN cash_sessions cs ON cs.id = s.cash_session_id
       WHERE s.id = ?`,
    )
    .get(saleId);
  if (sale === undefined) throw new AppError('NOT_FOUND', 'Vente introuvable.');
  const lines = db
    .prepare<
      [number],
      {
        id: number;
        parent_line_id: number | null;
        line_type: SaleDetail['lines'][number]['lineType'];
        variant_id: number;
        name: string;
        sku: string;
        color: string | null;
        storage_gb: number | null;
        ram_gb: number | null;
        condition: Condition;
        serial_number: string | null;
        warranty_end: string | null;
        quantity: number;
        unit_price: number;
        discount: number;
        line_total: number;
        tax_rate: number;
        unit_cost: number;
        returned: number;
      }
    >(
      `SELECT l.id, l.parent_line_id, l.line_type, l.variant_id, p.name, v.sku, v.color, v.storage_gb, v.ram_gb, v.condition,
              su.serial_number, su.warranty_end, l.quantity, l.unit_price, l.discount, l.line_total, l.tax_rate, l.unit_cost,
              coalesce((SELECT sum(r.quantity) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS returned
       FROM sale_lines l
       JOIN product_variants v ON v.id = l.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN serial_units su ON su.id = l.serial_unit_id
       WHERE l.sale_id = ? ORDER BY coalesce(l.parent_line_id, l.id), l.id`,
    )
    .all(saleId);
  const payments = db
    .prepare<
      [number],
      {
        id: number;
        method: PaymentMethod;
        amount: number;
        reference: string | null;
        paid_at: string;
      }
    >('SELECT id, method, amount, reference, paid_at FROM payments WHERE sale_id = ? ORDER BY id')
    .all(saleId);
  const returns = db
    .prepare<
      [number],
      {
        id: number;
        number: string;
        reason: string;
        refund_amount: number;
        refund_method: string | null;
        created_at: string;
      }
    >(
      'SELECT id, number, reason, refund_amount, refund_method, created_at FROM sale_returns WHERE sale_id = ? ORDER BY id',
    )
    .all(saleId);
  const delivery = db
    .prepare<
      [number],
      {
        id: number;
        address: string;
        status: 'to_deliver' | 'delivered' | 'cancelled';
        scheduled_at: string | null;
      }
    >(
      'SELECT id, address, status, scheduled_at FROM deliveries WHERE sale_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(saleId);
  const paidToDate = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const creditNotes = returns
    .filter((r) => r.refund_method === 'credit_note')
    .reduce((sum, r) => sum + r.refund_amount, 0);
  const cost = lines
    .filter((line) => line.line_type !== 'kit')
    .reduce((sum, line) => sum + line.quantity * line.unit_cost, 0);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: sale.id,
    invoiceNumber: sale.invoice_number,
    status: sale.status,
    customer:
      sale.customer_id === null
        ? null
        : { id: sale.customer_id, fullName: sale.full_name ?? '', phone: sale.phone },
    userName: sale.user_name,
    completedAt: sale.completed_at,
    subtotal: sale.subtotal,
    discountTotal: sale.discount_total,
    total: sale.total,
    taxIncluded: lines
      .filter((line) => line.line_type !== 'kit_component')
      .reduce((sum, line) => sum + includedTax(line.line_total, line.tax_rate), 0),
    amountPaid: sale.amount_paid,
    paidToDate,
    remaining: sale.status === 'completed' ? sale.total - paidToDate - creditNotes : 0,
    dueDate: sale.due_date,
    margin: withCost ? sale.subtotal - sale.discount_total - cost : null,
    cancelReason: sale.cancel_reason,
    lines: lines.map((line) => ({
      id: line.id,
      parentLineId: line.parent_line_id,
      lineType: line.line_type,
      variantId: line.variant_id,
      name: line.name,
      variantLabel: variantLabel({
        color: line.color,
        storageGb: line.storage_gb,
        ramGb: line.ram_gb,
        condition: line.condition,
      }),
      sku: line.sku,
      serialNumber: line.serial_number,
      warrantyEnd: line.warranty_end,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      discount: line.discount,
      lineTotal: line.line_total,
      taxRate: line.tax_rate,
      taxIncluded: includedTax(line.line_total, line.tax_rate),
      unitCost: withCost ? line.unit_cost : null,
      returnedQuantity: line.returned,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
      paidAt: payment.paid_at,
    })),
    installments: db
      .prepare<
        [number],
        {
          id: number;
          due_date: string;
          amount: number;
          paid_amount: number;
          status: 'pending' | 'partial' | 'paid' | 'overdue';
        }
      >(
        'SELECT id, due_date, amount, paid_amount, status FROM sale_installments WHERE sale_id = ? ORDER BY due_date, id',
      )
      .all(saleId)
      .map((item) => ({
        id: item.id,
        dueDate: item.due_date,
        amount: item.amount,
        paidAmount: item.paid_amount,
        status: item.paid_amount < item.amount && item.due_date < today ? 'overdue' : item.status,
      })),
    delivery:
      delivery === undefined
        ? null
        : {
            id: delivery.id,
            address: delivery.address,
            status: delivery.status,
            scheduledAt: delivery.scheduled_at,
          },
    returns: returns.map((item) => ({
      id: item.id,
      number: item.number,
      reason: item.reason,
      refundAmount: item.refund_amount,
      createdAt: item.created_at,
    })),
    cancellable:
      sale.status === 'completed' && sale.session_status === 'open' && returns.length === 0,
  };
}

/** Historique des ventes (A.4 Ventes), filtré, du plus récent au plus ancien. */
export function listSales(db: Db, input: SaleListInput): SaleSummary[] {
  const conditions = ["s.status <> 'held'"];
  const params: Record<string, unknown> = { limit: input.limit };
  if (input.status !== 'all') {
    conditions.push('s.status = @status');
    params.status = input.status;
  }
  if (input.query !== undefined && input.query !== '') {
    conditions.push(
      "(s.invoice_number LIKE @query ESCAPE '\\' OR c.full_name LIKE @query ESCAPE '\\' OR c.phone LIKE @query ESCAPE '\\')",
    );
    params.query = `%${input.query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  }
  if (input.customerId !== undefined) {
    conditions.push('s.customer_id = @customer');
    params.customer = input.customerId;
  }
  if (input.from !== undefined) {
    conditions.push("date(s.completed_at, 'localtime') >= @from");
    params.from = input.from;
  }
  if (input.to !== undefined) {
    conditions.push("date(s.completed_at, 'localtime') <= @to");
    params.to = input.to;
  }
  if (input.beforeId !== undefined) {
    conditions.push('s.id < @before');
    params.before = input.beforeId;
  }
  return db
    .prepare<
      Record<string, unknown>,
      {
        id: number;
        invoice_number: string;
        status: 'completed' | 'cancelled';
        completed_at: string;
        customer_name: string | null;
        user_name: string;
        total: number;
        remaining: number;
        item_count: number;
      }
    >(
      `SELECT s.id, s.invoice_number, s.status, s.completed_at, c.full_name AS customer_name, u.full_name AS user_name, s.total,
              CASE WHEN s.status = 'completed' THEN s.total
                - coalesce((SELECT sum(p.amount) FROM payments p WHERE p.sale_id = s.id), 0)
                - coalesce((SELECT sum(r.refund_amount) FROM sale_returns r WHERE r.sale_id = s.id AND r.refund_method = 'credit_note'), 0)
              ELSE 0 END AS remaining,
              (SELECT coalesce(sum(l.quantity), 0) FROM sale_lines l WHERE l.sale_id = s.id AND l.line_type <> 'kit_component') AS item_count
       FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.id DESC LIMIT @limit`,
    )
    .all(params)
    .map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      completedAt: row.completed_at,
      customerName: row.customer_name,
      userName: row.user_name,
      total: row.total,
      remaining: row.remaining,
      itemCount: row.item_count,
    }));
}
