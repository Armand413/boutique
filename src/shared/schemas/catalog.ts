import { z } from 'zod';
import {
  ATTRIBUTE_VALUE_TYPES,
  CONDITIONS,
  PRODUCT_TYPES,
  SEARCH_PAGE_MAX,
  SERIAL_STATUSES,
  TRACKING_MODES,
} from '../catalog/constants';

const id = z.number().int().positive();
/** Montant entier dans la plus petite unité de la devise (C.2). */
const money = z.number().int().min(0).max(1e13);
const count = z.number().int().min(0);
const isoDateTime = z.string();
const name = (max: number) => z.string().trim().min(1).max(max);
/** Texte facultatif : une saisie vide devient null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));
/** Caractères ASCII imprimables (code-barres, SKU : lisibles par les lecteurs et les étiquettes). */
const printable = /^[\x20-\x7e]*$/;

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export const trackingModeSchema = z.enum(TRACKING_MODES);
export const conditionSchema = z.enum(CONDITIONS);
export const attributeValueTypeSchema = z.enum(ATTRIBUTE_VALUE_TYPES);
export const serialStatusSchema = z.enum(SERIAL_STATUSES);

// ---------------------------------------------------------------- Référentiels

export const categorySchema = z.strictObject({
  id,
  name: z.string(),
  parentId: id.nullable(),
  familyId: id,
  /** 0 = famille, 1 = catégorie, 2 = sous-catégorie. */
  depth: z.number().int().min(0).max(2),
  defaultTrackingMode: trackingModeSchema,
  defaultWarrantyMonths: z.number().int().min(0),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  productCount: count,
});
export type Category = z.infer<typeof categorySchema>;

export const brandSchema = z.strictObject({
  id,
  name: z.string(),
  isActive: z.boolean(),
  productCount: count,
});
export type Brand = z.infer<typeof brandSchema>;

export const taxRateSchema = z.strictObject({
  id,
  name: z.string(),
  /** Centièmes de pourcent : 1800 = 18 %. */
  rate: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
});
export type TaxRate = z.infer<typeof taxRateSchema>;

export const attributeDefinitionSchema = z.strictObject({
  id,
  categoryId: id,
  code: z.string(),
  label: z.string(),
  valueType: attributeValueTypeSchema,
  unit: z.string().nullable(),
  choices: z.array(z.string()).nullable(),
  isRequired: z.boolean(),
  isFilterable: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>;

export const stockLocationSchema = z.strictObject({
  id,
  name: z.string(),
  isDefault: z.boolean(),
});
export type StockLocation = z.infer<typeof stockLocationSchema>;

export const catalogReferencesSchema = z.strictObject({
  categories: z.array(categorySchema),
  brands: z.array(brandSchema),
  taxRates: z.array(taxRateSchema),
  attributes: z.array(attributeDefinitionSchema),
  locations: z.array(stockLocationSchema),
});
export type CatalogReferences = z.infer<typeof catalogReferencesSchema>;

export const saveBrandInputSchema = z.strictObject({
  id: id.optional(),
  name: name(80),
  isActive: z.boolean(),
});
export type SaveBrandInput = z.infer<typeof saveBrandInputSchema>;

export const saveCategoryInputSchema = z.strictObject({
  id: id.optional(),
  name: name(80),
  parentId: id.nullable(),
  defaultTrackingMode: trackingModeSchema,
  defaultWarrantyMonths: z.number().int().min(0).max(600),
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
});
export type SaveCategoryInput = z.infer<typeof saveCategoryInputSchema>;

export const ATTRIBUTE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const saveAttributeInputSchema = z
  .strictObject({
    id: id.optional(),
    categoryId: id,
    code: z.string().trim().regex(ATTRIBUTE_CODE_PATTERN),
    label: name(80),
    valueType: attributeValueTypeSchema,
    unit: optionalText(16),
    choices: z.array(name(60)).max(50).nullable(),
    isRequired: z.boolean(),
    isFilterable: z.boolean(),
    sortOrder: z.number().int().min(0).max(10000),
    isActive: z.boolean(),
  })
  .refine((value) => (value.valueType === 'choice') === (value.choices?.length ?? 0) > 0, {
    path: ['choices'],
    message: 'Une liste de choix est requise pour le type « choix », et seulement pour lui.',
  });
export type SaveAttributeInput = z.infer<typeof saveAttributeInputSchema>;

// ---------------------------------------------------------------- Produits

export const attributeValueSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number(),
  z.boolean(),
]);
export type AttributeValue = z.infer<typeof attributeValueSchema>;

export const attributeValueInputSchema = z.strictObject({
  attributeId: id,
  value: attributeValueSchema,
});

const productFields = {
  name: name(160),
  brandId: id.nullable(),
  categoryId: id,
  model: optionalText(80),
  description: optionalText(2000),
  productType: productTypeSchema,
  trackingMode: trackingModeSchema,
  taxRateId: id.nullable(),
  reorderLevel: z.number().int().min(0).max(1_000_000),
  warrantyMonths: z.number().int().min(0).max(600),
  weightKg: z.number().min(0).max(100_000).nullable(),
  attributes: z.array(attributeValueInputSchema).max(100),
};

const variantFields = {
  /** Vide : référence générée par l'application. */
  sku: z.string().trim().max(64).regex(printable),
  barcode: optionalText(64).refine((value) => value === null || printable.test(value)),
  color: optionalText(40),
  storageGb: z.number().int().positive().max(100_000).nullable(),
  ramGb: z.number().int().positive().max(10_000).nullable(),
  condition: conditionSchema,
  salePrice: money,
  minSalePrice: money,
  /** Prix d'achat : uniquement avec la permission cost.view. */
  costPrice: money.optional(),
  isActive: z.boolean(),
};

const minBelowSale = (value: { salePrice: number; minSalePrice: number }) =>
  value.minSalePrice <= value.salePrice;
const minBelowSaleIssue = {
  path: ['minSalePrice'],
  message: 'Le prix minimum ne peut pas dépasser le prix de vente.',
};

export const variantInputSchema = z
  .strictObject(variantFields)
  .refine(minBelowSale, minBelowSaleIssue);
export type VariantInput = z.infer<typeof variantInputSchema>;

export const createProductInputSchema = z.strictObject({
  ...productFields,
  variants: z.array(variantInputSchema).min(1).max(100),
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const updateProductInputSchema = z.strictObject({ id, ...productFields });
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const saveVariantInputSchema = z
  .strictObject({ productId: id, id: id.optional(), ...variantFields })
  .refine(minBelowSale, minBelowSaleIssue);
export type SaveVariantInput = z.infer<typeof saveVariantInputSchema>;

export const productIdInputSchema = z.strictObject({ productId: id });
export const setProductActiveInputSchema = z.strictObject({ productId: id, isActive: z.boolean() });

export const kitComponentsInputSchema = z.strictObject({
  kitVariantId: id,
  components: z
    .array(z.strictObject({ variantId: id, quantity: z.number().int().min(1).max(10_000) }))
    .max(100),
});

export const attributeFilterSchema = z.strictObject({
  attributeId: id,
  min: z.number().optional(),
  max: z.number().optional(),
  equals: z.union([z.string().trim().min(1).max(200), z.boolean()]).optional(),
});
export type AttributeFilter = z.infer<typeof attributeFilterSchema>;

export const PRODUCT_SORTS = ['name', 'price_asc', 'price_desc', 'stock_asc', 'recent'] as const;

export const productSearchInputSchema = z.strictObject({
  query: z.string().trim().max(100).optional(),
  /** Famille, catégorie ou sous-catégorie : la recherche inclut toute la descendance. */
  categoryId: id.optional(),
  brandId: id.optional(),
  productType: productTypeSchema.optional(),
  status: z.enum(['active', 'archived', 'all']),
  lowStock: z.boolean().optional(),
  /** Exclut les kits (choix des composants d'un kit). */
  excludeKits: z.boolean().optional(),
  attributeFilters: z.array(attributeFilterSchema).max(20).optional(),
  sort: z.enum(PRODUCT_SORTS),
  offset: z.number().int().min(0).max(10_000_000),
  limit: z.number().int().min(1).max(SEARCH_PAGE_MAX),
});
export type ProductSearchInput = z.infer<typeof productSearchInputSchema>;

export const productRowSchema = z.strictObject({
  variantId: id,
  productId: id,
  name: z.string(),
  brandName: z.string().nullable(),
  categoryName: z.string(),
  familyName: z.string(),
  productType: productTypeSchema,
  trackingMode: trackingModeSchema,
  sku: z.string(),
  barcode: z.string().nullable(),
  variantLabel: z.string(),
  salePrice: money,
  /** null sans la permission cost.view. */
  costPrice: money.nullable(),
  stock: z.number().int(),
  isStocked: z.boolean(),
  reorderLevel: count,
  isActive: z.boolean(),
});
export type ProductRow = z.infer<typeof productRowSchema>;

export const productSearchOutputSchema = z.strictObject({
  total: count,
  rows: z.array(productRowSchema),
});
export type ProductSearchOutput = z.infer<typeof productSearchOutputSchema>;

export const kitComponentSchema = z.strictObject({
  variantId: id,
  productId: id,
  productName: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  quantity: z.number().int().positive(),
  salePrice: money,
  stock: z.number().int(),
  isStocked: z.boolean(),
  trackingMode: trackingModeSchema,
});
export type KitComponent = z.infer<typeof kitComponentSchema>;

export const variantDetailSchema = z.strictObject({
  id,
  sku: z.string(),
  barcode: z.string().nullable(),
  color: z.string().nullable(),
  storageGb: z.number().int().nullable(),
  ramGb: z.number().int().nullable(),
  condition: conditionSchema,
  label: z.string(),
  costPrice: money.nullable(),
  avgCost: money.nullable(),
  salePrice: money,
  minSalePrice: money,
  isActive: z.boolean(),
  stock: z.array(z.strictObject({ locationId: id, quantity: z.number().int() })),
  stockTotal: z.number().int(),
  components: z.array(kitComponentSchema),
});
export type VariantDetail = z.infer<typeof variantDetailSchema>;

export const serialUnitSchema = z.strictObject({
  id,
  variantId: id,
  serialNumber: z.string(),
  imei2: z.string().nullable(),
  status: serialStatusSchema,
  receivedAt: isoDateTime.nullable(),
  soldAt: isoDateTime.nullable(),
  warrantyEnd: z.string().nullable(),
});
export type SerialUnit = z.infer<typeof serialUnitSchema>;

export const SERIAL_UNITS_SHOWN = 200;

export const productDetailSchema = z.strictObject({
  id,
  name: z.string(),
  brandId: id.nullable(),
  brandName: z.string().nullable(),
  categoryId: id,
  categoryPath: z.string(),
  familyId: id,
  model: z.string().nullable(),
  description: z.string().nullable(),
  productType: productTypeSchema,
  trackingMode: trackingModeSchema,
  isStocked: z.boolean(),
  taxRateId: id.nullable(),
  reorderLevel: count,
  warrantyMonths: count,
  weightKg: z.number().nullable(),
  hasImage: z.boolean(),
  isActive: z.boolean(),
  /** Type et suivi figés : le produit a déjà des unités, des mouvements ou des ventes. */
  typeLocked: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  attributes: z.array(z.strictObject({ attributeId: id, value: attributeValueSchema })),
  variants: z.array(variantDetailSchema),
  serialUnits: z.strictObject({
    counts: z.record(serialStatusSchema, count),
    items: z.array(serialUnitSchema),
  }),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productImageOutputSchema = z.strictObject({ dataUrl: z.string().nullable() });

// ---------------------------------------------------------------- Numéros de série

export const serialLookupInputSchema = z.strictObject({ serial: z.string().trim().min(1).max(64) });

export const serialLookupSchema = z.strictObject({
  id,
  variantId: id,
  serialNumber: z.string(),
  imei2: z.string().nullable(),
  status: serialStatusSchema,
  productId: id,
  productName: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  receivedAt: isoDateTime.nullable(),
  soldAt: isoDateTime.nullable(),
  warrantyEnd: z.string().nullable(),
  /** Numéro de facture et client : uniquement avec la permission sale.view. */
  invoiceNumber: z.string().nullable(),
  customerName: z.string().nullable(),
});
export type SerialLookup = z.infer<typeof serialLookupSchema>;

// ---------------------------------------------------------------- Import, export, étiquettes

export const exportInputSchema = z.strictObject({ format: z.enum(['xlsx', 'csv']) });
export const exportOutputSchema = z.strictObject({ saved: z.boolean(), rows: count });

export const importIssueSchema = z.strictObject({
  row: z.number().int().min(1),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importAnalysisSchema = z.strictObject({
  /** null : sélection annulée par l'utilisateur. */
  token: z.string().nullable(),
  fileName: z.string(),
  productCount: count,
  variantCount: count,
  errors: z.array(importIssueSchema),
});
export type ImportAnalysis = z.infer<typeof importAnalysisSchema>;

export const importCommitInputSchema = z.strictObject({ token: z.string().min(16).max(64) });
export const importCommitOutputSchema = z.strictObject({ products: count, variants: count });

export const LABEL_LAYOUTS = ['a4', 'roll'] as const;

export const labelsInputSchema = z.strictObject({
  layout: z.enum(LABEL_LAYOUTS),
  showPrice: z.boolean(),
  items: z
    .array(
      z.strictObject({
        variantId: id,
        copies: z.number().int().min(1).max(500),
        /** Articles suivis : une étiquette par unité, avec son numéro. */
        serialUnitIds: z.array(id).max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type LabelsInput = z.infer<typeof labelsInputSchema>;
export const savedFileOutputSchema = z.strictObject({ saved: z.boolean() });
