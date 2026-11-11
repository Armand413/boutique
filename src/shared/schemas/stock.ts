import { z } from 'zod';
import { SEARCH_PAGE_MAX } from '../catalog/constants';
import { serialStatusSchema, trackingModeSchema } from './catalog';

const id = z.number().int().positive();
const money = z.number().int().min(0).max(1e13);
const count = z.number().int().min(0);
const quantity = z.number().int().min(1).max(100_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));
/** Date du jour choisie (AAAA-MM-JJ). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'sale_return',
  'purchase_return',
  'adjustment',
  'inventory',
  'loss',
  'damage',
  'theft',
  'internal_use',
  'transfer_in',
  'transfer_out',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Sorties et corrections manuelles (4.3) ; le motif est obligatoire. */
export const MANUAL_EXIT_TYPES = ['loss', 'damage', 'theft', 'internal_use'] as const;
export const PAYMENT_METHODS = ['cash', 'card', 'mobile_money', 'transfer', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ---------------------------------------------------------------- Emplacements

export const locationSchema = z.strictObject({
  id,
  name: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  /** Nombre d'articles en stock à cet emplacement. */
  units: count,
});
export type Location = z.infer<typeof locationSchema>;

export const saveLocationInputSchema = z.strictObject({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
export type SaveLocationInput = z.infer<typeof saveLocationInputSchema>;

// ---------------------------------------------------------------- État du stock

export const stockOverviewInputSchema = z.strictObject({
  query: z.string().trim().max(100).optional(),
  categoryId: id.optional(),
  locationId: id.optional(),
  lowStock: z.boolean().optional(),
  offset: z.number().int().min(0).max(10_000_000),
  limit: z.number().int().min(1).max(SEARCH_PAGE_MAX),
});
export type StockOverviewInput = z.infer<typeof stockOverviewInputSchema>;

export const stockRowSchema = z.strictObject({
  variantId: id,
  productId: id,
  name: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  familyName: z.string(),
  trackingMode: trackingModeSchema,
  quantities: z.array(z.strictObject({ locationId: id, quantity: count })),
  total: count,
  reorderLevel: count,
  salePrice: money,
  /** Coût moyen pondéré : null sans la permission cost.view. */
  avgCost: money.nullable(),
});
export type StockRow = z.infer<typeof stockRowSchema>;

export const stockOverviewOutputSchema = z.strictObject({
  total: count,
  rows: z.array(stockRowSchema),
});

export const valuationSchema = z.strictObject({
  /** Valeurs au coût moyen : null sans la permission cost.view. */
  totalCost: money.nullable(),
  totalSale: money,
  units: count,
  byLocation: z.array(
    z.strictObject({
      locationId: id,
      name: z.string(),
      units: count,
      cost: money.nullable(),
      sale: money,
    }),
  ),
  byFamily: z.array(
    z.strictObject({
      familyId: id,
      name: z.string(),
      units: count,
      cost: money.nullable(),
      sale: money,
    }),
  ),
});
export type Valuation = z.infer<typeof valuationSchema>;

export const stockAlertsSchema = z.strictObject({ lowStock: count });

// ---------------------------------------------------------------- Mouvements

export const movementListInputSchema = z.strictObject({
  variantId: id.optional(),
  locationId: id.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  beforeId: id.optional(),
  limit: z.number().int().min(1).max(200),
});
export type MovementListInput = z.infer<typeof movementListInputSchema>;

export const movementSchema = z.strictObject({
  id,
  createdAt: z.string(),
  variantId: id,
  productName: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  locationName: z.string(),
  type: z.enum(MOVEMENT_TYPES),
  quantityDelta: z.number().int(),
  quantityAfter: count,
  /** null sans la permission cost.view. */
  unitCost: money.nullable(),
  serialNumber: z.string().nullable(),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  userName: z.string(),
});
export type Movement = z.infer<typeof movementSchema>;

// ---------------------------------------------------------------- Unités et sorties

export const availableUnitsInputSchema = z.strictObject({ variantId: id, locationId: id });
export const availableUnitSchema = z.strictObject({
  id,
  serialNumber: z.string(),
  imei2: z.string().nullable(),
  status: serialStatusSchema,
});
export type AvailableUnit = z.infer<typeof availableUnitSchema>;

export const stockExitInputSchema = z
  .strictObject({
    variantId: id,
    locationId: id,
    type: z.enum([...MANUAL_EXIT_TYPES, 'adjustment']),
    /** Sens d'un ajustement (+ ou −) ; les autres sorties sont toujours négatives. */
    direction: z.enum(['in', 'out']),
    quantity,
    reason: z.string().trim().min(3).max(500),
    /** Articles suivis, sortie : unités concernées. */
    serialUnitIds: z.array(id).max(500).optional(),
    /** Articles suivis, ajustement positif : numéros nouveaux ou unités sorties retrouvées. */
    serials: z
      .array(
        z.strictObject({ serialNumber: z.string().trim().min(1).max(64), imei2: optionalText(64) }),
      )
      .max(500)
      .optional(),
  })
  .refine((value) => value.type === 'adjustment' || value.direction === 'out', {
    path: ['direction'],
    message: 'Seul un ajustement peut augmenter le stock.',
  });
export type StockExitInput = z.infer<typeof stockExitInputSchema>;

export const transferInputSchema = z
  .strictObject({
    variantId: id,
    fromLocationId: id,
    toLocationId: id,
    quantity,
    serialUnitIds: z.array(id).max(500).optional(),
    reason: optionalText(500),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    path: ['toLocationId'],
    message: 'Choisissez un emplacement différent.',
  });
export type TransferInput = z.infer<typeof transferInputSchema>;

// ---------------------------------------------------------------- Fournisseurs

export const supplierSchema = z.strictObject({
  id,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  /** Reste dû au fournisseur (entrées validées − paiements). */
  balance: z.number().int(),
  receiptCount: count,
});
export type Supplier = z.infer<typeof supplierSchema>;

export const saveSupplierInputSchema = z.strictObject({
  id: id.optional(),
  name: z.string().trim().min(1).max(120),
  phone: optionalText(32),
  email: optionalText(120).refine(
    (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    {
      message: 'Adresse e-mail invalide.',
    },
  ),
  address: optionalText(300),
  notes: optionalText(1000),
  isActive: z.boolean(),
});
export type SaveSupplierInput = z.infer<typeof saveSupplierInputSchema>;

export const supplierPaymentInputSchema = z.strictObject({
  supplierId: id,
  receiptId: id.nullable(),
  amount: money.refine((value) => value > 0),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(64),
  paidOn: isoDate,
});
export type SupplierPaymentInput = z.infer<typeof supplierPaymentInputSchema>;

export const supplierPaymentSchema = z.strictObject({
  id,
  receiptNumber: z.string().nullable(),
  amount: money,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  paidAt: z.string(),
  userName: z.string(),
});

export const receiptSummarySchema = z.strictObject({
  id,
  number: z.string(),
  supplierId: id,
  supplierName: z.string(),
  locationName: z.string(),
  receivedAt: z.string(),
  totalCost: money,
  paid: money,
  lineCount: count,
  status: z.enum(['draft', 'validated', 'cancelled']),
  userName: z.string(),
});
export type ReceiptSummary = z.infer<typeof receiptSummarySchema>;

export const supplierDetailSchema = z.strictObject({
  supplier: supplierSchema,
  receipts: z.array(receiptSummarySchema),
  payments: z.array(supplierPaymentSchema),
});
export type SupplierDetail = z.infer<typeof supplierDetailSchema>;

// ---------------------------------------------------------------- Réceptions

export const receiptLineInputSchema = z.strictObject({
  variantId: id,
  quantity,
  unitCost: money,
  /** Articles suivis : un numéro par unité (IMEI 1 et facultativement IMEI 2 pour un téléphone). */
  serials: z
    .array(
      z.strictObject({ serialNumber: z.string().trim().min(1).max(64), imei2: optionalText(64) }),
    )
    .max(1000)
    .optional(),
});
export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>;

export const createReceiptInputSchema = z.strictObject({
  supplierId: id,
  locationId: id,
  receivedOn: isoDate,
  notes: optionalText(1000),
  lines: z.array(receiptLineInputSchema).min(1).max(500),
  /** Paiement immédiat facultatif (au comptant ou acompte). */
  payment: z
    .strictObject({
      amount: money.refine((value) => value > 0),
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(64),
    })
    .nullable(),
});
export type CreateReceiptInput = z.infer<typeof createReceiptInputSchema>;

export const receiptDetailSchema = z.strictObject({
  receipt: receiptSummarySchema,
  notes: z.string().nullable(),
  lines: z.array(
    z.strictObject({
      variantId: id,
      productName: z.string(),
      variantLabel: z.string(),
      sku: z.string(),
      quantity,
      unitCost: money,
      serials: z.array(z.string()),
    }),
  ),
});
export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;

export const supplierReturnInputSchema = z.strictObject({
  supplierId: id,
  variantId: id,
  locationId: id,
  quantity,
  reason: z.string().trim().min(3).max(500),
  serialUnitIds: z.array(id).max(500).optional(),
});
export type SupplierReturnInput = z.infer<typeof supplierReturnInputSchema>;

export const supplierIdInputSchema = z.strictObject({ supplierId: id });
export const receiptIdInputSchema = z.strictObject({ receiptId: id });
export const receiptListInputSchema = z.strictObject({ limit: z.number().int().min(1).max(500) });
