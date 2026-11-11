/** Clé de Luhn (ISO/IEC 7812) sur une chaîne de chiffres. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    const doubled = index % 2 === 1 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** IMEI : 15 chiffres avec clé de Luhn (même règle que le trigger de la base). */
export function isValidImei(value: string): boolean {
  return value.length === 15 && luhnValid(value);
}

/** Saisie d'un numéro (IMEI, série) : espaces retirés, lettres en majuscules. */
export function normalizeSerial(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}
