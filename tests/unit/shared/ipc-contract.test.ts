import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isIpcChannel } from '@shared/ipc/channels';
import { ipcContract } from '@shared/ipc/contract';
import {
  DEFAULT_PREFERENCES,
  preferencesPatchSchema,
  preferencesSchema,
} from '@shared/schemas/preferences';

describe('contrat IPC', () => {
  it('décrit exactement les canaux listés', () => {
    expect(Object.keys(ipcContract).sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it('reconnaît uniquement les canaux listés', () => {
    expect(isIpcChannel('preferences:get')).toBe(true);
    expect(isIpcChannel('preferences:delete')).toBe(false);
    expect(isIpcChannel(42)).toBe(false);
    expect(isIpcChannel(undefined)).toBe(false);
  });

  it('refuse toute entrée sur un canal sans paramètre', () => {
    expect(ipcContract['app:getInfo'].input.safeParse(undefined).success).toBe(true);
    expect(ipcContract['app:getInfo'].input.safeParse({}).success).toBe(false);
  });
});

describe('schéma des préférences', () => {
  it('accepte les valeurs par défaut', () => {
    expect(preferencesSchema.parse(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
  });

  it('refuse une clé inconnue ou une valeur hors liste', () => {
    expect(preferencesPatchSchema.safeParse({ theme: 'dark', admin: true }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ theme: 'rose' }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ textScale: 105 }).success).toBe(false);
  });

  it('accepte une modification partielle', () => {
    expect(preferencesPatchSchema.parse({ language: 'en' })).toEqual({ language: 'en' });
  });
});
