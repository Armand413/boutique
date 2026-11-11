import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeCurrency, formatMoney, setActiveCurrency } from '../../../src/shared/format/money';
import { setDateFormat } from '../../../src/shared/format/date';
import { ImageStore } from '../../../src/main/catalog/image-store';
import { readShopIdentity } from '../../../src/main/printing/shop-identity';
import { InlineExecutor } from '../../../src/main/reports/report-executor';
import { localDay } from '../../../src/main/reports/period';
import { ReportService } from '../../../src/main/reports/report-service';
import { SettingsService } from '../../../src/main/settings/settings-service';
import { fakeDialogs } from '../auth/harness';
import { createSalesHarness, variant, type SalesHarness } from '../sales/harness';

let h: SalesHarness;
let directory: string;
const today = localDay(new Date());

beforeEach(() => {
  h = createSalesHarness();
  directory = mkdtempSync(join(tmpdir(), 'parametres-'));
});

afterEach(() => {
  h.cleanup();
  rmSync(directory, { recursive: true, force: true });
  setActiveCurrency({ code: 'XOF', symbol: 'FCFA', decimals: 0 });
  setDateFormat('fr');
});

function service(open?: string) {
  return new SettingsService(
    h.test.db,
    new ImageStore(join(directory, 'images')),
    fakeDialogs(open === undefined ? {} : { open }).dialogs,
  );
}

const regional = {
  currency: { code: 'XOF', symbol: 'FCFA', decimals: 0 },
  dateFormat: 'fr' as const,
  invoicePrefix: 'FAC',
};

describe('paramètres de la boutique', () => {
  it('sont réservés à l’administrateur et tracés dans le journal d’audit', () => {
    const settings = service();
    expect(() => settings.all(h.manager)).toThrow(/droit/);
    const saved = settings.saveShop(h.as('admin'), {
      name: 'Boutique du Plateau',
      address: 'Avenue Chardy\nAbidjan',
      phone: '27 20 00 00 00',
      email: null,
      legal: 'RCCM CI-ABJ-2026-B-1234',
    });
    expect(saved.shop.address).toBe('Avenue Chardy\nAbidjan');
    const identity = readShopIdentity(h.test.db, null);
    expect(identity).toMatchObject({
      name: 'Boutique du Plateau',
      legal: 'RCCM CI-ABJ-2026-B-1234',
    });
    expect(
      h.test.db
        .prepare("SELECT count(*) FROM audit_log WHERE action = 'settings.changed'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('applique devise, format de date et préfixe de facture ; fige les décimales dès qu’un prix existe', () => {
    const settings = service();
    const admin = h.as('admin');
    settings.saveRegional(admin, {
      ...regional,
      currency: { code: 'EUR', symbol: '€', decimals: 2 },
      invoicePrefix: 'BTQ',
    });
    expect(activeCurrency().code).toBe('EUR');
    expect(formatMoney(12_550)).toMatch(/^125,50\s€$/);
    settings.saveRegional(admin, regional);
    const cable = h.product({ name: 'Câble', variants: [variant({ salePrice: 2500 })] }, 5);
    expect(settings.all(admin).decimalsLocked).toBe(true);
    expect(() =>
      settings.saveRegional(admin, {
        ...regional,
        currency: { code: 'EUR', symbol: '€', decimals: 2 },
      }),
    ).toThrow(/décimales/);
    settings.saveRegional(admin, { ...regional, invoicePrefix: 'BTQ', dateFormat: 'iso' });
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId: cable, quantity: 1, discount: null }],
        payments: [{ method: 'cash', amount: 2500, reference: null }],
      }),
    );
    expect(sale.invoiceNumber).toMatch(/^BTQ-\d{4}-000001$/);
  });

  it('gère les taux de taxe sans doublon et le logo par sa signature d’image', async () => {
    const admin = h.as('admin');
    const png = join(directory, 'logo.png');
    writeFileSync(
      png,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(32),
      ]),
    );
    const settings = service(png);
    const created = settings.saveTaxRate(admin, {
      id: null,
      name: 'TVA réduite 9 %',
      rate: 900,
      isActive: true,
    });
    expect(created.taxRates.map((rate) => rate.rate)).toContain(900);
    expect(() =>
      settings.saveTaxRate(admin, { id: null, name: 'TVA réduite 9 %', rate: 900, isActive: true }),
    ).toThrow(/déjà/);
    const withLogo = await settings.chooseLogo(admin);
    expect(withLogo?.logo).toMatch(/^data:image\/png;base64,/);
    expect(settings.removeLogo(admin).logo).toBeNull();
    writeFileSync(png, 'pas une image');
    await expect(settings.chooseLogo(admin)).rejects.toThrow(/Format d’image/);
  });
});

describe('alertes anti-fraude', () => {
  it('signale annulation, remise forte, vente sous le coût, ajustements répétés et écart de caisse', async () => {
    const admin = h.as('admin');
    const phone = h.product({ name: 'Coque', variants: [variant({ salePrice: 10_000 })] }, 20);
    const cheap = h.product({ name: 'Écouteurs', variants: [variant({ salePrice: 500 })] }, 3);
    h.sessions.open(h.manager, 0);
    const cash = (amount: number) => [{ method: 'cash' as const, amount, reference: null }];
    const sold = h.sales.checkout(
      admin,
      h.checkoutInput({
        lines: [{ variantId: phone, quantity: 1, discount: { type: 'percent', value: 2500 } }],
        payments: cash(7500),
      }),
    );
    h.sales.checkout(
      admin,
      h.checkoutInput({
        lines: [{ variantId: cheap, quantity: 1, discount: null }],
        payments: cash(500),
      }),
    );
    const cancelled = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId: phone, quantity: 1, discount: null }],
        payments: cash(10_000),
      }),
    );
    h.sales.cancel(h.manager, cancelled.id, 'Erreur de saisie');
    const location = h.test.db
      .prepare('SELECT id FROM stock_locations WHERE is_default = 1')
      .pluck()
      .get() as number;
    for (let index = 0; index < 5; index += 1) {
      h.stock.exit(h.manager, {
        variantId: phone,
        locationId: location,
        type: 'loss',
        direction: 'out',
        quantity: 1,
        reason: 'Casse en vitrine',
      });
    }
    h.sessions.close(h.manager, 5000, null);

    const reports = new ReportService(
      h.test.db,
      new InlineExecutor(h.test.db),
      fakeDialogs().dialogs,
    );
    await expect(
      reports.run(h.manager, { kind: 'sensitive', period: { from: today, to: today } }),
    ).rejects.toThrow(/droit/);
    const report = await reports.run(admin, {
      kind: 'sensitive',
      period: { from: today, to: today },
    });
    const categories = report.rows.map((row) => row.category);
    expect(new Set(categories)).toEqual(
      new Set(['cancellation', 'discount', 'below_cost', 'adjustments', 'cash_difference']),
    );
    expect(report.rows.find((row) => row.category === 'discount')).toMatchObject({
      reference: sold.invoiceNumber,
      amount: 2500,
    });
    expect(report.rows.find((row) => row.category === 'cash_difference')?.amount).toBe(5000 - 8000);
    expect((await reports.dashboard(admin)).sensitive).toBe(5);
    expect((await reports.dashboard(h.manager)).sensitive).toBeNull();
  });
});
