import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

export const REPORT_KINDS = [
  'sales',
  'products',
  'stock',
  'balances',
  'movements',
  'cash',
  'followups',
  'sensitive',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Rapports qui portent sur une période (les autres décrivent l'état présent). */
export const PERIOD_REPORTS: readonly ReportKind[] = [
  'sales',
  'products',
  'movements',
  'cash',
  'sensitive',
];

/** Rapport d'activités sensibles (B.4b) : administrateur seulement (`audit.view`). */
export const ADMIN_REPORTS: readonly ReportKind[] = ['sensitive'];

export const SALES_GROUPS = [
  'day',
  'month',
  'seller',
  'family',
  'category',
  'brand',
  'product',
] as const;
export const STOCK_GROUPS = ['family', 'category', 'brand', 'location'] as const;
export const PRODUCT_ORDERS = ['best', 'worst'] as const;
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

const period = z
  .strictObject({ from: day, to: day })
  .refine((value) => value.from <= value.to, 'La date de début doit précéder la date de fin.')
  .refine(
    (value) => Date.parse(value.to) - Date.parse(value.from) <= 1000 * 86_400 * 3660,
    'Période limitée à dix ans.',
  );

export const reportRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sales'), period, groupBy: z.enum(SALES_GROUPS) }),
  z.strictObject({ kind: z.literal('products'), period, order: z.enum(PRODUCT_ORDERS) }),
  z.strictObject({ kind: z.literal('stock'), groupBy: z.enum(STOCK_GROUPS) }),
  z.strictObject({ kind: z.literal('balances') }),
  z.strictObject({
    kind: z.literal('movements'),
    period,
    movementType: z.enum(MOVEMENT_TYPES).nullable(),
  }),
  z.strictObject({ kind: z.literal('cash'), period }),
  z.strictObject({ kind: z.literal('followups') }),
  z.strictObject({ kind: z.literal('sensitive'), period }),
]);
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export const COLUMN_TYPES = [
  'text',
  'enum',
  'int',
  'money',
  'percent',
  'date',
  'datetime',
] as const;

/** Familles de codes traduits à l'affichage (colonne `enum`) : la valeur est un code stable. */
export const ENUM_KEYS = ['movement', 'party', 'followup', 'payment', 'fraud'] as const;
export type EnumKey = (typeof ENUM_KEYS)[number];

export const reportColumnSchema = z.strictObject({
  key: z.string(),
  type: z.enum(COLUMN_TYPES),
  /** Coût, marge ou valeur au coût : jamais servi sans la permission `cost.view` (B.2). */
  sensitive: z.boolean(),
  enumKey: z.enum(ENUM_KEYS).nullable(),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

const cell = z.union([z.string(), z.number(), z.null()]);

export const reportResultSchema = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  generatedAt: z.string(),
  columns: z.array(reportColumnSchema),
  rows: z.array(z.record(z.string(), cell)),
  totals: z.record(z.string(), cell).nullable(),
  /** Chiffres clés affichés au-dessus du tableau. */
  summary: z.array(
    z.strictObject({ key: z.string(), type: z.enum(COLUMN_TYPES), value: z.number() }),
  ),
  chart: z
    .strictObject({
      type: z.enum(['bar', 'line']),
      labelKey: z.string(),
      series: z.array(z.string()),
    })
    .nullable(),
  /** Vrai si la liste a été coupée à la limite d'affichage (l'export reprend tout). */
  truncated: z.boolean(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;
export type ReportRow = ReportResult['rows'][number];

export const reportExportInputSchema = z.strictObject({
  request: reportRequestSchema,
  format: z.enum(['pdf', 'xlsx', 'csv']),
});
export type ReportExportInput = z.infer<typeof reportExportInputSchema>;

const amountWithCount = z.strictObject({
  count: z.number().int(),
  revenueTtc: z.number().int(),
  margin: z.number().int().nullable(),
});

export const dashboardSchema = z.strictObject({
  today: amountWithCount,
  week: amountWithCount,
  month: amountWithCount,
  lowStock: z.number().int().nullable(),
  overdueInstallments: z.number().int(),
  openClaims: z.number().int(),
  /** Activités sensibles des 7 derniers jours (administrateur seulement). */
  sensitive: z.number().int().nullable(),
  days: z.array(
    z.strictObject({ day, revenueTtc: z.number().int(), margin: z.number().int().nullable() }),
  ),
  families: z.array(
    z.strictObject({
      name: z.string(),
      revenueTtc: z.number().int(),
      margin: z.number().int().nullable(),
    }),
  ),
  latestSales: z.array(
    z.strictObject({
      saleId: z.number().int(),
      invoiceNumber: z.string(),
      completedAt: z.string(),
      customerName: z.string().nullable(),
      total: z.number().int(),
    }),
  ),
  latestMovements: z
    .array(
      z.strictObject({
        id: z.number().int(),
        createdAt: z.string(),
        productName: z.string(),
        movementType: z.enum(MOVEMENT_TYPES),
        quantity: z.number().int(),
        locationName: z.string(),
      }),
    )
    .nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
