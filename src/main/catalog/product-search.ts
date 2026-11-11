import { variantLabel } from '@shared/catalog/tree';
import type { Condition, ProductType, TrackingMode } from '@shared/catalog/constants';
import type { AttributeFilter, ProductRow, ProductSearchInput } from '@shared/schemas/catalog';
import type { Db } from '../db/types';

/**
 * Requête plein texte FTS5 à partir d'une saisie libre : chaque mot devient un préfixe,
 * entre guillemets (aucun opérateur FTS ne peut être injecté). null si aucun mot exploitable.
 */
export function ftsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  if (words.length === 0) return null;
  return words.map((word) => `"${word}"*`).join(' ');
}

const STOCK_EXPRESSION =
  'coalesce((SELECT sum(l.quantity) FROM stock_levels l WHERE l.variant_id = v.id), 0)';

const ORDER_BY: Readonly<Record<ProductSearchInput['sort'], string>> = {
  name: 'p.name COLLATE NOCASE, v.id',
  price_asc: 'v.sale_price, p.name COLLATE NOCASE, v.id',
  price_desc: 'v.sale_price DESC, p.name COLLATE NOCASE, v.id',
  stock_asc: 'stock, p.name COLLATE NOCASE, v.id',
  recent: 'v.id DESC',
};

interface Clause {
  sql: string;
  params: Record<string, unknown>;
}

function attributeClause(filter: AttributeFilter, index: number): Clause {
  const key = (name: string) => `attr${String(index)}_${name}`;
  const conditions = [`pav.attribute_id = @${key('id')}`];
  const params: Record<string, unknown> = { [key('id')]: filter.attributeId };
  if (filter.min !== undefined) {
    conditions.push(`pav.value_number >= @${key('min')}`);
    params[key('min')] = filter.min;
  }
  if (filter.max !== undefined) {
    conditions.push(`pav.value_number <= @${key('max')}`);
    params[key('max')] = filter.max;
  }
  if (typeof filter.equals === 'boolean') {
    conditions.push(`pav.value_number = @${key('eq')}`);
    params[key('eq')] = filter.equals ? 1 : 0;
  } else if (filter.equals !== undefined) {
    conditions.push(`pav.value_text = @${key('eq')} COLLATE NOCASE`);
    params[key('eq')] = filter.equals;
  }
  return {
    sql: `EXISTS (SELECT 1 FROM product_attribute_values pav WHERE pav.product_id = p.id AND ${conditions.join(' AND ')})`,
    params,
  };
}

/** Conditions du filtre ; `categoryIds` : catégorie choisie et sa descendance. */
function whereClauses(input: ProductSearchInput, categoryIds: readonly number[] | null): Clause[] {
  const clauses: Clause[] = [];
  if (categoryIds !== null) {
    clauses.push({
      sql: 'p.category_id IN (SELECT value FROM json_each(@categories))',
      params: { categories: JSON.stringify(categoryIds) },
    });
  }
  if (input.brandId !== undefined)
    clauses.push({ sql: 'p.brand_id = @brand', params: { brand: input.brandId } });
  if (input.productType !== undefined) {
    clauses.push({ sql: 'p.product_type = @type', params: { type: input.productType } });
  }
  if (input.excludeKits === true) clauses.push({ sql: "p.product_type <> 'kit'", params: {} });
  if (input.status === 'active')
    clauses.push({ sql: 'p.is_active = 1 AND v.is_active = 1', params: {} });
  if (input.status === 'archived')
    clauses.push({ sql: '(p.is_active = 0 OR v.is_active = 0)', params: {} });
  if (input.lowStock === true) {
    clauses.push({
      sql: `p.is_stocked = 1 AND p.reorder_level > 0 AND ${STOCK_EXPRESSION} <= p.reorder_level`,
      params: {},
    });
  }
  (input.attributeFilters ?? []).forEach((filter, index) =>
    clauses.push(attributeClause(filter, index)),
  );
  return clauses;
}

interface SearchRow {
  variant_id: number;
  product_id: number;
  name: string;
  brand_name: string | null;
  category_name: string;
  family_name: string;
  product_type: ProductType;
  tracking_mode: TrackingMode;
  sku: string;
  barcode: string | null;
  color: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  condition: Condition;
  sale_price: number;
  cost_price: number;
  stock: number;
  is_stocked: number;
  reorder_level: number;
  is_active: number;
}

/**
 * Avec une saisie, la lecture part des résultats plein texte (CROSS JOIN fixe l'ordre des tables) :
 * un « v.id IN (MATCH) » serait réévalué pour chaque variante.
 */
function fromClause(fts: string | null): string {
  const variants =
    fts === null
      ? 'FROM product_variants v'
      : `FROM (SELECT rowid AS id FROM products_fts WHERE products_fts MATCH @fts) hits
  CROSS JOIN product_variants v ON v.id = hits.id`;
  return `${variants}
  JOIN products p ON p.id = v.product_id
  LEFT JOIN brands b ON b.id = p.brand_id
  JOIN categories c ON c.id = p.category_id
  JOIN v_category_families f ON f.category_id = p.category_id`;
}

/**
 * Recherche paginée côté base (5.1) : une ligne par variante. Une saisie identique à un code-barres
 * ou une référence passe en tête (lecteur de codes-barres).
 */
export function searchProducts(
  db: Db,
  input: ProductSearchInput,
  categoryIds: readonly number[] | null,
  includeCost: boolean,
): { total: number; rows: ProductRow[] } {
  const clauses = whereClauses(input, categoryIds);
  const fts = input.query === undefined ? null : ftsQuery(input.query);
  const FROM = fromClause(fts);
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.map((c) => c.sql).join(' AND ')}`;
  const params = Object.assign(
    fts === null ? {} : { fts },
    ...clauses.map((clause) => clause.params),
  ) as Record<string, unknown>;
  const total =
    db
      .prepare<Record<string, unknown>, number>(`SELECT count(*) ${FROM} ${where}`)
      .pluck()
      .get(params) ?? 0;
  const exact = input.query === undefined || input.query === '' ? null : input.query;
  const order =
    exact === null
      ? ORDER_BY[input.sort]
      : `(v.barcode = @exact OR v.sku = @exact COLLATE NOCASE) DESC, ${ORDER_BY[input.sort]}`;
  const rows = db
    .prepare<Record<string, unknown>, SearchRow>(
      `SELECT v.id AS variant_id, p.id AS product_id, p.name, b.name AS brand_name,
              c.name AS category_name, f.family_name, p.product_type, p.tracking_mode, v.sku,
              v.barcode, v.color, v.storage_gb, v.ram_gb, v.condition, v.sale_price, v.cost_price,
              ${STOCK_EXPRESSION} AS stock, p.is_stocked, p.reorder_level,
              (p.is_active = 1 AND v.is_active = 1) AS is_active
       ${FROM} ${where}
       ORDER BY ${order}
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      ...params,
      ...(exact === null ? {} : { exact }),
      limit: input.limit,
      offset: input.offset,
    });
  return {
    total,
    rows: rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      name: row.name,
      brandName: row.brand_name,
      categoryName: row.category_name,
      familyName: row.family_name,
      productType: row.product_type,
      trackingMode: row.tracking_mode,
      sku: row.sku,
      barcode: row.barcode,
      variantLabel: variantLabel({
        color: row.color,
        storageGb: row.storage_gb,
        ramGb: row.ram_gb,
        condition: row.condition,
      }),
      salePrice: row.sale_price,
      costPrice: includeCost ? row.cost_price : null,
      stock: row.stock,
      isStocked: row.is_stocked === 1,
      reorderLevel: row.reorder_level,
      isActive: row.is_active === 1,
    })),
  };
}
