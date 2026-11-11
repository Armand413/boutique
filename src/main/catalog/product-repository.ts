import { nowIsoUtc } from '@shared/format/date';
import { variantLabel } from '@shared/catalog/tree';
import {
  SERIAL_STATUSES,
  type Condition,
  type ProductType,
  type SerialStatus,
  type TrackingMode,
} from '@shared/catalog/constants';
import type { KitComponent, SerialUnit } from '@shared/schemas/catalog';
import type { Db } from '../db/types';
import type { StoredAttributeValue } from './attribute-values';

export interface ProductFields {
  name: string;
  brandId: number | null;
  categoryId: number;
  model: string | null;
  description: string | null;
  productType: ProductType;
  trackingMode: TrackingMode;
  isStocked: boolean;
  taxRateId: number | null;
  reorderLevel: number;
  warrantyMonths: number;
  weightKg: number | null;
}

export interface ProductRecord extends ProductFields {
  id: number;
  brandName: string | null;
  imagePath: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow {
  id: number;
  name: string;
  brand_id: number | null;
  brand_name: string | null;
  category_id: number;
  model: string | null;
  description: string | null;
  product_type: ProductType;
  tracking_mode: TrackingMode;
  is_stocked: number;
  tax_rate_id: number | null;
  reorder_level: number;
  warranty_months: number;
  weight_kg: number | null;
  image_path: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function findProduct(db: Db, id: number): ProductRecord | null {
  const row = db
    .prepare<[number], ProductRow>(
      `SELECT p.*, b.name AS brand_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = ?`,
    )
    .get(id);
  if (row === undefined) return null;
  return {
    id: row.id,
    name: row.name,
    brandId: row.brand_id,
    brandName: row.brand_name,
    categoryId: row.category_id,
    model: row.model,
    description: row.description,
    productType: row.product_type,
    trackingMode: row.tracking_mode,
    isStocked: row.is_stocked === 1,
    taxRateId: row.tax_rate_id,
    reorderLevel: row.reorder_level,
    warrantyMonths: row.warranty_months,
    weightKg: row.weight_kg,
    imagePath: row.image_path,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function productParams(fields: ProductFields) {
  return {
    name: fields.name,
    brandId: fields.brandId,
    categoryId: fields.categoryId,
    model: fields.model,
    description: fields.description,
    productType: fields.productType,
    trackingMode: fields.trackingMode,
    isStocked: fields.isStocked ? 1 : 0,
    taxRateId: fields.taxRateId,
    reorderLevel: fields.reorderLevel,
    warrantyMonths: fields.warrantyMonths,
    weightKg: fields.weightKg,
    now: nowIsoUtc(),
  };
}

export function insertProduct(db: Db, fields: ProductFields, userId: number): number {
  const result = db
    .prepare(
      `INSERT INTO products (name, brand_id, category_id, model, description, product_type,
         tracking_mode, is_stocked, tax_rate_id, reorder_level, warranty_months, weight_kg,
         created_at, updated_at, created_by)
       VALUES (@name, @brandId, @categoryId, @model, @description, @productType, @trackingMode,
               @isStocked, @taxRateId, @reorderLevel, @warrantyMonths, @weightKg, @now, @now, @userId)`,
    )
    .run({ ...productParams(fields), userId });
  return Number(result.lastInsertRowid);
}

export function updateProduct(db: Db, id: number, fields: ProductFields): void {
  db.prepare(
    `UPDATE products SET name = @name, brand_id = @brandId, category_id = @categoryId,
       model = @model, description = @description, product_type = @productType,
       tracking_mode = @trackingMode, is_stocked = @isStocked, tax_rate_id = @taxRateId,
       reorder_level = @reorderLevel, warranty_months = @warrantyMonths, weight_kg = @weightKg,
       updated_at = @now
     WHERE id = @id`,
  ).run({ ...productParams(fields), id });
}

export function setProductActive(db: Db, id: number, isActive: boolean): void {
  db.prepare('UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?').run(
    isActive ? 1 : 0,
    nowIsoUtc(),
    id,
  );
}

export function setProductImage(db: Db, id: number, imagePath: string | null): void {
  db.prepare('UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?').run(
    imagePath,
    nowIsoUtc(),
    id,
  );
}

/** Même condition que le trigger trg_products_type_locked. */
export function isTypeLocked(db: Db, productId: number): boolean {
  return (
    db
      .prepare<{ id: number }, number>(
        `SELECT EXISTS (SELECT 1 FROM product_variants v JOIN stock_movements m ON m.variant_id = v.id
                        WHERE v.product_id = @id)
             OR EXISTS (SELECT 1 FROM product_variants v JOIN serial_units s ON s.variant_id = v.id
                        WHERE v.product_id = @id)
             OR EXISTS (SELECT 1 FROM product_variants v JOIN sale_lines l ON l.variant_id = v.id
                        WHERE v.product_id = @id)`,
      )
      .pluck()
      .get({ id: productId }) === 1
  );
}

export function readAttributeValues(db: Db, productId: number): StoredAttributeValue[] {
  return db
    .prepare<
      [number],
      { attribute_id: number; value_text: string | null; value_number: number | null }
    >(
      'SELECT attribute_id, value_text, value_number FROM product_attribute_values WHERE product_id = ?',
    )
    .all(productId)
    .map((row) => ({
      attributeId: row.attribute_id,
      valueText: row.value_text,
      valueNumber: row.value_number,
    }));
}

/** Remplace l'ensemble des caractéristiques d'un produit (valeurs, pas données métier historisées). */
export function replaceAttributeValues(
  db: Db,
  productId: number,
  values: readonly StoredAttributeValue[],
): void {
  db.prepare('DELETE FROM product_attribute_values WHERE product_id = ?').run(productId);
  const insert = db.prepare(
    `INSERT INTO product_attribute_values (product_id, attribute_id, value_text, value_number)
     VALUES (?, ?, ?, ?)`,
  );
  for (const value of values)
    insert.run(productId, value.attributeId, value.valueText, value.valueNumber);
}

export interface VariantFields {
  sku: string;
  barcode: string | null;
  color: string | null;
  storageGb: number | null;
  ramGb: number | null;
  condition: Condition;
  costPrice: number;
  salePrice: number;
  minSalePrice: number;
  isActive: boolean;
}

export interface VariantRecord extends VariantFields {
  id: number;
  productId: number;
  avgCost: number;
}

interface VariantRow {
  id: number;
  product_id: number;
  sku: string;
  barcode: string | null;
  color: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  condition: Condition;
  cost_price: number;
  avg_cost: number;
  sale_price: number;
  min_sale_price: number;
  is_active: number;
}

function toVariant(row: VariantRow): VariantRecord {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    barcode: row.barcode,
    color: row.color,
    storageGb: row.storage_gb,
    ramGb: row.ram_gb,
    condition: row.condition,
    costPrice: row.cost_price,
    avgCost: row.avg_cost,
    salePrice: row.sale_price,
    minSalePrice: row.min_sale_price,
    isActive: row.is_active === 1,
  };
}

export function listVariants(db: Db, productId: number): VariantRecord[] {
  return db
    .prepare<[number], VariantRow>(
      'SELECT * FROM product_variants WHERE product_id = ? ORDER BY id',
    )
    .all(productId)
    .map(toVariant);
}

export function findVariant(db: Db, id: number): VariantRecord | null {
  const row = db
    .prepare<[number], VariantRow>('SELECT * FROM product_variants WHERE id = ?')
    .get(id);
  return row === undefined ? null : toVariant(row);
}

export function skuExists(db: Db, sku: string): boolean {
  return (
    db
      .prepare<[string], number>(
        'SELECT EXISTS (SELECT 1 FROM product_variants WHERE sku = ? COLLATE NOCASE)',
      )
      .pluck()
      .get(sku) === 1
  );
}

export function barcodeOwner(db: Db, barcode: string): number | null {
  return (
    db
      .prepare<[string], number>('SELECT id FROM product_variants WHERE barcode = ?')
      .pluck()
      .get(barcode) ?? null
  );
}

/** Référence interne générée : P000042-1, P000042-2... (première libre). */
export function generateSku(db: Db, productId: number): string {
  const prefix = `P${String(productId).padStart(6, '0')}`;
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}-${String(index)}`;
    if (!skuExists(db, candidate)) return candidate;
  }
}

function variantParams(fields: VariantFields) {
  return {
    sku: fields.sku,
    barcode: fields.barcode,
    color: fields.color,
    storageGb: fields.storageGb,
    ramGb: fields.ramGb,
    condition: fields.condition,
    costPrice: fields.costPrice,
    salePrice: fields.salePrice,
    minSalePrice: fields.minSalePrice,
    isActive: fields.isActive ? 1 : 0,
    now: nowIsoUtc(),
  };
}

/** Le coût moyen part du prix d'achat ; les réceptions de marchandise le recalculent ensuite. */
export function insertVariant(
  db: Db,
  productId: number,
  fields: VariantFields,
  userId: number,
): number {
  const result = db
    .prepare(
      `INSERT INTO product_variants (product_id, sku, barcode, color, storage_gb, ram_gb, condition,
         cost_price, avg_cost, sale_price, min_sale_price, is_active, created_at, updated_at, created_by)
       VALUES (@productId, @sku, @barcode, @color, @storageGb, @ramGb, @condition, @costPrice,
               @costPrice, @salePrice, @minSalePrice, @isActive, @now, @now, @userId)`,
    )
    .run({ ...variantParams(fields), productId, userId });
  return Number(result.lastInsertRowid);
}

/** Tant qu'aucun mouvement n'existe, le coût moyen suit le prix d'achat saisi. */
export function updateVariant(db: Db, id: number, fields: VariantFields): void {
  db.prepare(
    `UPDATE product_variants SET sku = @sku, barcode = @barcode, color = @color,
       storage_gb = @storageGb, ram_gb = @ramGb, condition = @condition, cost_price = @costPrice,
       avg_cost = CASE WHEN EXISTS (SELECT 1 FROM stock_movements m WHERE m.variant_id = @id)
                       THEN avg_cost ELSE @costPrice END,
       sale_price = @salePrice, min_sale_price = @minSalePrice, is_active = @isActive,
       updated_at = @now
     WHERE id = @id`,
  ).run({ ...variantParams(fields), id });
}

export function stockByLocation(
  db: Db,
  variantId: number,
): { locationId: number; quantity: number }[] {
  return db
    .prepare<[number], { location_id: number; quantity: number }>(
      'SELECT location_id, quantity FROM stock_levels WHERE variant_id = ? ORDER BY location_id',
    )
    .all(variantId)
    .map((row) => ({ locationId: row.location_id, quantity: row.quantity }));
}

interface ComponentRow {
  variant_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  color: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  condition: Condition;
  quantity: number;
  sale_price: number;
  stock: number;
  is_stocked: number;
  tracking_mode: TrackingMode;
}

export function listKitComponents(db: Db, kitVariantId: number): KitComponent[] {
  return db
    .prepare<[number], ComponentRow>(
      `SELECT k.component_variant_id AS variant_id, p.id AS product_id, p.name AS product_name,
              v.sku, v.color, v.storage_gb, v.ram_gb, v.condition, k.quantity, v.sale_price,
              p.is_stocked, p.tracking_mode,
              coalesce((SELECT sum(l.quantity) FROM stock_levels l WHERE l.variant_id = v.id), 0) AS stock
       FROM kit_components k
       JOIN product_variants v ON v.id = k.component_variant_id
       JOIN products p ON p.id = v.product_id
       WHERE k.kit_variant_id = ? ORDER BY k.id`,
    )
    .all(kitVariantId)
    .map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      variantLabel: variantLabel({
        color: row.color,
        storageGb: row.storage_gb,
        ramGb: row.ram_gb,
        condition: row.condition,
      }),
      sku: row.sku,
      quantity: row.quantity,
      salePrice: row.sale_price,
      stock: row.stock,
      isStocked: row.is_stocked === 1,
      trackingMode: row.tracking_mode,
    }));
}

/** Remplace la composition d'un kit : retraits, quantités modifiées, ajouts. */
export function replaceKitComponents(
  db: Db,
  kitVariantId: number,
  components: readonly { variantId: number; quantity: number }[],
  userId: number,
): void {
  const wanted = new Map(components.map((component) => [component.variantId, component.quantity]));
  const existing = db
    .prepare<[number], { component_variant_id: number; quantity: number }>(
      'SELECT component_variant_id, quantity FROM kit_components WHERE kit_variant_id = ?',
    )
    .all(kitVariantId);
  const remove = db.prepare(
    'DELETE FROM kit_components WHERE kit_variant_id = ? AND component_variant_id = ?',
  );
  const update = db.prepare(
    `UPDATE kit_components SET quantity = ?, updated_at = ?
     WHERE kit_variant_id = ? AND component_variant_id = ?`,
  );
  const now = nowIsoUtc();
  for (const row of existing) {
    const quantity = wanted.get(row.component_variant_id);
    if (quantity === undefined) remove.run(kitVariantId, row.component_variant_id);
    else if (quantity !== row.quantity)
      update.run(quantity, now, kitVariantId, row.component_variant_id);
    wanted.delete(row.component_variant_id);
  }
  const insert = db.prepare(
    `INSERT INTO kit_components (kit_variant_id, component_variant_id, quantity, created_at,
                                 updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [variantId, quantity] of wanted)
    insert.run(kitVariantId, variantId, quantity, now, now, userId);
}

interface SerialRow {
  id: number;
  variant_id: number;
  serial_number: string;
  imei2: string | null;
  status: SerialStatus;
  received_at: string | null;
  sold_at: string | null;
  warranty_end: string | null;
}

function toSerial(row: SerialRow): SerialUnit {
  return {
    id: row.id,
    variantId: row.variant_id,
    serialNumber: row.serial_number,
    imei2: row.imei2,
    status: row.status,
    receivedAt: row.received_at,
    soldAt: row.sold_at,
    warrantyEnd: row.warranty_end,
  };
}

/** Unités d'un produit : décompte par état, et les plus récentes (disponibles d'abord). */
export function productSerialUnits(
  db: Db,
  productId: number,
  limit: number,
): { counts: Record<SerialStatus, number>; items: SerialUnit[] } {
  const counts = Object.fromEntries(SERIAL_STATUSES.map((status) => [status, 0])) as Record<
    SerialStatus,
    number
  >;
  const rows = db
    .prepare<[number], { status: SerialStatus; total: number }>(
      `SELECT s.status, count(*) AS total FROM serial_units s
       JOIN product_variants v ON v.id = s.variant_id WHERE v.product_id = ? GROUP BY s.status`,
    )
    .all(productId);
  for (const row of rows) counts[row.status] = row.total;
  const items = db
    .prepare<[number, number], SerialRow>(
      `SELECT s.id, s.variant_id, s.serial_number, s.imei2, s.status, s.received_at, s.sold_at,
              s.warranty_end
       FROM serial_units s JOIN product_variants v ON v.id = s.variant_id
       WHERE v.product_id = ?
       ORDER BY s.status = 'in_stock' DESC, s.id DESC LIMIT ?`,
    )
    .all(productId, limit)
    .map(toSerial);
  return { counts, items };
}

export interface SerialLookupRow extends SerialRow {
  product_id: number;
  product_name: string;
  sku: string;
  color: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  condition: Condition;
  invoice_number: string | null;
  customer_name: string | null;
}

/** Recherche exacte par numéro de série, IMEI 1 ou IMEI 2 (index uniques). */
export function findSerials(db: Db, serial: string): SerialLookupRow[] {
  return db
    .prepare<{ serial: string }, SerialLookupRow>(
      `SELECT s.id, s.variant_id, s.serial_number, s.imei2, s.status, s.received_at, s.sold_at,
              s.warranty_end, p.id AS product_id, p.name AS product_name, v.sku, v.color,
              v.storage_gb, v.ram_gb, v.condition, sa.invoice_number, cu.full_name AS customer_name
       FROM serial_units s
       JOIN product_variants v ON v.id = s.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN sale_lines sl ON sl.id = s.sale_line_id
       LEFT JOIN sales sa ON sa.id = sl.sale_id
       LEFT JOIN customers cu ON cu.id = sa.customer_id
       WHERE s.serial_number = @serial OR s.imei2 = @serial`,
    )
    .all({ serial });
}

export function serialUnitsOfVariant(
  db: Db,
  variantId: number,
  ids: readonly number[],
): SerialUnit[] {
  if (ids.length === 0) return [];
  return db
    .prepare<[number, string], SerialRow>(
      `SELECT id, variant_id, serial_number, imei2, status, received_at, sold_at, warranty_end
       FROM serial_units WHERE variant_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(variantId, JSON.stringify(ids))
    .map(toSerial);
}
