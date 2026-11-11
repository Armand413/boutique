import type { ReportRequest, ReportResult, ReportRow } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { dayCount, utcBounds } from './period';
import { col, finish, marginRate, sum, type ReportContext } from './report-kit';

type SalesRequest = Extract<ReportRequest, { kind: 'sales' }>;
type ProductsRequest = Extract<ReportRequest, { kind: 'products' }>;

/** Regroupement : clé, libellé et jointure nécessaire (expressions fixes, jamais saisies). */
const GROUPS: Readonly<
  Record<SalesRequest['groupBy'], { key: string; label: string; join: string }>
> = {
  day: { key: 'n.day', label: 'n.day', join: '' },
  month: { key: 'substr(n.day, 1, 7)', label: 'substr(n.day, 1, 7)', join: '' },
  seller: { key: 'n.user_id', label: 'u.full_name', join: 'JOIN users u ON u.id = n.user_id' },
  family: { key: 'n.family_id', label: 'n.family_name', join: '' },
  category: {
    key: 'n.category_id',
    label: 'c.name',
    join: 'JOIN categories c ON c.id = n.category_id',
  },
  brand: {
    key: 'n.brand_id',
    label: "coalesce(b.name, 'Sans marque')",
    join: 'LEFT JOIN brands b ON b.id = n.brand_id',
  },
  product: { key: 'n.product_id', label: 'p.name', join: 'JOIN products p ON p.id = n.product_id' },
};

interface SalesRow {
  label: string;
  sales_count: number;
  quantity: number;
  revenue_ttc: number;
  revenue: number;
  cost: number;
  margin: number;
}

/** Ventes par période, vendeur, famille, catégorie, marque ou produit (4.8, 4.12), HT nettes des retours. */
export function salesReport(db: Db, request: SalesRequest, context: ReportContext): ReportResult {
  const group = GROUPS[request.groupBy];
  const [from, to] = utcBounds(request.period);
  const chronological = request.groupBy === 'day' || request.groupBy === 'month';
  const rows = db
    .prepare<[string, string], SalesRow>(
      `SELECT ${group.label} AS label, count(DISTINCT n.sale_id) AS sales_count,
              sum(n.quantity) AS quantity, sum(n.revenue_ttc) AS revenue_ttc, sum(n.revenue) AS revenue,
              sum(n.cost) AS cost, sum(n.margin) AS margin
       FROM v_sale_lines_net n ${group.join}
       WHERE n.completed_at >= ? AND n.completed_at < ?
       GROUP BY ${group.key}
       ORDER BY ${chronological ? 'label' : 'revenue_ttc DESC, label'}`,
    )
    .all(from, to)
    .map((row): ReportRow => ({ ...row, margin_rate: marginRate(row.margin, row.revenue) }));
  const totals = db
    .prepare<[string, string], Omit<SalesRow, 'label'>>(
      `SELECT count(DISTINCT n.sale_id) AS sales_count, coalesce(sum(n.quantity), 0) AS quantity,
              coalesce(sum(n.revenue_ttc), 0) AS revenue_ttc, coalesce(sum(n.revenue), 0) AS revenue,
              coalesce(sum(n.cost), 0) AS cost, coalesce(sum(n.margin), 0) AS margin
       FROM v_sale_lines_net n WHERE n.completed_at >= ? AND n.completed_at < ?`,
    )
    .get(from, to) ?? {
    sales_count: 0,
    quantity: 0,
    revenue_ttc: 0,
    revenue: 0,
    cost: 0,
    margin: 0,
  };
  return finish(
    'sales',
    {
      columns: [
        col('label', 'text'),
        col('sales_count', 'int'),
        col('quantity', 'int'),
        col('revenue_ttc', 'money'),
        col('revenue', 'money'),
        col('cost', 'money', { sensitive: true }),
        col('margin', 'money', { sensitive: true }),
        col('margin_rate', 'percent', { sensitive: true }),
      ],
      rows,
      totals: { label: 'Total', ...totals, margin_rate: marginRate(totals.margin, totals.revenue) },
      summary: [
        { key: 'sales_count', type: 'int', value: totals.sales_count },
        { key: 'revenue_ttc', type: 'money', value: totals.revenue_ttc },
        { key: 'revenue', type: 'money', value: totals.revenue },
        { key: 'margin', type: 'money', value: totals.margin, sensitive: true },
      ],
      chart: {
        type: chronological ? 'line' : 'bar',
        labelKey: 'label',
        series: ['revenue_ttc', 'margin'],
      },
    },
    context,
  );
}

interface ProductRow {
  product: string;
  sku: string;
  brand: string | null;
  family: string;
  quantity: number;
  revenue_ttc: number;
  margin: number | null;
  stock: number;
}

/**
 * Produits les plus ou les moins vendus (rotation, 4.8) : les moins vendus partent de tout le
 * catalogue stocké actif, y compris les articles jamais vendus sur la période.
 */
export function productsReport(
  db: Db,
  request: ProductsRequest,
  context: ReportContext,
): ReportResult {
  const [from, to] = utcBounds(request.period);
  const best = request.order === 'best';
  const raw = db
    .prepare<[string, string], ProductRow>(
      `WITH sold AS (
         SELECT n.variant_id, sum(n.quantity) AS quantity, sum(n.revenue_ttc) AS revenue_ttc, sum(n.margin) AS margin
         FROM v_sale_lines_net n WHERE n.completed_at >= ? AND n.completed_at < ?
         GROUP BY n.variant_id),
       stock AS (SELECT variant_id, sum(quantity) AS quantity FROM stock_levels GROUP BY variant_id)
       SELECT p.name AS product, v.sku, b.name AS brand, f.family_name AS family,
              coalesce(s.quantity, 0) AS quantity, coalesce(s.revenue_ttc, 0) AS revenue_ttc,
              s.margin, coalesce(st.quantity, 0) AS stock
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
       JOIN v_category_families f ON f.category_id = p.category_id
       LEFT JOIN sold s ON s.variant_id = v.id
       LEFT JOIN stock st ON st.variant_id = v.id
       WHERE ${best ? 's.quantity > 0' : 'p.is_stocked = 1 AND p.is_active = 1 AND v.is_active = 1'}
       ORDER BY quantity ${best ? 'DESC' : 'ASC'}, revenue_ttc ${best ? 'DESC' : 'ASC'}, stock DESC, p.name`,
    )
    .all(from, to);
  const days = dayCount(request.period);
  const rows = raw.map((row): ReportRow => ({
    ...row,
    coverage_days:
      row.quantity > 0 && row.stock > 0 ? Math.round((row.stock * days) / row.quantity) : null,
  }));
  return finish(
    'products',
    {
      columns: [
        col('product', 'text'),
        col('sku', 'text'),
        col('brand', 'text'),
        col('family', 'text'),
        col('quantity', 'int'),
        col('revenue_ttc', 'money'),
        col('margin', 'money', { sensitive: true }),
        col('stock', 'int'),
        col('coverage_days', 'int'),
      ],
      rows,
      totals: {
        product: 'Total',
        quantity: sum(rows, 'quantity'),
        revenue_ttc: sum(rows, 'revenue_ttc'),
        margin: sum(rows, 'margin'),
        stock: sum(rows, 'stock'),
      },
      summary: [
        { key: 'products_count', type: 'int', value: rows.length },
        { key: 'quantity', type: 'int', value: sum(rows, 'quantity') },
        { key: 'unsold', type: 'int', value: rows.filter((row) => row.quantity === 0).length },
      ],
      chart: { type: 'bar', labelKey: 'product', series: ['quantity'] },
    },
    context,
  );
}
