import type { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type { Db } from '../db/types';

/** Lit un paramètre JSON et le valide ; une valeur absente ou invalide est une erreur explicite. */
export function getSetting<S extends z.ZodType>(db: Db, key: string, schema: S): z.output<S> {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key);
  if (typeof raw !== 'string') throw new AppError('INTERNAL_ERROR', `Paramètre absent : ${key}.`);
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new AppError('INTERNAL_ERROR', `Paramètre invalide : ${key}.`);
  return parsed.data;
}

export function setSetting(db: Db, key: string, value: unknown, userId: number | null): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(key, JSON.stringify(value), nowIsoUtc(), userId);
}
