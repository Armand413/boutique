import Database from 'better-sqlite3-multiple-ciphers';
import { AppError } from '@shared/ipc/errors';

/** Message d'un RAISE(ABORT, 'CODE: message') posé par un trigger. */
const RULE_MESSAGE = /^([A-Z0-9_]+): (.+)$/;

export function ruleCodeOf(error: unknown): string | null {
  if (!(error instanceof Database.SqliteError)) return null;
  return RULE_MESSAGE.exec(error.message)?.[1] ?? null;
}

/**
 * Traduit une violation de règle de la base en erreur métier lisible.
 * Renvoie null pour toute autre erreur (qui reste une erreur interne).
 */
export function toAppError(error: unknown): AppError | null {
  if (!(error instanceof Database.SqliteError)) return null;
  if (error.code === 'SQLITE_CONSTRAINT_TRIGGER') {
    const match = RULE_MESSAGE.exec(error.message);
    if (match?.[2] !== undefined) return new AppError('CONFLICT', capitalize(match[2]) + '.');
  }
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return new AppError('CONFLICT', 'Cette valeur est déjà utilisée.');
  }
  if (error.code === 'SQLITE_BUSY') {
    return new AppError('UNAVAILABLE', 'La base est occupée. Réessayez dans un instant.');
  }
  return null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
