import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  type Preferences,
  type PreferencesPatch,
} from '@shared/schemas/preferences';
import { logger } from '../logging/logger';

/**
 * Préférences d'affichage du poste (thème, langue, taille du texte), dans un fichier JSON
 * du dossier utilisateur. Ce ne sont pas des données métier : elles restent hors de la base.
 */
export class PreferencesService {
  private cache: Preferences | null = null;

  constructor(private readonly filePath: string) {}

  get(): Preferences {
    this.cache ??= this.load();
    return this.cache;
  }

  update(patch: PreferencesPatch): Preferences {
    const next = preferencesSchema.parse({ ...this.get(), ...stripUndefined(patch) });
    this.save(next);
    this.cache = next;
    return next;
  }

  private load(): Preferences {
    if (!existsSync(this.filePath)) return DEFAULT_PREFERENCES;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      return this.recoverFromCorruptFile(error);
    }
    const result = preferencesSchema.safeParse(parsed);
    return result.success ? result.data : this.recoverFromCorruptFile(result.error);
  }

  private recoverFromCorruptFile(error: unknown): Preferences {
    const backup = `${this.filePath}.corrompu-${Date.now()}`;
    renameSync(this.filePath, backup);
    logger.warn('Préférences illisibles : valeurs par défaut rétablies', { backup, error });
    return DEFAULT_PREFERENCES;
  }

  /** Écriture atomique : fichier temporaire puis renommage. */
  private save(preferences: Preferences): void {
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(preferences, null, 2), 'utf8');
    renameSync(temporary, this.filePath);
  }
}

function stripUndefined(patch: PreferencesPatch): Partial<Preferences> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}
