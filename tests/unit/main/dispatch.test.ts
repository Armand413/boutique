import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/ipc/errors';
import { DEFAULT_PREFERENCES, type Preferences } from '@shared/schemas/preferences';
import type { AppInfo } from '@shared/ipc/contract';
import { dispatchIpc, type IpcHandlers } from '../../../src/main/ipc/dispatch';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const APP_INFO: AppInfo = {
  name: 'Boutique',
  version: '0.1.0',
  electron: '45',
  chrome: '140',
  node: '24',
  isPackaged: false,
};

function handlers(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
  return {
    'app:getInfo': () => APP_INFO,
    'preferences:get': () => DEFAULT_PREFERENCES,
    'preferences:set': (patch): Preferences =>
      ({ ...DEFAULT_PREFERENCES, ...patch }) as Preferences,
    ...overrides,
  };
}

describe('dispatchIpc', () => {
  it('renvoie les données d’un appel valide', async () => {
    await expect(dispatchIpc('app:getInfo', undefined, handlers())).resolves.toEqual({
      ok: true,
      data: APP_INFO,
    });
  });

  it('refuse un canal inconnu', async () => {
    const result = await dispatchIpc('db:dropAll', undefined, handlers());
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
  });

  it('refuse une entrée invalide sans appeler le service', async () => {
    const set = vi.fn<IpcHandlers['preferences:set']>();
    const result = await dispatchIpc(
      'preferences:set',
      { theme: 'rose' },
      handlers({ 'preferences:set': set }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(set).not.toHaveBeenCalled();
  });

  it('transmet le code et le message d’une erreur métier', async () => {
    const failing = handlers({
      'preferences:get': () => {
        throw new AppError('CONFLICT', 'Conflit de modification.');
      },
    });
    await expect(dispatchIpc('preferences:get', undefined, failing)).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conflit de modification.' },
    });
  });

  it('masque le détail d’une erreur imprévue', async () => {
    const failing = handlers({
      'preferences:get': () => {
        throw new Error('SQLITE_CORRUPT: C:\\donnees\\boutique.db');
      },
    });
    const result = await dispatchIpc('preferences:get', undefined, failing);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('SQLITE');
  });

  it('refuse une sortie non conforme au contrat (aucune fuite de champ)', async () => {
    const leaking = handlers({
      'app:getInfo': () => ({ ...APP_INFO, secret: 'fuite' }),
    });
    const result = await dispatchIpc('app:getInfo', undefined, leaking);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
