import { describe, expect, it, vi } from 'vitest';
import { initialSize } from '../../../src/main/security/window';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), screen: {} }));

describe('taille de départ de la fenêtre (D92)', () => {
  it('tient dans la zone de travail d’un petit écran et s’agrandit', () => {
    expect(initialSize({ width: 1093, height: 584 })).toEqual({
      width: 1093,
      height: 584,
      maximize: true,
    });
  });

  it('garde 1366 × 768 sur un grand écran', () => {
    expect(initialSize({ width: 1920, height: 1040 })).toEqual({
      width: 1366,
      height: 768,
      maximize: false,
    });
  });
});
