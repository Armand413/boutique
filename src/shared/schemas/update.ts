import { z } from 'zod';

/**
 * Mise à jour par un nouveau setup.exe (phase 10, D82) : l'installateur est choisi par le processus
 * principal, copié, puis vérifié (signature Authenticode, produit, version) avant toute installation.
 */
export const installerSignatureSchema = z.enum(['valid', 'unsigned', 'invalid']);
export type InstallerSignature = z.infer<typeof installerSignatureSchema>;

export const updatePreviewSchema = z.strictObject({
  token: z.string(),
  fileName: z.string(),
  version: z.string(),
  currentVersion: z.string(),
  signature: installerSignatureSchema,
  signer: z.string().nullable(),
  /** `ready` : installable ; `unsigned` : installable après accord explicite ; `refused` : jamais. */
  verdict: z.enum(['ready', 'unsigned', 'refused']),
  reason: z.string().nullable(),
});
export type UpdatePreview = z.infer<typeof updatePreviewSchema>;

export const updateInstallInputSchema = z.strictObject({
  token: z.string().min(1).max(64),
  currentPassword: z.string().min(1).max(256),
  /** Accord explicite pour un installateur non signé (application elle-même non signée). */
  acceptUnsigned: z.boolean(),
});
export type UpdateInstallInput = z.infer<typeof updateInstallInputSchema>;
