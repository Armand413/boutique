// Génère db/migrations/*.sql depuis db/templates/*.sql en développant quelques macros SQL.
// Les fichiers générés sont versionnés et immuables une fois appliqués : ce script refuse
// de modifier un fichier existant dont le contenu changerait (sauf --force, avant toute livraison).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'db', 'templates');
const outputDir = join(root, 'db', 'migrations');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const ISO_PATTERN =
  "'[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'";
const DATE_PATTERN = "'[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'";

function luhn(expression) {
  const digit = (position) => `CAST(substr(${expression}, ${position}, 1) AS INTEGER)`;
  const terms = Array.from({ length: 15 }, (_, index) => {
    const position = index + 1;
    return position % 2 === 0
      ? `(2 * ${digit(position)} - 9 * (${digit(position)} >= 5))`
      : digit(position);
  });
  return `(length(${expression}) = 15 AND ${expression} NOT GLOB '*[^0-9]*' AND (${terms.join(' + ')}) % 10 = 0)`;
}

const MACROS = {
  NOW: () => NOW,
  STD: () =>
    [
      `created_at TEXT NOT NULL DEFAULT ${NOW} CHECK (created_at GLOB ${ISO_PATTERN})`,
      `  updated_at TEXT NOT NULL DEFAULT ${NOW} CHECK (updated_at GLOB ${ISO_PATTERN})`,
      '  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT',
    ].join(',\n'),
  BOOL: (column) => `CHECK (${column} IN (0, 1))`,
  ISO: (column) => `CHECK (${column} GLOB ${ISO_PATTERN})`,
  ISO_NULL: (column) => `CHECK (${column} IS NULL OR ${column} GLOB ${ISO_PATTERN})`,
  DATE: (column) => `CHECK (${column} GLOB ${DATE_PATTERN} AND length(${column}) = 10)`,
  DATE_NULL: (column) =>
    `CHECK (${column} IS NULL OR (${column} GLOB ${DATE_PATTERN} AND length(${column}) = 10))`,
  LUHN: (expression) => luhn(expression),
  IMMUTABLE: (table) =>
    [
      `CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}`,
      `BEGIN\n  SELECT RAISE(ABORT, 'IMMUTABLE: ${table}');\nEND;`,
      '',
      `CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}`,
      `BEGIN\n  SELECT RAISE(ABORT, 'IMMUTABLE: ${table}');\nEND;`,
    ].join('\n'),
  NO_DELETE: (table) =>
    `CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}\nBEGIN\n  SELECT RAISE(ABORT, 'NO_DELETE: ${table} s''archive, ne se supprime pas');\nEND;`,
};

export function expand(source) {
  return source.replace(/\{\{([A-Z_]+)(?: ([^}]+))?\}\}/g, (match, name, argument) => {
    const macro = MACROS[name];
    if (macro === undefined) throw new Error(`Macro inconnue : ${match}`);
    return macro(argument?.trim());
  });
}

function main() {
  const force = process.argv.includes('--force');
  mkdirSync(outputDir, { recursive: true });
  for (const name of readdirSync(templatesDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const output = expand(readFileSync(join(templatesDir, name), 'utf8'));
    const target = join(outputDir, name);
    if (existsSync(target) && readFileSync(target, 'utf8') !== output && !force) {
      throw new Error(
        `${name} existe déjà avec un autre contenu : une migration appliquée est immuable.`,
      );
    }
    writeFileSync(target, output, 'utf8');
    console.log(`db/migrations/${name}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
