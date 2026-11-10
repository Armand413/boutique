import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error script Node en JavaScript, sans déclaration de types
import { expand } from '../../../scripts/build-migrations.mjs';

const root = join(import.meta.dirname, '..', '..', '..');
const expandTemplate = expand as (source: string) => string;

describe('fichiers de migration', () => {
  it('correspondent exactement à leurs modèles (aucune modification manuelle)', () => {
    const templates = readdirSync(join(root, 'db', 'templates')).filter((name) =>
      name.endsWith('.sql'),
    );
    const migrations = readdirSync(join(root, 'db', 'migrations')).filter((name) =>
      name.endsWith('.sql'),
    );
    expect(migrations).toEqual(templates);
    for (const name of templates) {
      const expected = expandTemplate(readFileSync(join(root, 'db', 'templates', name), 'utf8'));
      expect(readFileSync(join(root, 'db', 'migrations', name), 'utf8'), name).toBe(expected);
    }
  });

  it('ne contiennent ni concaténation de données ni macro non développée', () => {
    for (const name of readdirSync(join(root, 'db', 'migrations'))) {
      expect(readFileSync(join(root, 'db', 'migrations', name), 'utf8')).not.toMatch(/\{\{/);
    }
  });
});
