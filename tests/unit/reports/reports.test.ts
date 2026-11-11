import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localDay } from '../../../src/main/reports/period';
import { dashboard, runReport } from '../../../src/main/reports/report-queries';
import type { ReportContext } from '../../../src/main/reports/report-kit';
import type { ReportRequest } from '../../../src/shared/schemas/reports';
import { createSalesHarness, variant, type SalesHarness } from '../sales/harness';

let h: SalesHarness;
const today = localDay(new Date());
const period = { from: today, to: today };
const full: ReportContext = { canSeeCost: true, now: new Date(), limit: null };

beforeEach(() => {
  h = createSalesHarness();
});

afterEach(() => {
  h.cleanup();
});

function vatId(): number {
  return h.test.db.prepare('SELECT id FROM tax_rates WHERE rate = 1800').pluck().get() as number;
}

function cash(amount: number) {
  return [{ method: 'cash' as const, amount, reference: null }];
}

/** Câble à 11 800 TTC (TVA 18 % comprise, coût 1 000) et kit solaire de deux composants. */
function seed() {
  const cable = h.product(
    { name: 'Câble USB-C', taxRateId: vatId(), variants: [variant({ salePrice: 11_800 })] },
    10,
  );
  const panel = h.product(
    { name: 'Panneau', productType: 'solar', variants: [variant({ salePrice: 90_000 })] },
    6,
  );
  const kit = h.product({
    name: 'Kit solaire',
    productType: 'kit',
    variants: [variant({ salePrice: 200_000 })],
  });
  h.products.setKitComponents(h.manager, kit, [{ variantId: panel, quantity: 2 }]);
  h.sessions.open(h.manager, 0);
  return { cable, panel, kit };
}

function run(request: ReportRequest, context: ReportContext = full) {
  return runReport(h.test.db, request, context);
}

describe('ventes et marges', () => {
  it('calcule le chiffre d’affaires HT net des retours et la marge des kits par leurs composants', () => {
    const { cable, kit } = seed();
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [
          { variantId: cable, quantity: 3, discount: null },
          { variantId: kit, quantity: 1, discount: null },
        ],
        payments: cash(235_400),
      }),
    );
    const cableLine = sale.lines.find((line) => line.name === 'Câble USB-C');
    h.sales.returnItems(h.manager, {
      saleId: sale.id,
      reason: 'Ne convient pas',
      lines: [{ saleLineId: cableLine?.id ?? 0, quantity: 1, restock: true }],
      refundMethod: 'cash',
    });

    const report = run({ kind: 'sales', period, groupBy: 'product' });
    const byName = Object.fromEntries(report.rows.map((row) => [row.label, row]));
    // 2 câbles gardés : 23 600 TTC, dont 3 600 de TVA ; coût 2 × 1 000.
    expect(byName['Câble USB-C']).toMatchObject({
      quantity: 2,
      revenue_ttc: 23_600,
      revenue: 20_000,
      cost: 2000,
      margin: 18_000,
      margin_rate: 90,
    });
    // Kit sans TVA : coût = 2 panneaux à 1 000.
    expect(byName['Kit solaire']).toMatchObject({ quantity: 1, revenue: 200_000, cost: 2000 });
    expect(report.totals).toMatchObject({ sales_count: 1, revenue_ttc: 223_600, margin: 216_000 });
    expect(report.summary.find((item) => item.key === 'margin')?.value).toBe(216_000);

    const families = run({ kind: 'sales', period, groupBy: 'family' });
    expect(families.rows.map((row) => row.label).sort()).toEqual(['Téléphonie']);
    const daily = run({ kind: 'sales', period, groupBy: 'day' });
    expect(daily.rows).toEqual([expect.objectContaining({ label: today, revenue_ttc: 223_600 })]);
    expect(daily.chart?.type).toBe('line');
    expect(h.test.db.prepare('SELECT revenue, cost, margin FROM v_sales_margin').get()).toEqual({
      revenue: 220_000,
      cost: 4000,
      margin: 216_000,
    });
  });

  it('retire coûts, marges et valeurs au coût sans la permission cost.view (B.2)', () => {
    const { cable } = seed();
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId: cable, quantity: 1, discount: null }],
        payments: cash(11_800),
      }),
    );
    const hidden: ReportContext = { ...full, canSeeCost: false };
    for (const request of [
      { kind: 'sales', period, groupBy: 'seller' },
      { kind: 'products', period, order: 'best' },
      { kind: 'stock', groupBy: 'family' },
      { kind: 'movements', period, movementType: null },
    ] as const) {
      const report = run(request, hidden);
      const text = JSON.stringify(report);
      expect(report.columns.some((column) => column.sensitive)).toBe(false);
      for (const key of ['"cost"', '"margin"', '"margin_rate"', '"stock_value"', '"unit_cost"']) {
        expect(text).not.toContain(key);
      }
    }
    const board = dashboard(h.test.db, { canSeeCost: false, canSeeStock: true, now: new Date() });
    expect(board.today).toEqual({ count: 1, revenueTtc: 11_800, margin: null });
    expect(board.days.every((point) => point.margin === null)).toBe(true);
  });
});

describe('rotation, stock et suivis', () => {
  it('classe les plus et les moins vendus, avec les articles jamais vendus', () => {
    const { cable, panel } = seed();
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId: cable, quantity: 4, discount: null }],
        payments: cash(47_200),
      }),
    );
    const best = run({ kind: 'products', period, order: 'best' });
    expect(best.rows.map((row) => [row.product, row.quantity, row.stock])).toEqual([
      ['Câble USB-C', 4, 6],
    ]);
    expect(best.rows[0]?.coverage_days).toBe(2);
    const worst = run({ kind: 'products', period, order: 'worst' });
    expect(worst.rows[0]).toMatchObject({ product: 'Panneau', quantity: 0, stock: 6 });
    expect(worst.rows.some((row) => row.product === 'Kit solaire')).toBe(false);
    expect(panel).toBeGreaterThan(0);
  });

  it('valorise le stock au coût moyen et au prix de vente, par famille et par emplacement', () => {
    seed();
    const report = run({ kind: 'stock', groupBy: 'location' });
    expect(report.rows).toEqual([
      expect.objectContaining({
        products: 2,
        quantity: 16,
        stock_value: 16_000,
        retail_value: 10 * 11_800 + 6 * 90_000,
      }),
    ]);
    const movements = run({ kind: 'movements', period, movementType: 'purchase' });
    expect(movements.rows).toHaveLength(2);
    expect(movements.summary.find((item) => item.key === 'entries')?.value).toBe(16);
  });

  it('liste créances clients, échéances en retard et sessions de caisse', () => {
    const { cable } = seed();
    const customerId = h.customers.save(h.manager, {
      fullName: 'Aya Koné',
      phone: '0707070707',
      address: null,
      notes: null,
      creditLimit: 100_000,
      isActive: true,
    }).id;
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        customerId,
        lines: [{ variantId: cable, quantity: 2, discount: null }],
        payments: cash(3600),
        installments: [{ dueDate: '2026-01-15', amount: 20_000 }],
      }),
    );
    const balances = run({ kind: 'balances' });
    expect(balances.rows[0]).toMatchObject({
      party: 'customer',
      name: 'Aya Koné',
      balance: 20_000,
    });
    expect(balances.summary.find((item) => item.key === 'overdue')?.value).toBe(20_000);
    expect(balances.rows.some((row) => row.party === 'supplier')).toBe(true);
    const followups = run({ kind: 'followups' });
    expect(followups.rows[0]).toMatchObject({ type: 'installment', remaining: 20_000 });
    const cashReport = run({ kind: 'cash', period });
    expect(cashReport.rows[0]).toMatchObject({
      sales_count: 1,
      sales_total: 23_600,
      cash_in: 3600,
    });
  });

  it('coupe l’affichage à la limite et le signale', () => {
    seed();
    const report = run({ kind: 'movements', period, movementType: null }, { ...full, limit: 1 });
    expect(report.rows).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });
});
