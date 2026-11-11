import { nowIsoUtc } from '@shared/format/date';
import type {
  AttributeDefinition,
  Brand,
  Category,
  SaveAttributeInput,
  SaveBrandInput,
  SaveCategoryInput,
  StockLocation,
  TaxRate,
} from '@shared/schemas/catalog';
import type { AttributeValueType, TrackingMode } from '@shared/catalog/constants';
import type { Db } from '../db/types';

interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  default_tracking_mode: TrackingMode;
  default_warranty_months: number;
  sort_order: number;
  is_active: number;
  product_count: number;
}

/** Catégories avec leur famille et leur profondeur, triées pour l'affichage en arbre. */
export function listCategories(db: Db): Category[] {
  const rows = db
    .prepare<[], CategoryRow>(
      `SELECT c.id, c.name, c.parent_id, c.default_tracking_mode, c.default_warranty_months,
              c.sort_order, c.is_active,
              (SELECT count(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.sort_order, c.name COLLATE NOCASE`,
    )
    .all();
  const parents = new Map(rows.map((row) => [row.id, row.parent_id]));
  const depthOf = (row: CategoryRow): { depth: number; familyId: number } => {
    let depth = 0;
    let familyId = row.id;
    let parent = row.parent_id;
    while (parent !== null && depth < 3) {
      familyId = parent;
      parent = parents.get(parent) ?? null;
      depth += 1;
    }
    return { depth, familyId };
  };
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    ...depthOf(row),
    defaultTrackingMode: row.default_tracking_mode,
    defaultWarrantyMonths: row.default_warranty_months,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    productCount: row.product_count,
  }));
}

export function insertCategory(db: Db, input: SaveCategoryInput, userId: number): number {
  const now = nowIsoUtc();
  const result = db
    .prepare(
      `INSERT INTO categories (name, parent_id, default_tracking_mode, default_warranty_months,
                               sort_order, is_active, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.parentId,
      input.defaultTrackingMode,
      input.defaultWarrantyMonths,
      input.sortOrder,
      input.isActive ? 1 : 0,
      now,
      now,
      userId,
    );
  return Number(result.lastInsertRowid);
}

export function updateCategory(db: Db, id: number, input: SaveCategoryInput): void {
  db.prepare(
    `UPDATE categories SET name = ?, parent_id = ?, default_tracking_mode = ?,
       default_warranty_months = ?, sort_order = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name,
    input.parentId,
    input.defaultTrackingMode,
    input.defaultWarrantyMonths,
    input.sortOrder,
    input.isActive ? 1 : 0,
    nowIsoUtc(),
    id,
  );
}

/** Produits rangés dans la catégorie ou une de ses descendantes. */
export function categoryHoldsProducts(db: Db, categoryId: number): boolean {
  return (
    db
      .prepare<[number], number>(
        `WITH RECURSIVE tree(id) AS (
           SELECT ? UNION SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id)
         SELECT EXISTS (SELECT 1 FROM products p WHERE p.category_id IN (SELECT id FROM tree))`,
      )
      .pluck()
      .get(categoryId) === 1
  );
}

interface BrandRow {
  id: number;
  name: string;
  is_active: number;
  product_count: number;
}

export function listBrands(db: Db): Brand[] {
  return db
    .prepare<[], BrandRow>(
      `SELECT b.id, b.name, b.is_active,
              (SELECT count(*) FROM products p WHERE p.brand_id = b.id) AS product_count
       FROM brands b ORDER BY b.name COLLATE NOCASE`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active === 1,
      productCount: row.product_count,
    }));
}

export function findBrandByName(db: Db, name: string): { id: number; isActive: boolean } | null {
  const row = db
    .prepare<[string], { id: number; is_active: number }>(
      'SELECT id, is_active FROM brands WHERE name = ? COLLATE NOCASE',
    )
    .get(name);
  return row === undefined ? null : { id: row.id, isActive: row.is_active === 1 };
}

export function insertBrand(db: Db, input: SaveBrandInput, userId: number): number {
  const now = nowIsoUtc();
  const result = db
    .prepare(
      `INSERT INTO brands (name, is_active, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.isActive ? 1 : 0, now, now, userId);
  return Number(result.lastInsertRowid);
}

export function updateBrand(db: Db, id: number, input: SaveBrandInput): void {
  db.prepare('UPDATE brands SET name = ?, is_active = ?, updated_at = ? WHERE id = ?').run(
    input.name,
    input.isActive ? 1 : 0,
    nowIsoUtc(),
    id,
  );
}

export function listTaxRates(db: Db): TaxRate[] {
  return db
    .prepare<[], { id: number; name: string; rate: number; is_active: number }>(
      'SELECT id, name, rate, is_active FROM tax_rates ORDER BY rate, name',
    )
    .all()
    .map((row) => ({ id: row.id, name: row.name, rate: row.rate, isActive: row.is_active === 1 }));
}

export function listLocations(db: Db): StockLocation[] {
  return db
    .prepare<[], { id: number; name: string; is_default: number }>(
      'SELECT id, name, is_default FROM stock_locations WHERE is_active = 1 ORDER BY is_default DESC, name',
    )
    .all()
    .map((row) => ({ id: row.id, name: row.name, isDefault: row.is_default === 1 }));
}

interface AttributeRow {
  id: number;
  category_id: number;
  code: string;
  label: string;
  value_type: AttributeValueType;
  unit: string | null;
  choices: string | null;
  is_required: number;
  is_filterable: number;
  sort_order: number;
  is_active: number;
}

function parseChoices(raw: string | null): string[] | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map(String) : null;
}

export function listAttributes(db: Db): AttributeDefinition[] {
  return db
    .prepare<[], AttributeRow>(
      `SELECT id, category_id, code, label, value_type, unit, choices, is_required, is_filterable,
              sort_order, is_active
       FROM attribute_definitions ORDER BY category_id, sort_order, label`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      code: row.code,
      label: row.label,
      valueType: row.value_type,
      unit: row.unit,
      choices: parseChoices(row.choices),
      isRequired: row.is_required === 1,
      isFilterable: row.is_filterable === 1,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
    }));
}

function attributeParams(input: SaveAttributeInput) {
  return {
    categoryId: input.categoryId,
    code: input.code,
    label: input.label,
    valueType: input.valueType,
    unit: input.unit,
    choices: input.valueType === 'choice' ? JSON.stringify(input.choices ?? []) : null,
    isRequired: input.isRequired ? 1 : 0,
    isFilterable: input.isFilterable ? 1 : 0,
    sortOrder: input.sortOrder,
    isActive: input.isActive ? 1 : 0,
    now: nowIsoUtc(),
  };
}

export function insertAttribute(db: Db, input: SaveAttributeInput, userId: number): number {
  const result = db
    .prepare(
      `INSERT INTO attribute_definitions (category_id, code, label, value_type, unit, choices,
         is_required, is_filterable, sort_order, is_active, created_at, updated_at, created_by)
       VALUES (@categoryId, @code, @label, @valueType, @unit, @choices, @isRequired, @isFilterable,
               @sortOrder, @isActive, @now, @now, @userId)`,
    )
    .run({ ...attributeParams(input), userId });
  return Number(result.lastInsertRowid);
}

export function updateAttribute(db: Db, id: number, input: SaveAttributeInput): void {
  db.prepare(
    `UPDATE attribute_definitions SET category_id = @categoryId, code = @code, label = @label,
       value_type = @valueType, unit = @unit, choices = @choices, is_required = @isRequired,
       is_filterable = @isFilterable, sort_order = @sortOrder, is_active = @isActive,
       updated_at = @now
     WHERE id = @id`,
  ).run({ ...attributeParams(input), id });
}

/** Valeurs texte déjà saisies pour un attribut (contrôle avant de retirer un choix). */
export function usedTextValues(db: Db, attributeId: number): string[] {
  return db
    .prepare<[number], string>(
      'SELECT DISTINCT value_text FROM product_attribute_values WHERE attribute_id = ? AND value_text IS NOT NULL',
    )
    .pluck()
    .all(attributeId);
}
