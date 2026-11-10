/**
 * Montants : toujours des entiers dans la plus petite unité de la devise (C.2, E.1).
 * Par défaut le franc CFA, sans décimales.
 */
export interface CurrencyConfig {
  /** Code ISO 4217 (XOF, XAF, EUR...). */
  code: string;
  /** Symbole affiché après le montant. */
  symbol: string;
  /** Nombre de décimales de la plus petite unité (0 pour le FCFA, 2 pour l'euro). */
  decimals: number;
}

export const DEFAULT_CURRENCY: CurrencyConfig = { code: 'XOF', symbol: 'FCFA', decimals: 0 };

export function assertMinorAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Montant invalide : ${String(amount)} n'est pas un entier exact.`);
  }
}

/** Formate un montant entier (ex. 125000) en texte (ex. « 125 000 FCFA »). */
export function formatMoney(
  amount: number,
  currency: CurrencyConfig = DEFAULT_CURRENCY,
  locale = 'fr-FR',
): string {
  assertMinorAmount(amount);
  if (!Number.isInteger(currency.decimals) || currency.decimals < 0 || currency.decimals > 4) {
    throw new RangeError(`Nombre de décimales invalide : ${String(currency.decimals)}.`);
  }
  const value = amount / 10 ** currency.decimals;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(value);
  return `${number}\u00a0${currency.symbol}`;
}

/** Convertit une saisie utilisateur (« 12 500 », « 12,50 ») en entier ; null si invalide. */
export function parseMoney(
  input: string,
  currency: CurrencyConfig = DEFAULT_CURRENCY,
): number | null {
  const compact = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const pattern =
    currency.decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(\\.\\d{1,${currency.decimals}})?$`);
  if (!pattern.test(compact)) return null;
  const [whole = '0', fraction = ''] = compact.replace('-', '').split('.');
  const minor =
    Number(whole) * 10 ** currency.decimals +
    Number(fraction.padEnd(currency.decimals, '0') || '0');
  const signed = compact.startsWith('-') ? -minor : minor;
  return Number.isSafeInteger(signed) ? signed : null;
}
