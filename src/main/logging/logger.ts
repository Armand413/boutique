import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Readonly<Record<Level, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const FILE_PREFIX = 'app-';
const KEEP_FILES = 14;

let logDirectory: string | null = null;
let minimumLevel: Level = 'info';

/** Initialise le journal dans `directory` et supprime les fichiers les plus anciens. */
export function initLogger(directory: string, level: Level = 'info'): void {
  mkdirSync(directory, { recursive: true });
  logDirectory = directory;
  minimumLevel = level;
  pruneOldFiles(directory);
}

function pruneOldFiles(directory: string): void {
  const files = readdirSync(directory)
    .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.log'))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - KEEP_FILES))) {
    rmSync(join(directory, name), { force: true });
  }
}

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
  const timestamp = new Date().toISOString();
  const line = JSON.stringify({
    t: timestamp,
    level,
    message,
    ...(context ? { context: redact(context) } : {}),
  });
  if (logDirectory === null) {
    process.stderr.write(`${line}\n`);
    return;
  }
  const file = join(logDirectory, `${FILE_PREFIX}${timestamp.slice(0, 10)}.log`);
  try {
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`Écriture du journal impossible : ${String(error)}\n${line}\n`);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>): void =>
    write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>): void =>
    write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>): void =>
    write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>): void =>
    write('error', message, context),
};
