import { z } from 'zod';
import { PAYMENT_METHODS } from './stock';

const id = z.number().int().positive();
const money = z.number().int().min(0).max(1e13);
const positiveMoney = z.number().int().min(1).max(1e13);
const count = z.number().int().min(0);
const quantity = z.number().int().min(1).max(10_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export const REFUND_METHODS = [...PAYMENT_METHODS, 'credit_note'] as const;

/** Remise en montant (plus petite unité) ou en pourcentage (centièmes : 1000 = 10 %). */
export const discountSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('amount'), value: money }),
  z.strictObject({ type: z.literal('percent'), value: z.number().int().min(0).max(10_000) }),
]);
export type Discount = z.infer<typeof discountSchema>;

// ---------------------------------------------------------------- Clients

export const customerSchema = z.strictObject({
  id,
  fullName: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  creditLimit: money,
  isActive: z.boolean(),
  /** Reste dû (ventes à crédit − paiements − avoirs), calculé par la vue. */
  balance: z.number().int(),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerSearchInputSchema = z.strictObject({
  query: z.string().trim().max(100),
  withDebtOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200),
});

export const saveCustomerInputSchema = z.strictObject({
  id: id.optional(),
  fullName: z.string().trim().min(1).max(120),
  phone: optionalText(32),
  address: optionalText(300),
  notes: optionalText(1000),
  creditLimit: money,
  isActive: z.boolean(),
});
export type SaveCustomerInput = z.infer<typeof saveCustomerInputSchema>;

export const customerIdInputSchema = z.strictObject({ customerId: id });

export const debtPaymentInputSchema = z.strictObject({
  customerId: id,
  amount: positiveMoney,
  method: paymentMethodSchema,
  reference: optionalText(64),
});
export type DebtPaymentInput = z.infer<typeof debtPaymentInputSchema>;

// ---------------------------------------------------------------- Caisse

export const cashSessionSchema = z.strictObject({
  id,
  status: z.enum(['open', 'closed']),
  openedAt: z.string(),
  openedBy: z.string(),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  openingFloat: money,
  /** Encaissements par moyen de paiement. */
  byMethod: z.record(paymentMethodSchema, money),
  cashMovementsIn: money,
  cashMovementsOut: money,
  cashRefunds: money,
  /** Espèces attendues en caisse : fond + espèces encaissées + entrées − sorties − remboursements. */
  expectedCash: z.number().int(),
  countedCash: money.nullable(),
  difference: z.number().int().nullable(),
  salesCount: count,
  salesTotal: money,
});
export type CashSession = z.infer<typeof cashSessionSchema>;

export const openSessionInputSchema = z.strictObject({ openingFloat: money });
export const cashMovementInputSchema = z.strictObject({
  direction: z.enum(['in', 'out']),
  amount: positiveMoney,
  reason: z.string().trim().min(3).max(300),
});
export const closeSessionInputSchema = z.strictObject({
  countedCash: money,
  notes: optionalText(500),
});
export const sessionListInputSchema = z.strictObject({ limit: z.number().int().min(1).max(200) });

// ---------------------------------------------------------------- Panier et vente

export const cartLineSchema = z.strictObject({
  variantId: id,
  quantity,
  discount: discountSchema.nullable(),
  /** Article suivi : une unité par article. */
  serialUnitIds: z.array(id).max(500).optional(),
  /** Kit : unités choisies pour ses composants suivis. */
  components: z
    .array(z.strictObject({ variantId: id, serialUnitIds: z.array(id).max(500) }))
    .max(100)
    .optional(),
  /** Ligne reprise d'un devis : prix et remise du devis. */
  quoteLineId: id.optional(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const paymentInputSchema = z.strictObject({
  method: paymentMethodSchema,
  amount: positiveMoney,
  reference: optionalText(64),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const checkoutInputSchema = z.strictObject({
  /** Panier mis en attente que cette vente termine. */
  heldSaleId: id.optional(),
  quoteId: id.optional(),
  customerId: id.nullable(),
  lines: z.array(cartLineSchema).min(1).max(300),
  globalDiscount: discountSchema.nullable(),
  payments: z.array(paymentInputSchema).max(10),
  /** Vente à crédit : échéances (leur somme = reste dû). */
  installments: z
    .array(z.strictObject({ dueDate: isoDate, amount: positiveMoney }))
    .max(24)
    .nullable(),
  delivery: z
    .strictObject({
      address: z.string().trim().min(3).max(300),
      scheduledOn: isoDate.nullable(),
      notes: optionalText(300),
    })
    .nullable(),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const holdInputSchema = z.strictObject({
  heldSaleId: id.optional(),
  customerId: id.nullable(),
  lines: z.array(cartLineSchema).min(1).max(300),
  globalDiscount: discountSchema.nullable(),
});
export type HoldInput = z.infer<typeof holdInputSchema>;

/** Aperçu calculé par le processus principal (mêmes règles qu'à la validation). */
export const cartPreviewSchema = z.strictObject({
  lines: z.array(
    z.strictObject({
      variantId: id,
      name: z.string(),
      variantLabel: z.string(),
      quantity,
      unitPrice: money,
      discount: money,
      lineTotal: money,
      taxIncluded: money,
    }),
  ),
  subtotal: money,
  discountTotal: money,
  total: money,
  taxIncluded: money,
  /** Problèmes bloquants (remise trop forte, stock insuffisant…). */
  issues: z.array(z.string()),
});
export type CartPreview = z.infer<typeof cartPreviewSchema>;

export const heldSaleSchema = z.strictObject({
  id,
  customerName: z.string().nullable(),
  itemCount: count,
  subtotal: money,
  updatedAt: z.string(),
  userName: z.string(),
});
export type HeldSale = z.infer<typeof heldSaleSchema>;

export const heldCartSchema = z.strictObject({
  heldSaleId: id,
  customerId: id.nullable(),
  lines: z.array(cartLineSchema),
});
export type HeldCart = z.infer<typeof heldCartSchema>;

export const saleIdInputSchema = z.strictObject({ saleId: id });

export const saleLineSchema = z.strictObject({
  id,
  parentLineId: id.nullable(),
  lineType: z.enum(['item', 'kit', 'kit_component', 'service']),
  variantId: id,
  name: z.string(),
  variantLabel: z.string(),
  sku: z.string(),
  serialNumber: z.string().nullable(),
  warrantyEnd: z.string().nullable(),
  quantity,
  unitPrice: money,
  discount: money,
  lineTotal: money,
  taxRate: z.number().int(),
  taxIncluded: money,
  /** Coût figé : null sans cost.view. */
  unitCost: money.nullable(),
  returnedQuantity: count,
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const saleDetailSchema = z.strictObject({
  id,
  invoiceNumber: z.string().nullable(),
  status: z.enum(['held', 'completed', 'cancelled']),
  customer: z.strictObject({ id, fullName: z.string(), phone: z.string().nullable() }).nullable(),
  userName: z.string(),
  completedAt: z.string().nullable(),
  subtotal: money,
  discountTotal: money,
  total: money,
  taxIncluded: money,
  amountPaid: money,
  /** Payé au total, y compris après la vente (remboursements de dette). */
  paidToDate: money,
  remaining: z.number().int(),
  dueDate: z.string().nullable(),
  /** Marge (avec cost.view). */
  margin: z.number().int().nullable(),
  cancelReason: z.string().nullable(),
  lines: z.array(saleLineSchema),
  payments: z.array(
    z.strictObject({
      id,
      method: paymentMethodSchema,
      amount: money,
      reference: z.string().nullable(),
      paidAt: z.string(),
    }),
  ),
  installments: z.array(
    z.strictObject({
      id,
      dueDate: z.string(),
      amount: money,
      paidAmount: money,
      status: z.enum(['pending', 'partial', 'paid', 'overdue']),
    }),
  ),
  delivery: z
    .strictObject({
      id,
      address: z.string(),
      status: z.enum(['to_deliver', 'delivered', 'cancelled']),
      scheduledAt: z.string().nullable(),
    })
    .nullable(),
  returns: z.array(
    z.strictObject({
      id,
      number: z.string(),
      reason: z.string(),
      refundAmount: money,
      createdAt: z.string(),
    }),
  ),
  /** Annulation encore possible (session ouverte, aucun retour). */
  cancellable: z.boolean(),
});
export type SaleDetail = z.infer<typeof saleDetailSchema>;

export const saleListInputSchema = z.strictObject({
  query: z.string().trim().max(64).optional(),
  status: z.enum(['completed', 'cancelled', 'all']),
  customerId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  beforeId: id.optional(),
  limit: z.number().int().min(1).max(200),
});
export type SaleListInput = z.infer<typeof saleListInputSchema>;

export const saleSummarySchema = z.strictObject({
  id,
  invoiceNumber: z.string(),
  status: z.enum(['completed', 'cancelled']),
  completedAt: z.string(),
  customerName: z.string().nullable(),
  userName: z.string(),
  total: money,
  remaining: z.number().int(),
  itemCount: count,
});
export type SaleSummary = z.infer<typeof saleSummarySchema>;

export const cancelSaleInputSchema = z.strictObject({
  saleId: id,
  reason: z.string().trim().min(3).max(300),
});

export const returnInputSchema = z.strictObject({
  saleId: id,
  reason: z.string().trim().min(3).max(300),
  lines: z
    .array(z.strictObject({ saleLineId: id, quantity, restock: z.boolean() }))
    .min(1)
    .max(300),
  refundMethod: z.enum(REFUND_METHODS).nullable(),
});
export type ReturnInput = z.infer<typeof returnInputSchema>;

// ---------------------------------------------------------------- Devis

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted'] as const;

export const saveQuoteInputSchema = z.strictObject({
  id: id.optional(),
  customerId: id.nullable(),
  validUntil: isoDate,
  reserveStock: z.boolean(),
  notes: optionalText(1000),
  lines: z
    .array(cartLineSchema.omit({ quoteLineId: true, components: true }))
    .min(1)
    .max(300),
  globalDiscount: discountSchema.nullable(),
});
export type SaveQuoteInput = z.infer<typeof saveQuoteInputSchema>;

export const quoteSummarySchema = z.strictObject({
  id,
  number: z.string(),
  status: z.enum(QUOTE_STATUSES),
  customerName: z.string().nullable(),
  validUntil: z.string(),
  total: money,
  reserveStock: z.boolean(),
  convertedInvoice: z.string().nullable(),
});
export type QuoteSummary = z.infer<typeof quoteSummarySchema>;

export const quoteDetailSchema = z.strictObject({
  quote: quoteSummarySchema,
  customerId: id.nullable(),
  notes: z.string().nullable(),
  subtotal: money,
  discountTotal: money,
  taxIncluded: money,
  lines: z.array(
    z.strictObject({
      id,
      variantId: id,
      description: z.string(),
      serialUnitId: id.nullable(),
      serialNumber: z.string().nullable(),
      quantity,
      unitPrice: money,
      discount: money,
      lineTotal: money,
    }),
  ),
});
export type QuoteDetail = z.infer<typeof quoteDetailSchema>;

export const quoteListInputSchema = z.strictObject({
  status: z.enum([...QUOTE_STATUSES, 'open', 'all']),
  limit: z.number().int().min(1).max(200),
});
export const quoteIdInputSchema = z.strictObject({ quoteId: id });
export const quoteStatusInputSchema = z.strictObject({
  quoteId: id,
  status: z.enum(['sent', 'accepted']),
});

// ---------------------------------------------------------------- Échéances et livraisons

export const installmentRowSchema = z.strictObject({
  id,
  saleId: id,
  invoiceNumber: z.string(),
  customerId: id.nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  dueDate: z.string(),
  amount: money,
  paidAmount: money,
  remaining: money,
  daysOverdue: z.number().int(),
});
export type InstallmentRow = z.infer<typeof installmentRowSchema>;
export const installmentListInputSchema = z.strictObject({
  scope: z.enum(['overdue', 'upcoming', 'all']),
  limit: z.number().int().min(1).max(500),
});

export const deliveryRowSchema = z.strictObject({
  id,
  saleId: id,
  invoiceNumber: z.string(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string(),
  status: z.enum(['to_deliver', 'delivered', 'cancelled']),
  scheduledAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DeliveryRow = z.infer<typeof deliveryRowSchema>;
export const deliveryListInputSchema = z.strictObject({
  status: z.enum(['to_deliver', 'delivered', 'cancelled', 'all']),
  limit: z.number().int().min(1).max(500),
});
export const deliveryUpdateInputSchema = z.strictObject({
  deliveryId: id,
  status: z.enum(['delivered', 'cancelled']),
});

// ---------------------------------------------------------------- Documents

export const DOCUMENT_KINDS = ['ticket', 'invoice', 'warranty', 'delivery_note'] as const;
export const documentInputSchema = z.strictObject({ saleId: id, kind: z.enum(DOCUMENT_KINDS) });
export const quoteDocumentInputSchema = z.strictObject({ quoteId: id });
export const ticketTextSchema = z.strictObject({ lines: z.array(z.string()) });
