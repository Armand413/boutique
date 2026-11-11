import { describe, expect, it, vi } from 'vitest';
import { translate } from '../../../src/renderer/i18n/index';
import type { TranslationKey } from '../../../src/renderer/i18n/fr';
import {
  cellText,
  columnLabel,
  presetPeriod,
} from '../../../src/renderer/pages/reports/report-format';

vi.mock('../../../src/renderer/stores/preferences', () => ({ usePreferences: vi.fn() }));

const t = (key: TranslationKey) => translate('fr', key);
const column = (
  type: 'money' | 'enum' | 'date' | 'percent',
  enumKey: 'movement' | null = null,
) => ({
  key: 'x',
  type,
  sensitive: false,
  enumKey,
});

describe('format des rapports', () => {
  it('calcule les raccourcis de période en jours locaux', () => {
    const now = new Date(2026, 10, 11, 15, 0);
    expect(presetPeriod('today', now)).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(presetPeriod('week', now)).toEqual({ from: '2026-11-09', to: '2026-11-11' });
    expect(presetPeriod('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetPeriod('year', new Date(2027, 0, 3))).toEqual({
      from: '2027-01-01',
      to: '2027-01-03',
    });
  });

  it('traduit codes et colonnes, formate montants, pourcentages et dates', () => {
    expect(cellText(t, column('enum', 'movement'), 'transfer_in')).toBe('Transfert reçu');
    expect(cellText(t, column('money'), 15_000)).toMatch(/^15\s000\sFCFA$/);
    expect(cellText(t, column('percent'), 23.5)).toBe('23,5 %');
    expect(cellText(t, column('date'), '2026-01-15')).toBe('15/01/2026');
    expect(cellText(t, column('money'), null)).toBe('—');
    expect(columnLabel(t, { ...column('money'), key: 'stock_value' })).toBe('Valeur au coût');
    expect(columnLabel(t, { ...column('money'), key: 'inconnue' })).toBe('inconnue');
  });
});
