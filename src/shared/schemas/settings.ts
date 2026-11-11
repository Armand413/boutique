import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const shopSettingsSchema = z.strictObject({
  name: z.string().trim().min(1, 'Indiquez le nom de la boutique.').max(120),
  address: optionalText(300),
  phone: optionalText(40),
  email: optionalText(120),
  /** Mentions légales imprimées en pied de facture (RCCM, NIF…). */
  legal: optionalText(500),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export const DATE_FORMATS = ['fr', 'iso'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const regionalSettingsSchema = z.strictObject({
  currency: z.strictObject({
    code: z.string().regex(/^[A-Z]{3}$/, 'Code ISO à trois lettres (XOF, XAF, EUR…).'),
    symbol: z.string().trim().min(1).max(8),
    decimals: z.number().int().min(0).max(3),
  }),
  dateFormat: z.enum(DATE_FORMATS),
  invoicePrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,8}$/, 'Préfixe de 1 à 8 lettres majuscules ou chiffres.'),
});
export type RegionalSettings = z.infer<typeof regionalSettingsSchema>;

export const printerSettingsSchema = z.strictObject({
  /** null : simulateur (fichiers) ; sinon imprimante ESC/POS réseau. */
  receipt: z
    .strictObject({
      host: z.string().regex(/^[\w.-]{1,253}$/, 'Adresse IP ou nom de l’imprimante.'),
      port: z.number().int().min(1).max(65535),
    })
    .nullable(),
  receiptWidth: z.union([z.literal(32), z.literal(48)]),
  labelLayout: z.enum(['sheet', 'roll']),
});
export type PrinterSettings = z.infer<typeof printerSettingsSchema>;

const cap = z.number().int().min(0).max(10_000);

export const securitySettingsSchema = z.strictObject({
  idleLockMinutes: z.number().int().min(1).max(120),
  /** Plafonds de remise en centièmes de pourcent ; null : sans plafond (D52). */
  discountCaps: z.strictObject({ seller: cap, manager: cap, admin: cap.nullable() }),
  inventoryDoubleCheck: z.boolean(),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

export const fraudSettingsSchema = z.strictObject({
  /** Remise d'une ligne au-delà de laquelle une vente est signalée (centièmes de pourcent). */
  discountAlert: z.number().int().min(100).max(10_000),
  /** Ajustements, pertes et sorties manuelles d'un même utilisateur sur un jour. */
  adjustmentsPerDay: z.number().int().min(1).max(100),
  /** Écart de caisse (en valeur absolue) à partir duquel une clôture est signalée. */
  cashDifference: z.number().int().min(0),
});
export type FraudSettings = z.infer<typeof fraudSettingsSchema>;

export const taxRateInputSchema = z.strictObject({
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1).max(60),
  rate: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});
export type TaxRateInput = z.infer<typeof taxRateInputSchema>;

export const allSettingsSchema = z.strictObject({
  shop: shopSettingsSchema,
  logo: z.string().nullable(),
  regional: regionalSettingsSchema,
  /** Les décimales de la devise ne changent plus une fois des montants enregistrés. */
  decimalsLocked: z.boolean(),
  printer: printerSettingsSchema,
  security: securitySettingsSchema,
  fraud: fraudSettingsSchema,
  taxRates: z.array(
    z.strictObject({
      id: z.number().int(),
      name: z.string(),
      rate: z.number().int(),
      isActive: z.boolean(),
    }),
  ),
});
export type AllSettings = z.infer<typeof allSettingsSchema>;

/** Réglages lus par toute session (affichage des montants et des dates). */
export const publicSettingsSchema = z.strictObject({
  shopName: z.string(),
  currency: regionalSettingsSchema.shape.currency,
  dateFormat: z.enum(DATE_FORMATS),
  labelLayout: z.enum(['sheet', 'roll']),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
