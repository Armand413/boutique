// `npm run docs:db` : génère docs/BASE_DE_DONNEES.schema.md (tables, colonnes, clés étrangères,
// diagramme Mermaid) en appliquant les migrations de db/migrations à une base en mémoire.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

const root = join(import.meta.dirname, '..');
const migrations = join(root, 'db', 'migrations');
const db = new Database(':memory:');
db.function('audit_hash', () => '');
db.pragma('foreign_keys = ON');
for (const file of readdirSync(migrations)
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  db.exec(readFileSync(join(migrations, file), 'utf8'));
}

const objects = (type) =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'products_fts_%' ORDER BY name",
    )
    .all(type);
const tables = objects('table').filter((table) => table.name !== 'products_fts');
const columns = (table) => db.prepare('SELECT * FROM pragma_table_xinfo(?)').all(table);
const keys = (table) => db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(table);
const mermaidType = (type) => (type === '' ? 'ANY' : type.split(/\s|\(/)[0].toUpperCase());

const lines = [
  '# Schéma de la base (généré)',
  '',
  'Fichier produit par `npm run docs:db` à partir des migrations de `db/migrations` : ne pas modifier à la main.',
  '',
  `${String(tables.length)} tables, ${String(objects('view').length)} vues, ${String(objects('trigger').length)} triggers, ${String(objects('index').length)} index.`,
  '',
  '## Diagramme',
  '',
  '```mermaid',
  'erDiagram',
];
for (const table of tables) {
  lines.push(`  ${table.name} {`);
  const foreign = new Set(keys(table.name).map((key) => key.from));
  for (const column of columns(table.name)) {
    const tags = [column.pk > 0 ? 'PK' : '', foreign.has(column.name) ? 'FK' : ''].filter(Boolean);
    lines.push(
      `    ${mermaidType(column.type)} ${column.name}${tags.length > 0 ? ` ${tags.join(', ')}` : ''}`,
    );
  }
  lines.push('  }');
}
for (const table of tables) {
  const seen = new Set();
  for (const key of keys(table.name)) {
    const label = `${key.table}-${key.from}`;
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(`  ${key.table} ||--o{ ${table.name} : "${key.from}"`);
  }
}
lines.push('```', '', '## Tables', '');
for (const table of tables) {
  lines.push(
    `### ${table.name}`,
    '',
    '| Colonne | Type | Nulle | Défaut | Référence |',
    '| --- | --- | --- | --- | --- |',
  );
  const references = new Map(
    keys(table.name).map((key) => [key.from, `${key.table}.${key.to ?? 'id'}`]),
  );
  for (const column of columns(table.name)) {
    const dflt =
      column.dflt_value === null
        ? ''
        : `\`${String(column.dflt_value).replaceAll('|', String.raw`\|`)}\``;
    lines.push(
      `| ${column.name}${column.pk > 0 ? ' (clé)' : ''} | ${column.type || '—'} | ${column.notnull || column.pk ? 'non' : 'oui'} | ${dflt} | ${references.get(column.name) ?? ''} |`,
    );
  }
  lines.push('');
}
lines.push('## Vues', '', ...objects('view').map((view) => `- \`${view.name}\``), '');
lines.push('## Triggers', '', ...objects('trigger').map((trigger) => `- \`${trigger.name}\``), '');
lines.push('## Index', '', ...objects('index').map((index) => `- \`${index.name}\``), '');
writeFileSync(join(root, 'docs', 'BASE_DE_DONNEES.schema.md'), `${lines.join('\n')}\n`);
console.log(`Schéma documenté : ${String(tables.length)} tables.`);
