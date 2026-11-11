import { openSync, readSync, closeSync, statSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { AppError } from '@shared/ipc/errors';
import { parseMoney } from '@shared/format/money';
import {
  coerceTrackingMode,
  type Condition,
  type ProductType,
  type TrackingMode,
} from '@shared/catalog/constants';
import { categoryPath, effectiveAttributes } from '@shared/catalog/tree';
import type {
  AttributeDefinition,
  AttributeValue,
  Brand,
  Category,
  CreateProductInput,
  ImportIssue,
  TaxRate,
} from '@shared/schemas/catalog';

/** Format de fichier du catalogue : mêmes colonnes à l'export et à l'import. */
export const COLUMNS = {
  name: 'Nom',
  brand: 'Marque',
  category: 'Catégorie',
  type: 'Type',
  tracking: 'Suivi',
  model: 'Modèle',
  description: 'Description',
  tax: 'Taxe',
  reorderLevel: 'Seuil d’alerte',
  warranty: 'Garantie (mois)',
  weight: 'Poids (kg)',
  sku: 'Référence',
  barcode: 'Code-barres',
  color: 'Couleur',
  storage: 'Stockage (Go)',
  ram: 'RAM (Go)',
  condition: 'État',
  salePrice: 'Prix de vente',
  minSalePrice: 'Prix minimum',
  costPrice: 'Prix d’achat',
} as const;
type ColumnKey = keyof typeof COLUMNS;

/** Colonne de caractéristique : « attr:code » (code de l'attribut, unique par famille). */
export const ATTRIBUTE_COLUMN_PREFIX = 'attr:';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
const MAX_ISSUES = 200;

export const TYPE_WORDS: Readonly<Record<ProductType, string>> = {
  phone: 'Téléphone',
  accessory: 'Accessoire',
  electronics: 'Électronique',
  appliance: 'Électroménager',
  solar: 'Solaire',
  part: 'Pièce détachée',
  service: 'Service',
  kit: 'Kit',
};
export const TRACKING_WORDS: Readonly<Record<TrackingMode, string>> = {
  none: 'Aucun',
  serial: 'Numéro de série',
  imei: 'IMEI',
};
export const CONDITION_WORDS: Readonly<Record<Condition, string>> = {
  new: 'Neuf',
  refurbished: 'Reconditionné',
  used: 'Occasion',
};

/** Comparaison tolérante : sans accents, sans casse, espaces réduits. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, '’')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function wordLookup<T extends string>(
  words: Readonly<Record<T, string>>,
  extra: Record<string, T>,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const [code, word] of Object.entries(words) as [T, string][]) {
    map.set(fold(code), code);
    map.set(fold(word), code);
  }
  for (const [word, code] of Object.entries(extra)) map.set(fold(word), code);
  return map;
}

const TYPES = wordLookup(TYPE_WORDS, {
  telephonie: 'phone',
  piece: 'part',
  electromenager: 'appliance',
});
const TRACKINGS = wordLookup(TRACKING_WORDS, {
  serie: 'serial',
  'n° de serie': 'serial',
  sans: 'none',
});
const CONDITIONS = wordLookup(CONDITION_WORDS, { reconditionne: 'refurbished', usage: 'used' });

// ---------------------------------------------------------------- Lecture du fichier

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return value.text;
  }
  return '';
}

/** Séparateur d'un CSV : point-virgule (Excel en français) ou virgule. */
function detectDelimiter(path: string): string {
  const handle = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, read).toString('utf8').split(/\r?\n/)[0] ?? '';
    return (head.match(/;/g)?.length ?? 0) >= (head.match(/,/g)?.length ?? 0) ? ';' : ',';
  } finally {
    closeSync(handle);
  }
}

/** Lignes du premier onglet (ou du CSV), en texte, sans conversion automatique des valeurs. */
export async function readRows(path: string): Promise<string[][]> {
  if (statSync(path).size > MAX_IMPORT_BYTES) {
    throw new AppError('VALIDATION_ERROR', 'Fichier trop volumineux : 10 Mo au maximum.');
  }
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (/\.csv$/i.test(path)) {
      sheet = await workbook.csv.readFile(path, {
        map: (value: unknown) => value,
        parserOptions: { delimiter: detectDelimiter(path) },
      });
    } else {
      await workbook.xlsx.readFile(path);
      sheet = workbook.worksheets[0];
    }
  } catch {
    throw new AppError(
      'VALIDATION_ERROR',
      'Ce fichier n’a pas pu être lu : enregistrez-le en .xlsx ou .csv.',
    );
  }
  if (sheet === undefined) return [];
  if (sheet.rowCount > MAX_IMPORT_ROWS + 1) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Trop de lignes : ${String(MAX_IMPORT_ROWS)} au maximum.`,
    );
  }
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      values.push(
        cellText(row.getCell(column).value)
          .replace(/^\uFEFF/, '')
          .trim(),
      );
    }
    rows[rowNumber - 1] = values;
  });
  return Array.from(rows, (row: string[] | undefined) => row ?? []);
}

// ---------------------------------------------------------------- Analyse

export interface ImportContext {
  categories: readonly Category[];
  brands: readonly Brand[];
  taxRates: readonly TaxRate[];
  attributes: readonly AttributeDefinition[];
  /** L'utilisateur peut créer les marques absentes (settings.manage). */
  canCreateBrands: boolean;
  /** Le prix d'achat est lu (cost.view) ; sinon la colonne est ignorée. */
  canSetCost: boolean;
}

export interface ParsedProduct {
  /** Ligne de la première variante (numérotation du tableur). */
  row: number;
  /** Marque à créer à l'enregistrement (absente du référentiel). */
  newBrandName: string | null;
  input: CreateProductInput;
}

export interface ImportResult {
  products: ParsedProduct[];
  errors: ImportIssue[];
}

class RowError extends Error {}

function findCategory(categories: readonly Category[], text: string): Category {
  const parts = text
    .split(/\s*[>›/]\s*/)
    .map(fold)
    .filter((part) => part !== '');
  const last = parts.at(-1);
  if (last === undefined) throw new RowError('catégorie manquante');
  const candidates = categories.filter((category) => {
    if (fold(category.name) !== last) return false;
    const path = categoryPath(categories, category.id).split(' › ').map(fold);
    return parts.every((part, index) => path[path.length - parts.length + index] === part);
  });
  if (candidates.length === 0) throw new RowError(`catégorie « ${text} » introuvable`);
  if (candidates.length > 1)
    throw new RowError(`catégorie « ${text} » ambiguë : indiquez « Famille > Catégorie »`);
  const [category] = candidates as [Category];
  if (!category.isActive) throw new RowError(`catégorie « ${text} » archivée`);
  return category;
}

function integer(
  text: string,
  label: string,
  options: { min?: number; positive?: boolean } = {},
): number | null {
  if (text === '') return null;
  const value = Number(text.replace(/[\s\u00a0\u202f]/g, ''));
  if (
    !Number.isInteger(value) ||
    value < (options.min ?? 0) ||
    (options.positive === true && value <= 0)
  ) {
    throw new RowError(`${label} : nombre entier attendu`);
  }
  return value;
}

function money(text: string, label: string): number | null {
  if (text === '') return null;
  const value = parseMoney(text);
  if (value === null || value < 0) throw new RowError(`${label} : montant invalide`);
  return value;
}

function attributeValue(definition: AttributeDefinition, text: string): AttributeValue {
  switch (definition.valueType) {
    case 'number': {
      const value = Number(text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
      if (!Number.isFinite(value)) throw new RowError(`${definition.label} : nombre attendu`);
      return value;
    }
    case 'boolean': {
      const word = fold(text);
      if (['oui', 'vrai', '1', 'yes', 'x'].includes(word)) return true;
      if (['non', 'faux', '0', 'no'].includes(word)) return false;
      throw new RowError(`${definition.label} : oui ou non attendu`);
    }
    case 'choice': {
      const choice = (definition.choices ?? []).find((candidate) => fold(candidate) === fold(text));
      if (choice === undefined)
        throw new RowError(`${definition.label} : « ${text} » n’est pas dans la liste`);
      return choice;
    }
    case 'text':
      return text;
  }
}

function productKey(cells: (key: ColumnKey) => string): string {
  return [cells('name'), cells('brand'), cells('category'), cells('model')].map(fold).join('|');
}

/**
 * Transforme les lignes du fichier en produits à créer. Les lignes de même nom, marque,
 * catégorie et modèle forment les variantes d'un même produit. Toutes les erreurs sont listées.
 */
export function parseCatalogRows(rows: readonly string[][], context: ImportContext): ImportResult {
  const [header = [], ...body] = rows;
  const index = new Map(header.map((title, position) => [fold(title), position]));
  const errors: ImportIssue[] = [];
  const missing = (['name', 'category', 'type', 'salePrice'] as const).filter(
    (key) => !index.has(fold(COLUMNS[key])),
  );
  if (missing.length > 0) {
    return {
      products: [],
      errors: [
        {
          row: 1,
          message: `Colonnes obligatoires absentes : ${missing.map((key) => COLUMNS[key]).join(', ')}.`,
        },
      ],
    };
  }
  const attributeColumns = header.flatMap((title, position) =>
    title.toLowerCase().startsWith(ATTRIBUTE_COLUMN_PREFIX)
      ? [{ code: title.slice(ATTRIBUTE_COLUMN_PREFIX.length).trim().toLowerCase(), position }]
      : [],
  );
  const byKey = new Map<string, ParsedProduct>();
  body.forEach((values, offset) => {
    const rowNumber = offset + 2;
    const cell = (key: ColumnKey): string => values[index.get(fold(COLUMNS[key])) ?? -1] ?? '';
    if (values.every((value) => value === '')) return;
    try {
      const key = productKey(cell);
      const existing = byKey.get(key);
      const variant = parseVariant(cell, context);
      if (existing !== undefined) {
        existing.input.variants.push(variant);
        return;
      }
      const product = parseProduct(cell, values, attributeColumns, context, rowNumber);
      product.input.variants.push(variant);
      byKey.set(key, product);
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      if (errors.length < MAX_ISSUES)
        errors.push({ row: rowNumber, message: capitalize(error.message) + '.' });
    }
  });
  return { products: [...byKey.values()], errors };
}

function parseProduct(
  cell: (key: ColumnKey) => string,
  values: readonly string[],
  attributeColumns: readonly { code: string; position: number }[],
  context: ImportContext,
  row: number,
): ParsedProduct {
  const name = cell('name');
  if (name === '') throw new RowError('nom manquant');
  if (name.length > 160) throw new RowError('nom trop long (160 caractères au maximum)');
  const category = findCategory(context.categories, cell('category'));
  const productType = TYPES.get(fold(cell('type')));
  if (productType === undefined) throw new RowError(`type « ${cell('type')} » inconnu`);
  const trackingText = cell('tracking');
  const tracking =
    trackingText === '' ? category.defaultTrackingMode : TRACKINGS.get(fold(trackingText));
  if (tracking === undefined) throw new RowError(`suivi « ${trackingText} » inconnu`);
  const trackingMode = trackingText === '' ? coerceTrackingMode(productType, tracking) : tracking;
  const { brandId, newBrandName } = resolveBrand(cell('brand'), context);
  const taxText = cell('tax');
  const tax =
    taxText === ''
      ? null
      : (context.taxRates.find((candidate) => fold(candidate.name) === fold(taxText)) ??
        context.taxRates.find(
          (candidate) =>
            candidate.rate ===
            Math.round(Number(taxText.replace(/[%\s]/g, '').replace(',', '.')) * 100),
        ));
  if (tax === undefined) throw new RowError(`taxe « ${taxText} » inconnue`);
  const applicable = effectiveAttributes(context.categories, context.attributes, category.id);
  const attributes = attributeColumns.flatMap(({ code, position }) => {
    const text = values[position] ?? '';
    if (text === '') return [];
    const definition = applicable.find((candidate) => candidate.code === code);
    if (definition === undefined)
      throw new RowError(`caractéristique « ${code} » inconnue pour cette catégorie`);
    return [{ attributeId: definition.id, value: attributeValue(definition, text) }];
  });
  const weightText = cell('weight').replace(',', '.');
  const weightKg = weightText === '' ? null : Number(weightText);
  if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0))
    throw new RowError('poids invalide');
  return {
    row,
    newBrandName,
    input: {
      name,
      brandId,
      categoryId: category.id,
      model: cell('model') === '' ? null : cell('model').slice(0, 80),
      description: cell('description') === '' ? null : cell('description').slice(0, 2000),
      productType,
      trackingMode,
      taxRateId: tax?.id ?? null,
      reorderLevel: integer(cell('reorderLevel'), COLUMNS.reorderLevel) ?? 0,
      warrantyMonths: integer(cell('warranty'), COLUMNS.warranty) ?? category.defaultWarrantyMonths,
      weightKg,
      attributes,
      variants: [],
    },
  };
}

function resolveBrand(
  text: string,
  context: ImportContext,
): { brandId: number | null; newBrandName: string | null } {
  if (text === '') return { brandId: null, newBrandName: null };
  const brand = context.brands.find((candidate) => fold(candidate.name) === fold(text));
  if (brand !== undefined) {
    if (!brand.isActive) throw new RowError(`marque « ${text} » archivée`);
    return { brandId: brand.id, newBrandName: null };
  }
  if (!context.canCreateBrands)
    throw new RowError(`marque « ${text} » absente (seul l’administrateur peut l’ajouter)`);
  if (text.length > 80) throw new RowError('nom de marque trop long');
  return { brandId: null, newBrandName: text };
}

function parseVariant(
  cell: (key: ColumnKey) => string,
  context: ImportContext,
): CreateProductInput['variants'][number] {
  const salePrice = money(cell('salePrice'), COLUMNS.salePrice);
  if (salePrice === null) throw new RowError('prix de vente manquant');
  const minSalePrice = money(cell('minSalePrice'), COLUMNS.minSalePrice) ?? 0;
  if (minSalePrice > salePrice) throw new RowError('le prix minimum dépasse le prix de vente');
  const conditionText = cell('condition');
  const condition = conditionText === '' ? 'new' : CONDITIONS.get(fold(conditionText));
  if (condition === undefined) throw new RowError(`état « ${conditionText} » inconnu`);
  const sku = cell('sku');
  const barcode = cell('barcode');
  for (const [label, value] of [
    [COLUMNS.sku, sku],
    [COLUMNS.barcode, barcode],
  ] as const) {
    if (value.length > 64 || !/^[\x20-\x7e]*$/.test(value))
      throw new RowError(`${label} : 64 caractères simples au maximum`);
  }
  const costPrice = context.canSetCost ? money(cell('costPrice'), COLUMNS.costPrice) : null;
  return {
    sku,
    barcode: barcode === '' ? null : barcode,
    color: cell('color') === '' ? null : cell('color').slice(0, 40),
    storageGb: integer(cell('storage'), COLUMNS.storage, { positive: true }),
    ramGb: integer(cell('ram'), COLUMNS.ram, { positive: true }),
    condition,
    salePrice,
    minSalePrice,
    ...(costPrice === null ? {} : { costPrice }),
    isActive: true,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------- Écriture

/** Une cellule texte commençant par = + - @ serait exécutée comme formule par un tableur (CSV). */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export async function writeRows(
  path: string,
  format: 'xlsx' | 'csv',
  header: readonly string[],
  rows: readonly (string | number | null)[][],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogue');
  sheet.addRow([...header]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      row.map((value) =>
        typeof value === 'string' && format === 'csv' ? neutralizeFormula(value) : value,
      ),
    );
  }
  if (format === 'xlsx') {
    sheet.columns.forEach((column) => {
      column.width = 18;
    });
    await workbook.xlsx.writeFile(path);
  } else {
    await workbook.csv.writeFile(path, {
      formatterOptions: { delimiter: ';', writeBOM: true },
    });
  }
}
