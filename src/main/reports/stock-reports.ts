import type { ReportRequest, ReportResult } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { utcBounds } from './period';
import { col, finish, sum, type ReportContext } from './report-kit';

type StockRequest = Extract<ReportRequest, { kind: 'stock' }>;
type MovementsRequest = Extract<ReportRequest, { kind: 'movements' }>;

const STOCK_GROUPS: Readonly<Record<StockRequest['groupBy'], { key: string; label: string }>> = {
  family: { key: 'f.family_id', label: 'f.family_name' },
  category: { key: 'c.id', label: 'c.name' },
  brand: { key: 'p.brand_id', label: "coalesce(b.name, 'Sans marque')" },
  location: { key: 'sl.id', label: 'sl.name' },
};

/** Valorisation du stock (4.3, 4.8) au coût moyen pondéré et au prix de vente. */
export function stockReport(db: Db, request: StockRequest, context: ReportContext): ReportResult {
  const group = STOCK_GROUPS[request.groupBy];
  const rows = db
    .prepare<
      [],
      {
        label: string;
        products: number;
        quantity: number;
        retail_value: number;
        stock_value: number;
      }
    >(
      `SELECT ${group.label} AS label, count(DISTINCT l.variant_id) AS products, sum(l.quantity) AS quantity,
              sum(l.quantity * v.sale_price) AS retail_value, sum(l.quantity * v.avg_cost) AS stock_value
       FROM stock_levels l
       JOIN stock_locations sl ON sl.id = l.location_id
       JOIN product_variants v ON v.id = l.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN categories c ON c.id = p.category_id
       JOIN v_category_families f ON f.category_id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE l.quantity > 0
       GROUP BY ${group.key}
       ORDER BY stock_value DESC, label`,
    )
    .all();
  const totals = {
    label: 'Total',
    products: sum(rows, 'products'),
    quantity: sum(rows, 'quantity'),
    retail_value: sum(rows, 'retail_value'),
    stock_value: sum(rows, 'stock_value'),
  };
  return finish(
    'stock',
    {
      columns: [
        col('label', 'text'),
        col('products', 'int'),
        col('quantity', 'int'),
        col('retail_value', 'money'),
        col('stock_value', 'money', { sensitive: true }),
      ],
      rows,
      totals,
      summary: [
        { key: 'quantity', type: 'int', value: totals.quantity },
        { key: 'retail_value', type: 'money', value: totals.retail_value },
        { key: 'stock_value', type: 'money', value: totals.stock_value, sensitive: true },
      ],
      chart: { type: 'bar', labelKey: 'label', series: ['stock_value', 'retail_value'] },
    },
    context,
  );
}

/** Journal des mouvements de stock (4.8) sur une période, filtrable par type. */
export function movementsReport(
  db: Db,
  request: MovementsRequest,
  context: ReportContext,
): ReportResult {
  const [from, to] = utcBounds(request.period);
  const limit = context.limit === null ? -1 : context.limit + 1;
  const rows = db
    .prepare<
      [string, string, string | null, string | null, number],
      Record<string, string | number | null>
    >(
      `SELECT m.created_at, p.name AS product, v.sku, u.serial_number AS serial, sl.name AS location,
              m.movement_type, m.quantity_delta AS quantity, m.quantity_after, m.unit_cost,
              m.reason, us.full_name AS user
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN stock_locations sl ON sl.id = m.location_id
       JOIN users us ON us.id = m.user_id
       LEFT JOIN serial_units u ON u.id = m.serial_unit_id
       WHERE m.created_at >= ? AND m.created_at < ? AND (? IS NULL OR m.movement_type = ?)
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ?`,
    )
    .all(from, to, request.movementType, request.movementType, limit);
  const counts = db
    .prepare<
      [string, string, string | null, string | null],
      { entries: number; exits: number; count: number }
    >(
      `SELECT count(*) AS count,
              coalesce(sum(CASE WHEN quantity_delta > 0 THEN quantity_delta ELSE 0 END), 0) AS entries,
              coalesce(sum(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END), 0) AS exits
       FROM stock_movements m
       WHERE m.created_at >= ? AND m.created_at < ? AND (? IS NULL OR m.movement_type = ?)`,
    )
    .get(from, to, request.movementType, request.movementType) ?? {
    count: 0,
    entries: 0,
    exits: 0,
  };
  return finish(
    'movements',
    {
      columns: [
        col('created_at', 'datetime'),
        col('product', 'text'),
        col('sku', 'text'),
        col('serial', 'text'),
        col('location', 'text'),
        col('movement_type', 'enum', { enumKey: 'movement' }),
        col('quantity', 'int'),
        col('quantity_after', 'int'),
        col('unit_cost', 'money', { sensitive: true }),
        col('reason', 'text'),
        col('user', 'text'),
      ],
      rows,
      totals: null,
      summary: [
        { key: 'movements_count', type: 'int', value: counts.count },
        { key: 'entries', type: 'int', value: counts.entries },
        { key: 'exits', type: 'int', value: counts.exits },
      ],
      chart: null,
    },
    context,
  );
}
