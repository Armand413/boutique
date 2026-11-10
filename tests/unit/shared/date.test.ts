import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, isIsoUtc, nowIsoUtc } from '@shared/format/date';

describe('dates ISO 8601 UTC', () => {
  it('produit une date ISO UTC valide', () => {
    expect(isIsoUtc(nowIsoUtc())).toBe(true);
  });

  it('accepte uniquement le format UTC terminé par Z', () => {
    expect(isIsoUtc('2026-11-10T08:30:00Z')).toBe(true);
    expect(isIsoUtc('2026-11-10T08:30:00.123Z')).toBe(true);
    expect(isIsoUtc('2026-11-10T08:30:00+01:00')).toBe(false);
    expect(isIsoUtc('2026-11-10')).toBe(false);
    expect(isIsoUtc('2026-13-45T99:99:99Z')).toBe(false);
  });

  it('formate en français dans le fuseau demandé', () => {
    expect(formatDate('2026-11-10T23:30:00Z', 'fr-FR', 'UTC')).toBe('10/11/2026');
    expect(formatDate('2026-11-10T23:30:00Z', 'fr-FR', 'Europe/Paris')).toBe('11/11/2026');
    expect(formatDateTime('2026-11-10T08:05:00Z', 'fr-FR', 'UTC')).toBe('10/11/2026 08:05');
  });

  it('refuse une date invalide', () => {
    expect(() => formatDate('hier')).toThrow(RangeError);
  });
});
