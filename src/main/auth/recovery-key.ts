import { randomBytes } from 'node:crypto';

/** Base32 de Crockford : sans I, L, O ni U pour éviter les confusions à la recopie. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 20;
export const RECOVERY_KEY_LENGTH = 32;

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET.charAt((value << (5 - bits)) & 31);
  return output;
}

/** Clé de récupération de 160 bits, affichée en 8 groupes de 4 caractères. */
export function generateRecoveryKey(): string {
  const canonical = encodeBase32(randomBytes(KEY_BYTES));
  return canonical.match(/.{4}/g)?.join('-') ?? canonical;
}

/**
 * Forme canonique d'une saisie : majuscules, sans tirets ni espaces, O lu comme 0 et I/L comme 1.
 * Renvoie null si la saisie ne peut pas être une clé de récupération.
 */
export function normalizeRecoveryKey(input: string): string | null {
  const canonical = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (canonical.length !== RECOVERY_KEY_LENGTH) return null;
  for (const character of canonical) {
    if (!ALPHABET.includes(character)) return null;
  }
  return canonical;
}
