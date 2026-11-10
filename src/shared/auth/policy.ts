/**
 * Règles d'authentification partagées (B.1). Le processus principal les applique ;
 * l'interface les reprend pour guider la saisie.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

/** Durée de verrouillage par défaut après inactivité, en minutes (paramétrable). */
export const DEFAULT_IDLE_LOCK_MINUTES = 5;

/**
 * Délai imposé après `failures` échecs consécutifs, en secondes :
 * aucun avant 3 échecs, puis 5 s et 10 s, puis verrouillage de 15 min, 30 min... jusqu'à 1 h.
 */
export function lockoutSeconds(failures: number): number {
  if (failures < 3) return 0;
  if (failures < 5) return 5 * 2 ** (failures - 3);
  return 900 * Math.min(4, failures - 4);
}

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_username';

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

function graphemeCount(text: string): number {
  let count = 0;
  for (const segment of graphemes.segment(text)) {
    if (segment.segment !== '') count += 1;
  }
  return count;
}

export function passwordProblems(
  password: string,
  username: string,
  isCommon: (candidate: string) => boolean,
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  // Longueur en caractères affichés (graphèmes) : une lettre accentuée ou un emoji compte pour un.
  const length = graphemeCount(password);
  if (length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long');
  if (isCommon(password)) problems.push('common');
  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    problems.push('contains_username');
  }
  return problems;
}

export type PinProblem = 'format' | 'trivial';

export function pinProblems(pin: string): PinProblem[] {
  const pattern = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);
  if (!pattern.test(pin)) return ['format'];
  const digits = Array.from(pin, Number);
  const allSame = digits.every((digit) => digit === digits[0]);
  const step = (digits[1] ?? 0) - (digits[0] ?? 0);
  const sequential =
    Math.abs(step) === 1 &&
    digits.every((digit, index) => digit === (digits[0] ?? 0) + index * step);
  return allSame || sequential ? ['trivial'] : [];
}
