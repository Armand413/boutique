import type { Language } from '@shared/schemas/preferences';
import { usePreferences } from '../stores/preferences';
import { en } from './en';
import { fr, type TranslationKey } from './fr';

const DICTIONARIES: Readonly<Record<Language, Readonly<Record<TranslationKey, string>>>> = {
  fr,
  en,
};

export type TranslationParams = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export function translate(
  language: Language,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const template = DICTIONARIES[language][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Vrai si `key` est une clé connue (clés construites à partir d'un code renvoyé par le service). */
export function isTranslationKey(key: string): key is TranslationKey {
  return Object.hasOwn(fr, key);
}

/** Hook de traduction : suit la langue choisie dans les préférences. */
export function useT(): Translate {
  const language = usePreferences((state) => state.preferences.language);
  return (key, params) => translate(language, key, params);
}

export type { TranslationKey };
