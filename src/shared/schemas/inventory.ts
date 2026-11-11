import { z } from 'zod';
import { serialStatusSchema, trackingModeSchema } from './catalog';

const id = z.number().int().positive();
const count = z.number().int().min(0);
const money = z.number().int();

export const INVENTORY_STATUSES = [
  'draft',
  'counting',
  'review',
  'validated',
  'cancelled',
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const createInventoryInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    scopeType: z.enum(['all', 'brand', 'category']),
    scopeId: id.nullable(),
    locationId: id,
  })
  .refine((value) => (value.scopeType === 'all') === (value.scopeId === null), {
    path: ['scopeId'],
    message: 'Choisissez la marque ou la catégorie du périmètre.',
  });
export type CreateInventoryInput = z.infer<typeof createInventoryInputSchema>;

export const inventorySummarySchema = z.strictObject({
  id,
  name: z.string(),
  scopeLabel: z.string(),
  locationName: z.string(),
  status: z.enum(INVENTORY_STATUSES),
  createdAt: z.string(),
  createdBy: z.string(),
  validatedAt: z.string().nullable(),
  validatedBy: z.string().nullable(),
  lineCount: count,
  countedCount: count,
  differenceCount: count,
  /** Valeur des écarts au coût moyen : null sans cost.view. */
  differenceValue: money.nullable(),
});
export type InventorySummary = z.infer<typeof inventorySummarySchema>;

export const inventoryLineSchema = z.strictObject({
  id,
  variantId: id,
  name: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  trackingMode: trackingModeSchema,
  expected: count,
  counted: count.nullable(),
  difference: z.number().int().nullable(),
  /** Valeur de l'écart au coût moyen : null sans cost.view. */
  differenceValue: money.nullable(),
  note: z.string().nullable(),
  /** Appareils suivis : numéros scannés pendant le comptage. */
  scanned: z.array(z.strictObject({ unitId: id, serialNumber: z.string() })),
  /** Appareils suivis attendus à l'emplacement mais pas (encore) scannés. */
  missing: z.array(
    z.strictObject({ unitId: id, serialNumber: z.string(), status: serialStatusSchema }),
  ),
});
export type InventoryLine = z.infer<typeof inventoryLineSchema>;

export const inventoryDetailSchema = z.strictObject({
  inventory: inventorySummarySchema,
  lines: z.array(inventoryLineSchema),
  /** Validation encore possible par cette session (droit et double contrôle). */
  canValidate: z.boolean(),
});
export type InventoryDetail = z.infer<typeof inventoryDetailSchema>;

export const inventoryIdInputSchema = z.strictObject({ inventoryId: id });
export const inventoryListInputSchema = z.strictObject({ limit: z.number().int().min(1).max(200) });
export const setCountInputSchema = z.strictObject({
  inventoryId: id,
  lineId: id,
  counted: z.number().int().min(0).max(1_000_000).nullable(),
  note: z.string().trim().max(300).nullable().optional(),
});
export const scanInputSchema = z.strictObject({
  inventoryId: id,
  code: z.string().trim().min(1).max(64),
});
export const scanResultSchema = z.strictObject({
  kind: z.enum(['item', 'unit']),
  lineId: id,
  name: z.string(),
  counted: count,
  serialNumber: z.string().nullable(),
});
export const removeScanInputSchema = z.strictObject({ inventoryId: id, unitId: id });
export const inventoryExportInputSchema = z.strictObject({
  inventoryId: id,
  format: z.enum(['pdf', 'xlsx']),
});

// ---------------------------------------------------------------- Garantie et SAV

export const CLAIM_STATUSES = [
  'received',
  'sent_to_supplier',
  'repaired',
  'replaced',
  'rejected',
  'closed',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const claimSchema = z.strictObject({
  id,
  serialUnitId: id,
  serialNumber: z.string(),
  productName: z.string(),
  customerName: z.string().nullable(),
  supplierId: id.nullable(),
  supplierName: z.string().nullable(),
  issue: z.string(),
  status: z.enum(CLAIM_STATUSES),
  resolution: z.string().nullable(),
  warrantyExpired: z.boolean(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  userName: z.string(),
});
export type Claim = z.infer<typeof claimSchema>;

export const warrantyLookupSchema = z.strictObject({
  unitId: id,
  serialNumber: z.string(),
  imei2: z.string().nullable(),
  productName: z.string(),
  variantLabel: z.string(),
  status: serialStatusSchema,
  saleId: id.nullable(),
  invoiceNumber: z.string().nullable(),
  soldAt: z.string().nullable(),
  customerId: id.nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  warrantyEnd: z.string().nullable(),
  /** Jours restants (négatif : garantie dépassée) ; null sans garantie. */
  daysLeft: z.number().int().nullable(),
  claims: z.array(claimSchema),
});
export type WarrantyLookup = z.infer<typeof warrantyLookupSchema>;

export const warrantyLookupInputSchema = z.strictObject({
  serial: z.string().trim().min(1).max(64),
});
export const openClaimInputSchema = z.strictObject({
  serialUnitId: id,
  issue: z.string().trim().min(3).max(1000),
  supplierId: id.nullable(),
});
export const updateClaimInputSchema = z.strictObject({
  claimId: id,
  status: z.enum(CLAIM_STATUSES),
  resolution: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((value) => (value === '' ? null : value)),
  supplierId: id.nullable(),
});
export type UpdateClaimInput = z.infer<typeof updateClaimInputSchema>;
export const claimListInputSchema = z.strictObject({
  scope: z.enum(['open', 'all']),
  limit: z.number().int().min(1).max(500),
});
export const expiringSchema = z.strictObject({
  unitId: id,
  serialNumber: z.string(),
  productName: z.string(),
  invoiceNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  warrantyEnd: z.string(),
  daysLeft: z.number().int(),
});
export type Expiring = z.infer<typeof expiringSchema>;
