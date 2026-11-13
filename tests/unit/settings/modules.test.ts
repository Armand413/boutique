import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../../src/main/auth/session';
import { createAuthorizer } from '../../../src/main/ipc/authorize';
import { dispatchIpc, type IpcHandlers } from '../../../src/main/ipc/dispatch';
import { createHandlers } from '../../../src/main/ipc/handlers';
import { InlineExecutor } from '../../../src/main/reports/report-executor';
import { PreferencesService } from '../../../src/main/services/preferences-service';
import { AppRuntime } from '../../../src/main/system/runtime';
import { ADMIN, fakeDialogs, fakeProtector } from '../auth/harness';

vi.mock('electron', () => ({
  app: { getName: () => 'Bouba Store', getVersion: () => '0.0.0-test', isPackaged: false },
}));
vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let directory: string;
let runtime: AppRuntime;
let handlers: IpcHandlers;
let variantId: number;

function call(channel: string, input?: unknown) {
  return dispatchIpc(channel, input, handlers, createAuthorizer(runtime));
}

function admin(): Session {
  const session = runtime.requireServices().sessions.current();
  if (session === null) throw new Error('aucune session');
  return session;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'boutique-modules-'));
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
  handlers = createHandlers({
    preferences: new PreferencesService(join(directory, 'preferences.json')),
    runtime,
  });
  const family = services.db
    .prepare("SELECT id FROM categories WHERE name = 'Téléphonie'")
    .pluck()
    .get() as number;
  const product = services.products.create(admin(), {
    name: 'Câble USB-C',
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
        salePrice: 2500,
        minSalePrice: 0,
        isActive: true,
        costPrice: 1000,
      },
    ],
  });
  variantId = product.variants[0]?.id ?? 0;
});

afterAll(() => {
  runtime.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const location = () =>
  runtime
    .requireServices()
    .db.prepare('SELECT id FROM stock_locations WHERE is_default = 1')
    .pluck()
    .get() as number;

const receipt = (supplierId: number | null) => ({
  supplierId,
  locationId: location(),
  receivedOn: '2026-11-12',
  notes: null,
  lines: [{ variantId, quantity: 4, unitCost: 1000 }],
  payment: null,
});

describe('modules activables (D90)', () => {
  it('désactive fournisseurs, livraisons et SAV par défaut et refuse leurs canaux', async () => {
    expect(runtime.requireServices().settings.publicSettings().modules).toEqual({
      suppliers: false,
      deliveries: false,
      warranty: false,
    });
    for (const [channel, input] of [
      ['suppliers:list', undefined],
      ['deliveries:list', { status: 'all', limit: 10 }],
      ['warranty:list', { scope: 'open', limit: 10 }],
    ] as const) {
      const moduleMessage: unknown = expect.stringMatching(/Paramètres › Modules/);
      expect(await call(channel, input), channel).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', message: moduleMessage },
      });
    }
  });

  it('enregistre une entrée de stock sans fournisseur, coût moyen compris', async () => {
    const result = await call('receipts:create', receipt(null));
    expect(result).toMatchObject({ ok: true });
    const { db } = runtime.requireServices();
    expect(
      db
        .prepare('SELECT sum(quantity) FROM stock_levels WHERE variant_id = ?')
        .pluck()
        .get(variantId),
    ).toBe(4);
    expect(
      db.prepare('SELECT supplier_id FROM goods_receipts ORDER BY id DESC LIMIT 1').pluck().get(),
    ).toBeNull();
    expect(await call('receipts:create', receipt(1))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rouvre un module réactivé, et l’activation est réservée à l’administrateur', async () => {
    expect(
      await call('settings:saveModules', { suppliers: true, deliveries: false, warranty: false }),
    ).toMatchObject({ ok: true });
    expect(await call('suppliers:list')).toMatchObject({ ok: true });
    expect(runtime.requireServices().settings.publicSettings().modules.suppliers).toBe(true);
    const supplier = runtime.requireServices().suppliers.save(admin(), {
      name: 'Grossiste Adjamé',
      phone: null,
      email: null,
      address: null,
      notes: null,
      isActive: true,
    });
    expect(await call('receipts:create', receipt(supplier.id))).toMatchObject({ ok: true });
    expect(
      await call('receipts:create', {
        ...receipt(null),
        payment: { amount: 500, method: 'cash', reference: null },
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
