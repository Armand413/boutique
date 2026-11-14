import type { ReportRequest, ReportResult, ReportRow } from '@shared/schemas/reports';
import type { Db } from '../db/types';
import { utcBounds } from './period';
import { col, finish, sum, type ReportContext } from './report-kit';

type StockRequest = Extract<ReportRequest, { kind: 'stock' }>;
type MovementsRequest = Extract<ReportRequest, { kind: 'movements' }>;
type InventoryRequest = Extract<ReportRequest, { kind: 'inventory' }>;

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

/** Mouvements regroupés pour l'inventaire automatique (les transferts s'annulent entre emplacements). */
const ENTRY_TYPES = "('purchase', 'sale_return')";
const OTHER_OUT_TYPES = "('purchase_return', 'loss', 'damage', 'theft', 'internal_use')";
const CORRECTION_TYPES = "('adjustment', 'inventory')";

/**
 * Inventaire automatique (D95) : pour chaque article stocké, stock au début de la période, entrées,
 * ventes, autres sorties, corrections et stock restant à la fin, tous calculés à partir des
 * mouvements enregistrés par l'application ; valeur au prix de vente et au coût moyen, alerte de
 * stock bas. Aucun comptage : le stock restant est celui que l'application connaît.
 */
export function inventoryReport(
  db: Db,
  request: InventoryRequest,
  context: ReportContext,
): ReportResult {
  const [from, to] = utcBounds(request.period);
  const inPeriod = 'm.created_at >= @from AND m.created_at < @to';
  const raw = db
    .prepare<
      { from: string; to: string },
      {
        family: string;
        product: string;
        sku: string;
        opening: number;
        entries: number;
        sold: number;
        other_out: number;
        corrections: number;
        closing: number;
        reorder_level: number;
        retail_value: number;
        stock_value: number;
      }
    >(
      `WITH m AS (
         SELECT m.variant_id,
                sum(CASE WHEN m.created_at < @from THEN m.quantity_delta ELSE 0 END) AS opening,
                sum(CASE WHEN ${inPeriod} AND m.movement_type IN ${ENTRY_TYPES} THEN m.quantity_delta ELSE 0 END) AS entries,
                sum(CASE WHEN ${inPeriod} AND m.movement_type = 'sale' THEN -m.quantity_delta ELSE 0 END) AS sold,
                sum(CASE WHEN ${inPeriod} AND m.movement_type IN ${OTHER_OUT_TYPES} THEN -m.quantity_delta ELSE 0 END) AS other_out,
                sum(CASE WHEN ${inPeriod} AND m.movement_type IN ${CORRECTION_TYPES} THEN m.quantity_delta ELSE 0 END) AS corrections,
                sum(m.quantity_delta) AS closing
         FROM stock_movements m WHERE m.created_at < @to
         GROUP BY m.variant_id)
       SELECT f.family_name AS family,
              p.name || coalesce(' · ' || v.color, '') || coalesce(' · ' || v.storage_gb || ' Go', '') AS product,
              v.sku, coalesce(m.opening, 0) AS opening, coalesce(m.entries, 0) AS entries,
              coalesce(m.sold, 0) AS sold, coalesce(m.other_out, 0) AS other_out,
              coalesce(m.corrections, 0) AS corrections, coalesce(m.closing, 0) AS closing,
              p.reorder_level,
              coalesce(m.closing, 0) * v.sale_price AS retail_value,
              coalesce(m.closing, 0) * v.avg_cost AS stock_value
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN v_category_families f ON f.category_id = p.category_id
       LEFT JOIN m ON m.variant_id = v.id
       WHERE p.is_stocked = 1 AND ((p.is_active = 1 AND v.is_active = 1) OR m.variant_id IS NOT NULL)
       ORDER BY f.family_name, p.name, v.sku`,
    )
    .all({ from, to });
  const rows = raw.map(({ reorder_level, ...row }): ReportRow => ({
    ...row,
    alert: row.closing <= reorder_level ? 'Stock bas' : '',
  }));
  const lowStock = rows.filter((row) => row.alert !== '').length;
  return finish(
    'inventory',
    {
      columns: [
        col('family', 'text'),
        col('product', 'text'),
        col('sku', 'text'),
        col('opening', 'int'),
        col('entries', 'int'),
        col('sold', 'int'),
        col('other_out', 'int'),
        col('corrections', 'int'),
        col('closing', 'int'),
        col('alert', 'text'),
        col('retail_value', 'money'),
        col('stock_value', 'money', { sensitive: true }),
      ],
      rows,
      totals: {
        family: 'Total',
        opening: sum(rows, 'opening'),
        entries: sum(rows, 'entries'),
        sold: sum(rows, 'sold'),
        other_out: sum(rows, 'other_out'),
        corrections: sum(rows, 'corrections'),
        closing: sum(rows, 'closing'),
        retail_value: sum(rows, 'retail_value'),
        stock_value: sum(rows, 'stock_value'),
      },
      summary: [
        { key: 'products_count', type: 'int', value: rows.length },
        { key: 'closing', type: 'int', value: sum(rows, 'closing') },
        { key: 'low_stock', type: 'int', value: lowStock },
        { key: 'retail_value', type: 'money', value: sum(rows, 'retail_value') },
        { key: 'stock_value', type: 'money', value: sum(rows, 'stock_value'), sensitive: true },
      ],
    },
    context,
  );
}
