import { describe, expect, it, vi } from 'vitest';
import { fitScale } from '../../../src/renderer/theme/ThemeProvider';

vi.mock('../../../src/renderer/stores/preferences', () => ({ usePreferences: vi.fn() }));

describe('ajustement de l’interface à la fenêtre (D92)', () => {
  it('garde la taille normale à 1366 × 768 et réduit avec la mise à l’échelle de Windows', () => {
    expect(fitScale(1366, 700)).toBe(1);
    // 1366 × 768 à 125 % : environ 1093 × 560 pixels utiles.
    expect(fitScale(1093, 560)).toBe(0.8);
    // 150 % : bornée pour rester lisible.
    expect(fitScale(911, 460)).toBe(0.7);
  });

  it('grossit un peu sur un grand écran, sans dépasser 1,2', () => {
    expect(fitScale(1920, 1000)).toBe(1.2);
    expect(fitScale(1536, 760)).toBe(1.12);
  });
});
