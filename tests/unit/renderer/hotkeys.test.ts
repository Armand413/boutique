import { describe, expect, it } from 'vitest';
import { matchesCombo, parseCombo, type KeyLike } from '../../../src/renderer/hotkeys/hotkeys';

const key = (value: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('raccourcis clavier', () => {
  it('analyse un raccourci avec modificateurs', () => {
    expect(parseCombo('Ctrl+Shift+K')).toEqual({ key: 'K', ctrl: true, alt: false, shift: true });
    expect(parseCombo('F4')).toEqual({ key: 'F4', ctrl: false, alt: false, shift: false });
  });

  it('refuse un raccourci invalide', () => {
    expect(() => parseCombo('')).toThrow();
    expect(() => parseCombo('Ctrl+')).toThrow();
    expect(() => parseCombo('Super+K')).toThrow();
  });

  it('reconnaît les touches de la caisse sans modificateur', () => {
    expect(matchesCombo(key('F2'), 'F2')).toBe(true);
    expect(matchesCombo(key('F2', { ctrlKey: true }), 'F2')).toBe(false);
    expect(matchesCombo(key('Escape'), 'Escape')).toBe(true);
  });

  it('traite Cmd comme Ctrl et ignore la casse', () => {
    expect(matchesCombo(key('k', { ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesCombo(key('k', { metaKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesCombo(key('k'), 'Ctrl+K')).toBe(false);
  });
});
