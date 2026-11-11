import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc/channels';
import { ipcContract } from '@shared/ipc/contract';
import { ROLE_PERMISSIONS } from '@shared/permissions';
import type { Session } from '../../../src/main/auth/session';
import { createAuthorizer } from '../../../src/main/ipc/authorize';
import { dispatchIpc, type IpcHandlers } from '../../../src/main/ipc/dispatch';
import { createHandlers } from '../../../src/main/ipc/handlers';
import { InlineExecutor } from '../../../src/main/reports/report-executor';
import { PreferencesService } from '../../../src/main/services/preferences-service';
import { AppRuntime } from '../../../src/main/system/runtime';
import { ADMIN, fakeDialogs, fakeProtector } from '../auth/harness';

vi.mock('electron', () => ({
  app: { getName: () => 'Boutique Gestion', getVersion: () => '0.0.0-test', isPackaged: false },
}));
vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * Tests d'intrusion simples (B.8) : contournement des rôles sur chaque canal, contrôle des droits
 * dans les services eux-mêmes, injection SQL et FTS, prix d'achat et marges invisibles au vendeur.
 */
let directory: string;
let runtime: AppRuntime;
let handlers: IpcHandlers;
const SELLER_PASSWORD = 'Mangue-Sucree-77';

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'boutique-intrusion-'));
  runtime = new AppRuntime({
    dataDirectory: join(directory, 'donnees'),
    protector: fakeProtector,
    dialogs: fakeDialogs().dialogs,
    executorFactory: (db) => new InlineExecutor(db),
  });
  await runtime.start();
  const services = runtime.requireServices();
  await services.setup.complete({ shopName: 'Boutique test', ...ADMIN });
  await services.auth.login(ADMIN.username, ADMIN.password);
  const admin = current();
  await services.users.create(admin, {
    username: 'awa',
    fullName: 'Awa',
    role: 'seller',
    temporaryPassword: 'Provisoire-2026',
  });
  await services.users.create(admin, {
    username: 'kone',
    fullName: 'Koné',
    role: 'manager',
    temporaryPassword: 'Provisoire-2026',
  });
  handlers = createHandlers({
    preferences: new PreferencesService(join(directory, 'preferences.json')),
    runtime,
  });
});

afterAll(() => {
  runtime.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Session ouverte ; une absence est une erreur du test. */
function current(): Session {
  const session = runtime.requireServices().sessions.current();
  if (session === null) throw new Error('aucune session ouverte');
  return session;
}

async function signIn(username: string): Promise<Session> {
  const { auth } = runtime.requireServices();
  auth.logout();
  await auth
    .login(username, username === ADMIN.username ? ADMIN.password : SELLER_PASSWORD)
    .catch(async () => {
      await auth.login(username, 'Provisoire-2026');
      await auth.changePassword('Provisoire-2026', SELLER_PASSWORD);
    });
  return current();
}

function call(channel: string, input?: unknown) {
  return dispatchIpc(channel, input, handlers, createAuthorizer(runtime));
}

const PUBLIC_CHANNELS = [
  'app:getInfo',
  'preferences:get',
  'preferences:set',
  'system:getStatus',
  'system:unlockDatabase',
  'system:chooseBackup',
  'system:restoreBackup',
  'setup:complete',
  'auth:login',
  'auth:loginPin',
  'auth:logout',
  'auth:recoverAdmin',
  'session:get',
];

describe('contournement des rôles par les canaux IPC', () => {
  it('ne laisse sans session que la liste fermée des canaux publics', async () => {
    const publicChannels = IPC_CHANNELS.filter(
      (channel) => ipcContract[channel].access.kind === 'public',
    );
    expect([...publicChannels].sort()).toEqual([...PUBLIC_CHANNELS].sort());
    runtime.requireServices().auth.logout();
    for (const channel of IPC_CHANNELS.filter((name) => !PUBLIC_CHANNELS.includes(name))) {
      const result = await call(channel);
      expect(result, channel).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    }
  });

  for (const role of ['seller', 'manager'] as const) {
    it(`refuse au ${role === 'seller' ? 'vendeur' : 'gérant'} chaque canal réservé à une autre permission`, async () => {
      await signIn(role === 'seller' ? 'awa' : 'kone');
      const granted = new Set<string>(ROLE_PERMISSIONS[role]);
      const forbidden = IPC_CHANNELS.filter((channel) => {
        const access = ipcContract[channel].access;
        const permission = 'permission' in access ? access.permission : undefined;
        return permission !== undefined && !granted.has(permission);
      });
      expect(forbidden.length).toBeGreaterThan(10);
      for (const channel of forbidden) {
        expect(await call(channel), channel).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN' },
        });
      }
    });
  }

  it('refuse la restauration sans session dès qu’une boutique configurée est ouverte', async () => {
    runtime.requireServices().auth.logout();
    expect(await call('system:chooseBackup')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await call('system:restoreBackup', { token: 'x', password: 'y', currentPassword: null }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await call('setup:complete', { shopName: 'Pirate', ...ADMIN })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });
});

describe('droits vérifiés dans les services, pas seulement dans l’interface (B.2)', () => {
  it('refuse au vendeur les opérations sensibles appelées directement', async () => {
    const seller = await signIn('awa');
    const services = runtime.requireServices();
    const attempts: [string, () => unknown][] = [
      ['utilisateurs', () => services.users.list(seller)],
      ['paramètres', () => services.settings.all(seller)],
      ['sauvegardes', () => services.backups.status(seller)],
      ['journal d’audit', () => services.audit.list(seller, 10)],
      [
        'sortie de stock',
        () =>
          services.stock.exit(seller, {
            variantId: 1,
            locationId: 1,
            type: 'loss',
            direction: 'out',
            quantity: 1,
            reason: 'Essai',
          }),
      ],
      ['annulation de vente', () => services.sales.cancel(seller, 1, 'Essai')],
    ];
    for (const [label, attempt] of attempts) {
      expect(attempt, label).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }
    await expect(services.reports.run(seller, { kind: 'balances' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('injection SQL et FTS', () => {
  it('traite les saisies hostiles comme du texte, sans erreur ni effet', async () => {
    const admin = await signIn(ADMIN.username);
    const services = runtime.requireServices();
    const hostile = [
      "'; DROP TABLE products; --",
      '" OR 1=1 --',
      'NEAR(a b)',
      '*',
      'name:x AND',
      '"',
      '\\',
      "%' OR '1'='1",
      'a) UNION SELECT password_hash FROM users --',
    ];
    for (const query of hostile) {
      expect(
        () =>
          services.products.search(admin, {
            query,
            status: 'all',
            sort: 'name',
            offset: 0,
            limit: 10,
          }),
        query,
      ).not.toThrow();
      expect(() => services.customers.search(admin, query, 10), query).not.toThrow();
      expect(services.products.findSerial(admin, query)).toEqual([]);
    }
    const tables = services.db
      .prepare(
        "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('products', 'users')",
      )
      .pluck()
      .get();
    expect(tables).toBe(2);
  });
});

describe('prix d’achat et marges invisibles au vendeur (B.2)', () => {
  function costLeaks(value: unknown, path = ''): string[] {
    if (Array.isArray(value))
      return value.flatMap((item, index) => costLeaks(item, `${path}[${String(index)}]`));
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => [
      ...(/cost|margin|stock_?value/i.test(key) && child !== null ? [`${path}.${key}`] : []),
      ...costLeaks(child, `${path}.${key}`),
    ]);
  }

  it('ne renvoie aucun coût ni aucune marge dans les réponses servies au vendeur', async () => {
    const admin = await signIn(ADMIN.username);
    const services = runtime.requireServices();
    const family = services.db
      .prepare("SELECT id FROM categories WHERE name = 'Téléphonie'")
      .pluck()
      .get() as number;
    const product = services.products.create(admin, {
      name: 'Coque',
      brandId: null,
      categoryId: family,
      model: null,
      description: null,
      productType: 'accessory',
      trackingMode: 'none',
      taxRateId: null,
      reorderLevel: 0,
      warrantyMonths: 0,
      weightKg: null,
      attributes: [],
      variants: [
        {
          sku: '',
          barcode: null,
          color: null,
          storageGb: null,
          ramGb: null,
          condition: 'new',
          salePrice: 5000,
          minSalePrice: 0,
          isActive: true,
          costPrice: 3000,
        },
      ],
    });
    const seller = await signIn('awa');
    const responses = {
      search: await call('products:search', {
        status: 'active',
        sort: 'name',
        offset: 0,
        limit: 10,
      }),
      detail: await call('products:get', { productId: product.id }),
      dashboard: await call('dashboard:get'),
      stock: await call('stock:overview', { offset: 0, limit: 10 }),
      valuation: await call('stock:valuation'),
    };
    expect(seller.role).toBe('seller');
    for (const [name, response] of Object.entries(responses)) {
      expect(response.ok, `${name} : ${JSON.stringify(response)}`).toBe(true);
      expect(costLeaks(response), name).toEqual([]);
    }
  });
});
