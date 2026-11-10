import { describe, expect, it } from 'vitest';
import {
  assertMinorAmount,
  formatMoney,
  parseMoney,
  type CurrencyConfig,
} from '@shared/format/money';

const EURO: CurrencyConfig = { code: 'EUR', symbol: '€', decimals: 2 };
/** Remplace les espaces insécables produites par Intl pour comparer simplement. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('formate le FCFA sans décimales avec séparateur de milliers', () => {
    expect(plain(formatMoney(125000))).toBe('125 000 FCFA');
    expect(plain(formatMoney(0))).toBe('0 FCFA');
    expect(plain(formatMoney(-2500))).toBe('-2 500 FCFA');
  });

  it('formate une devise à deux décimales depuis les centimes', () => {
    expect(plain(formatMoney(1250, EURO))).toBe('12,50 €');
  });

  it('refuse un montant non entier ou hors limites', () => {
    expect(() => formatMoney(12.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => {
      assertMinorAmount(Number.NaN);
    }).toThrow(RangeError);
  });

  it('refuse un nombre de décimales invalide', () => {
    expect(() => formatMoney(1, { ...EURO, decimals: 5 })).toThrow(RangeError);
    expect(() => formatMoney(1, { ...EURO, decimals: -1 })).toThrow(RangeError);
  });
});

describe('parseMoney', () => {
  it('lit une saisie FCFA avec espaces ordinaires ou insécables', () => {
    expect(parseMoney('12 500')).toBe(12500);
    expect(parseMoney('12\u00a0500')).toBe(12500);
    expect(parseMoney('12\u202f500')).toBe(12500);
    expect(parseMoney('-300')).toBe(-300);
  });

  it('refuse des décimales en FCFA et du texte', () => {
    expect(parseMoney('12,5')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1e3')).toBeNull();
  });

  it('convertit une saisie à décimales en plus petite unité', () => {
    expect(parseMoney('12,50', EURO)).toBe(1250);
    expect(parseMoney('12.5', EURO)).toBe(1250);
    expect(parseMoney('12', EURO)).toBe(1200);
    expect(parseMoney('-0,05', EURO)).toBe(-5);
    expect(parseMoney('12,505', EURO)).toBeNull();
  });

  it('refuse un montant qui dépasse les entiers exacts', () => {
    expect(parseMoney('99999999999999999999')).toBeNull();
  });

  it('relit ce que formatMoney affiche', () => {
    for (const amount of [0, 1, 999, 1000, 125000, 987654321]) {
      const shown = formatMoney(amount).replace(/[\u00a0\u202f ]FCFA$/, '');
      expect(parseMoney(shown)).toBe(amount);
    }
  });
});
