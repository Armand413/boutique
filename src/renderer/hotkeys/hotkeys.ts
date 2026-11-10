import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Raccourcis clavier centralisés. Raccourcis réservés à la caisse (A.5) :
 * F2 nouvelle vente, F4 encaisser, F8 mise en attente, Échap annuler.
 */
export const RESERVED_POS_HOTKEYS = ['F2', 'F4', 'F8', 'Escape'] as const;

interface ParsedCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+').map((part) => part.trim());
  const key = parts.pop();
  if (key === undefined || key === '') throw new Error(`Raccourci invalide : « ${combo} »`);
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  for (const modifier of modifiers) {
    if (!['ctrl', 'alt', 'shift'].includes(modifier)) {
      throw new Error(`Modificateur inconnu « ${modifier} » dans « ${combo} »`);
    }
  }
  return {
    key,
    ctrl: modifiers.has('ctrl'),
    alt: modifiers.has('alt'),
    shift: modifiers.has('shift'),
  };
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function matchesCombo(event: KeyLike, combo: string): boolean {
  const parsed = parseCombo(combo);
  return (
    event.key.toLowerCase() === parsed.key.toLowerCase() &&
    (event.ctrlKey || event.metaKey) === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

interface HotkeyOptions {
  enabled?: boolean;
}

/** Associe un raccourci à une action tant que le composant est affiché. */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return undefined;
    parseCombo(combo);
    const listener = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !matchesCombo(event, combo)) return;
      event.preventDefault();
      handlerRef.current(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [combo, enabled]);
}
