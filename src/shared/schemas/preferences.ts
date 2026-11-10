import { z } from 'zod';

export const THEMES = ['light', 'dark', 'system'] as const;
export const LANGUAGES = ['fr', 'en'] as const;
/** Échelle du texte en pourcentage (A.6 : taille de texte ajustable). */
export const TEXT_SCALES = [90, 100, 110, 125] as const;

export const themeSchema = z.enum(THEMES);
export const languageSchema = z.enum(LANGUAGES);
export const textScaleSchema = z.union([
  z.literal(90),
  z.literal(100),
  z.literal(110),
  z.literal(125),
]);

/** Préférences d'affichage propres au poste (pas des données métier). */
export const preferencesSchema = z.strictObject({
  theme: themeSchema,
  language: languageSchema,
  textScale: textScaleSchema,
});

export const preferencesPatchSchema = preferencesSchema.partial().strict();

export type Theme = z.infer<typeof themeSchema>;
export type Language = z.infer<typeof languageSchema>;
export type TextScale = z.infer<typeof textScaleSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  language: 'fr',
  textScale: 100,
};
