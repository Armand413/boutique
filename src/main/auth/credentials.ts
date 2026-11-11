import {
  lockoutSeconds,
  passwordProblems,
  pinProblems,
  PASSWORD_MIN_LENGTH,
} from '@shared/auth/policy';
import { AppError } from '@shared/ipc/errors';
import { isCommonPassword } from './common-passwords';

const PASSWORD_MESSAGES = {
  too_short: `il doit compter au moins ${PASSWORD_MIN_LENGTH} caractères`,
  too_long: 'il doit compter 128 caractères au plus',
  common: 'il est trop courant ou trop facile à deviner',
  contains_username: 'il ne doit pas contenir votre identifiant',
} as const;

export function assertPasswordAcceptable(password: string, username: string): void {
  const problems = passwordProblems(password, username, isCommonPassword);
  if (problems.length > 0) {
    const rules = problems.map((problem) => PASSWORD_MESSAGES[problem]).join(' ; ');
    throw new AppError('VALIDATION_ERROR', `Mot de passe refusé : ${rules}.`);
  }
}

export function assertPinAcceptable(pin: string): void {
  const problems = pinProblems(pin);
  if (problems.includes('format')) {
    throw new AppError('VALIDATION_ERROR', 'Le code PIN compte de 4 à 8 chiffres.');
  }
  if (problems.includes('trivial')) {
    throw new AppError('VALIDATION_ERROR', 'Code PIN trop simple : évitez 0000, 1234 ou 9876.');
  }
}

/** Date de fin de blocage après `failures` échecs, ou null s'il n'y a pas de délai. */
export function lockedUntilAfter(failures: number, now: number): string | null {
  const seconds = lockoutSeconds(failures);
  return seconds === 0 ? null : new Date(now + seconds * 1000).toISOString();
}

export function remainingLockSeconds(lockedUntil: string | null, now: number): number {
  if (lockedUntil === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(lockedUntil) - now) / 1000));
}

export function lockedMessage(seconds: number): string {
  if (seconds < 60) return `Trop de tentatives. Réessayez dans ${seconds} s.`;
  const minutes = Math.ceil(seconds / 60);
  return `Trop de tentatives : compte bloqué. Réessayez dans ${minutes} min ou adressez-vous à l’administrateur.`;
}
