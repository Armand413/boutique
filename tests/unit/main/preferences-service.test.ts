import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type PreferencesPatch } from '@shared/schemas/preferences';
import { PreferencesService } from '../../../src/main/services/preferences-service';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'boutique-prefs-'));
  file = join(directory, 'preferences.json');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('PreferencesService', () => {
  it('renvoie les valeurs par défaut sans fichier', () => {
    expect(new PreferencesService(file).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it('enregistre une modification et la relit', () => {
    new PreferencesService(file).update({ theme: 'dark', textScale: 125 });
    expect(new PreferencesService(file).get()).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
      textScale: 125,
    });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('met de côté un fichier corrompu et repart des valeurs par défaut', () => {
    writeFileSync(file, '{ pas du json', 'utf8');
    expect(new PreferencesService(file).get()).toEqual(DEFAULT_PREFERENCES);
    const names = readdirSync(directory);
    expect(names.some((name) => name.startsWith('preferences.json.corrompu-'))).toBe(true);
  });

  it('met de côté un fichier au contenu invalide', () => {
    writeFileSync(file, JSON.stringify({ theme: 'rose', language: 'fr', textScale: 100 }), 'utf8');
    expect(new PreferencesService(file).get()).toEqual(DEFAULT_PREFERENCES);
    expect(existsSync(file)).toBe(false);
  });

  it('refuse une valeur invalide sans toucher au fichier', () => {
    const service = new PreferencesService(file);
    service.update({ language: 'en' });
    const before = readFileSync(file, 'utf8');
    const invalid = { theme: 'rose' } as unknown as PreferencesPatch;
    expect(() => service.update(invalid)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
