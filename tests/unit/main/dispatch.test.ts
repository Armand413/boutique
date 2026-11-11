import Database from 'better-sqlite3-multiple-ciphers';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc/channels';
import { AppError } from '@shared/ipc/errors';
import type { AppInfo, IpcAccess } from '@shared/ipc/contract';
import { DEFAULT_PREFERENCES, type Preferences } from '@shared/schemas/preferences';
import { dispatchIpc, type Authorize, type IpcHandlers } from '../../../src/main/ipc/dispatch';

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

const allowAll: Authorize = () => null;

function handlers(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
  const unexpected = (): never => {
    throw new Error('handler inattendu');
  };
  const base = Object.fromEntries(
    IPC_CHANNELS.map((channel) => [channel, unexpected]),
  ) as unknown as IpcHandlers;
  return {
    ...base,
    'app:getInfo': () => APP_INFO,
    'preferences:get': () => DEFAULT_PREFERENCES,
    'preferences:set': (patch): Preferences =>
      ({ ...DEFAULT_PREFERENCES, ...patch }) as Preferences,
    ...overrides,
  };
}

describe('dispatchIpc', () => {
  it('renvoie les données d’un appel valide', async () => {
    await expect(dispatchIpc('app:getInfo', undefined, handlers(), allowAll)).resolves.toEqual({
      ok: true,
      data: APP_INFO,
    });
  });

  it('refuse un canal inconnu', async () => {
    const result = await dispatchIpc('db:dropAll', undefined, handlers(), allowAll);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
  });

  it('refuse une entrée invalide sans appeler le service', async () => {
    const set = vi.fn<IpcHandlers['preferences:set']>();
    const result = await dispatchIpc(
      'preferences:set',
      { theme: 'rose' },
      handlers({ 'preferences:set': set }),
      allowAll,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(set).not.toHaveBeenCalled();
  });

  it('contrôle l’accès avant d’appeler le service', async () => {
    const list = vi.fn<IpcHandlers['users:list']>(() => []);
    const seen: IpcAccess[] = [];
    const deny: Authorize = (access) => {
      seen.push(access);
      throw new AppError('FORBIDDEN', 'Refusé.');
    };
    const result = await dispatchIpc(
      'users:list',
      undefined,
      handlers({ 'users:list': list }),
      deny,
    );
    expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Refusé.' } });
    expect(list).not.toHaveBeenCalled();
    expect(seen).toEqual([{ kind: 'session', permission: 'user.manage' }]);
  });

  it('transmet le code et le message d’une erreur métier', async () => {
    const failing = handlers({
      'preferences:get': () => {
        throw new AppError('CONFLICT', 'Conflit de modification.');
      },
    });
    await expect(dispatchIpc('preferences:get', undefined, failing, allowAll)).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Conflit de modification.' },
    });
  });

  it('traduit une règle de la base en message lisible', async () => {
    const failing = handlers({
      'preferences:get': () => {
        throw new Database.SqliteError(
          'STOCK_NEGATIVE: stock insuffisant',
          'SQLITE_CONSTRAINT_TRIGGER',
        );
      },
    });
    await expect(dispatchIpc('preferences:get', undefined, failing, allowAll)).resolves.toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Stock insuffisant.' },
    });
  });

  it('masque le détail d’une erreur imprévue', async () => {
    const failing = handlers({
      'preferences:get': () => {
        throw new Error('SQLITE_CORRUPT: C:\\donnees\\boutique.db');
      },
    });
    const result = await dispatchIpc('preferences:get', undefined, failing, allowAll);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('SQLITE');
  });

  it('refuse une sortie non conforme au contrat (aucune fuite de champ)', async () => {
    const leaking = handlers({
      'app:getInfo': () => ({ ...APP_INFO, secret: 'fuite' }),
    });
    const result = await dispatchIpc('app:getInfo', undefined, leaking, allowAll);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
