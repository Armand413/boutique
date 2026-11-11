import { describe, expect, it } from 'vitest';
import { allowedTrackingModes, coerceTrackingMode } from '../../../src/shared/catalog/constants';

describe('mode de suivi par défaut', () => {
  it('réserve l’IMEI proposé par la famille aux téléphones', () => {
    expect(coerceTrackingMode('phone', 'none')).toBe('imei');
    expect(coerceTrackingMode('accessory', 'imei')).toBe('none');
    expect(coerceTrackingMode('electronics', 'serial')).toBe('serial');
    expect(coerceTrackingMode('kit', 'serial')).toBe('none');
  });

  it('laisse choisir explicitement le suivi d’un article stocké', () => {
    expect(allowedTrackingModes('electronics')).toEqual(['none', 'serial', 'imei']);
    expect(allowedTrackingModes('phone')).toEqual(['imei']);
    expect(allowedTrackingModes('service')).toEqual(['none']);
  });
});
