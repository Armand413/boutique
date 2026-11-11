import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { ReportColumn, ReportRow } from '@shared/schemas/reports';
import { isTranslationKey, type Translate } from '../../i18n';

/** Jour local AAAA-MM-JJ (fuseau du poste). */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export const PRESETS = ['today', 'week', 'month', 'lastMonth', 'year', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];

/** Période d'un raccourci, en jours locaux inclus. */
export function presetPeriod(preset: Exclude<Preset, 'custom'>, now = new Date()) {
  const today = localDay(now);
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const monday = new Date(year, month, now.getDate() - ((now.getDay() + 6) % 7));
      return { from: localDay(monday), to: today };
    }
    case 'month':
      return { from: localDay(new Date(year, month, 1)), to: today };
    case 'lastMonth':
      return {
        from: localDay(new Date(year, month - 1, 1)),
        to: localDay(new Date(year, month, 0)),
      };
    case 'year':
      return { from: localDay(new Date(year, 0, 1)), to: today };
  }
}

function dayText(value: string): string {
  const [year, month, day] = value.split('-');
  return day === undefined ? value : `${day}/${month ?? ''}/${year ?? ''}`;
}

/** Libellé d'une colonne : clé de traduction `report.col.*`, sinon le code tel quel. */
export function columnLabel(t: Translate, column: ReportColumn): string {
  const key = `report.col.${column.key}`;
  return isTranslationKey(key) ? t(key) : column.key;
}

export function summaryLabel(t: Translate, key: string): string {
  const full = `report.summary.${key}`;
  return isTranslationKey(full) ? t(full) : key;
}

export function isNumeric(column: Pick<ReportColumn, 'type'>): boolean {
  return column.type === 'int' || column.type === 'money' || column.type === 'percent';
}

/** Valeur affichée d'une cellule, selon le type de la colonne. */
export function cellText(
  t: Translate,
  column: ReportColumn,
  value: ReportRow[string] | undefined,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (column.type === 'money') return formatMoney(value);
    if (column.type === 'percent') return `${value.toLocaleString('fr-FR')} %`;
    return value.toLocaleString('fr-FR');
  }
  if (column.type === 'enum' && column.enumKey !== null) {
    const key = `${column.enumKey}.${value}`;
    return isTranslationKey(key) ? t(key) : value;
  }
  if (column.type === 'datetime' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  if (column.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return dayText(value);
  return value;
}
