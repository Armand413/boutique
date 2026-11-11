/** Dates stockées en ISO 8601 UTC (E.1), affichées en heure locale. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** Format d'affichage des dates (4.11) : jj/mm/aaaa (« fr ») ou aaaa-mm-jj (« iso »). */
let activeLocale = 'fr-FR';

export function setDateFormat(format: 'fr' | 'iso'): void {
  activeLocale = format === 'iso' ? 'sv-SE' : 'fr-FR';
}

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function isIsoUtc(value: string): boolean {
  return ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function toDate(isoUtc: string): Date {
  if (!isIsoUtc(isoUtc)) throw new RangeError(`Date ISO UTC invalide : ${isoUtc}`);
  return new Date(isoUtc);
}

export function formatDate(isoUtc: string, locale = activeLocale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(toDate(isoUtc));
}

export function formatDateTime(isoUtc: string, locale = activeLocale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(toDate(isoUtc));
}
