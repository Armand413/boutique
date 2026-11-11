import { z } from 'zod';

const secret = z.string().min(1).max(256);

export const backupHistoryItemSchema = z.strictObject({
  id: z.number().int(),
  type: z.enum(['auto', 'manual', 'pre_migration']),
  createdAt: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['success', 'failed']),
});

export const backupStatusSchema = z.strictObject({
  passwordSet: z.boolean(),
  autoEnabled: z.boolean(),
  keep: z.number().int(),
  reminderDays: z.number().int(),
  lastAuto: z.string().nullable(),
  lastManual: z.string().nullable(),
  /** Aucune copie externe (manuelle) depuis `reminderDays` jours (4.10). */
  reminderDue: z.boolean(),
  autoDirectory: z.string(),
  history: z.array(backupHistoryItemSchema),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupPasswordInputSchema = z.strictObject({
  currentPassword: secret,
  password: z.string().min(1).max(256),
});

export const backupSettingsInputSchema = z.strictObject({
  autoEnabled: z.boolean(),
  keep: z.number().int().min(1).max(60),
  reminderDays: z.number().int().min(1).max(90),
});
export type BackupSettingsInput = z.infer<typeof backupSettingsInputSchema>;

export const backupPreviewSchema = z.strictObject({
  token: z.string(),
  fileName: z.string(),
  kind: z.enum(['auto', 'manual', 'safety']),
  createdAt: z.string(),
  shopName: z.string(),
  appVersion: z.string(),
  /** Faux si la sauvegarde vient d'une version plus récente de l'application. */
  compatible: z.boolean(),
});
export type BackupPreview = z.infer<typeof backupPreviewSchema>;

export const restoreInputSchema = z.strictObject({
  token: z.string().min(1).max(64),
  password: secret,
  /** Mot de passe de l'utilisateur connecté (restauration depuis les paramètres). */
  currentPassword: secret.nullable(),
});
export type RestoreInput = z.infer<typeof restoreInputSchema>;
