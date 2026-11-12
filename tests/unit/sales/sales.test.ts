import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discountAmount,
  distribute,
  includedTax,
  warrantyEnd,
} from '../../../src/main/sales/pricing';
import { createSalesHarness, variant, type SalesHarness } from './harness';

let h: SalesHarness;
const IMEIS = ['490154203237518', '356938035643809', '352099001761481'];
const year = String(new Date().getFullYear());

beforeEach(() => {
  h = createSalesHarness();
});

afterEach(() => {
  h.cleanup();
});

function cable(quantity = 10, price = 2500, minSalePrice = 0) {
  return h.product(
    { name: 'Câble USB-C', variants: [variant({ salePrice: price, minSalePrice })] },
    quantity,
  );
}

function phone(serials = IMEIS.slice(0, 2)) {
  return h.product(
    {
      name: 'Galaxy A15',
      productType: 'phone',
      trackingMode: 'imei',
      warrantyMonths: 12,
      variants: [variant({ salePrice: 120_000 })],
    },
    serials.length,
    serials,
  );
}

function unitId(serial: string): number {
  return h.test.db
    .prepare('SELECT id FROM serial_units WHERE serial_number = ?')
    .pluck()
    .get(serial) as number;
}

function customer(creditLimit = 0) {
  const created = h.customers.save(h.manager, {
    fullName: 'Aya Koné',
    phone: '07 07 07 07 07',
    address: 'Cocody',
    notes: null,
    creditLimit,
    isActive: true,
  });
  return created.id;
}

describe('calculs de caisse', () => {
  it('répartit au centime près, extrait la TVA comprise et borne la garantie au mois', () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(distribute(0, [5, 5])).toEqual([0, 0]);
    expect(discountAmount(10_000, { type: 'percent', value: 1500 })).toBe(1500);
    expect(discountAmount(1000, { type: 'amount', value: 5000 })).toBe(1000);
    expect(includedTax(11_800, 1800)).toBe(1800);
    expect(warrantyEnd('2026-01-31T10:00:00.000Z', 1)).toBe('2026-02-28');
    expect(warrantyEnd('2026-11-11T10:00:00.000Z', 12)).toBe('2027-11-11');
    expect(warrantyEnd('2026-11-11T10:00:00.000Z', 0)).toBeNull();
  });
});

describe('vente au comptant', () => {
  it('exige une caisse ouverte', () => {
    const variantId = cable();
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({ lines: [{ variantId, quantity: 1, discount: null }] }),
      ),
    ).toThrow(/caisse est fermée/);
  });

  it('enregistre facture, paiements et sortie de stock en une transaction', () => {
    const variantId = cable();
    h.sessions.open(h.manager, 10_000);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 3, discount: null }],
        payments: [
          { method: 'cash', amount: 5000, reference: null },
          { method: 'mobile_money', amount: 2500, reference: 'OM-1' },
        ],
      }),
    );
    expect(sale).toMatchObject({
      invoiceNumber: `FAC-${year}-000001`,
      status: 'completed',
      total: 7500,
      remaining: 0,
    });
    expect(h.stockOf(variantId)).toBe(7);
    const session = h.sessions.current(h.manager);
    expect(session).toMatchObject({ expectedCash: 15_000, salesCount: 1, salesTotal: 7500 });
    expect(session?.byMethod.mobile_money).toBe(2500);
    const second = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 1, discount: null }],
        payments: [{ method: 'card', amount: 2500, reference: null }],
      }),
    );
    expect(second.invoiceNumber).toBe(`FAC-${year}-000002`);
    expect(h.test.db.prepare('SELECT * FROM v_stock_discrepancies').all()).toEqual([]);
  });

  it('refuse un stock insuffisant sans rien écrire', () => {
    const variantId = cable(2);
    h.sessions.open(h.manager, 0);
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({
          lines: [{ variantId, quantity: 3, discount: null }],
          payments: [{ method: 'cash', amount: 7500, reference: null }],
        }),
      ),
    ).toThrow(/Stock insuffisant/);
    expect(h.stockOf(variantId)).toBe(2);
    expect(
      h.test.db.prepare("SELECT count(*) FROM sales WHERE status = 'completed'").pluck().get(),
    ).toBe(0);
    expect(h.test.db.prepare('SELECT count(*) FROM payments').pluck().get()).toBe(0);
  });

  it('valide une vente de 20 lignes en moins de 500 ms', () => {
    const ids = Array.from({ length: 20 }, (_, index) =>
      h.product({ name: `Article ${String(index)}`, variants: [variant({ salePrice: 1000 })] }, 5),
    );
    h.sessions.open(h.manager, 0);
    const input = h.checkoutInput({
      lines: ids.map((variantId) => ({ variantId, quantity: 2, discount: null })),
      payments: [{ method: 'cash', amount: 40_000, reference: null }],
    });
    const started = performance.now();
    h.sales.checkout(h.manager, input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('remises et prix minimum', () => {
  it('applique le plafond du rôle : vendeur 10 %, gérant 30 %, administrateur libre', () => {
    const variantId = cable(10, 10_000, 5000);
    h.sessions.open(h.manager, 0);
    const line = (percent: number) => [
      { variantId, quantity: 1, discount: { type: 'percent' as const, value: percent } },
    ];
    const seller = h.as('seller');
    expect(h.sales.preview(seller, line(1500), null, null).issues.join()).toMatch(
      /plafond \(10 %\)/,
    );
    expect(h.sales.preview(seller, line(1000), null, null).issues).toEqual([]);
    expect(h.sales.preview(h.as('manager'), line(3000), null, null).issues).toEqual([]);
    expect(h.sales.preview(h.as('manager'), line(6000), null, null).issues.join()).toMatch(
      /minimum autorisé/,
    );
    expect(h.sales.preview(h.as('admin'), line(6000), null, null).issues).toEqual([]);
    expect(() =>
      h.sales.checkout(
        seller,
        h.checkoutInput({
          lines: line(1500),
          payments: [{ method: 'cash', amount: 8500, reference: null }],
        }),
      ),
    ).toThrow(/plafond/);
  });

  it('répartit une remise globale sur les lignes et la journalise', () => {
    const a = cable(10, 3000);
    const b = h.product({ name: 'Coque', variants: [variant({ salePrice: 1000 })] }, 10);
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [
          { variantId: a, quantity: 1, discount: null },
          { variantId: b, quantity: 1, discount: null },
        ],
        globalDiscount: { type: 'amount', value: 401 },
        payments: [{ method: 'cash', amount: 3599, reference: null }],
      }),
    );
    expect(sale.lines.map((l) => l.discount)).toEqual([301, 100]);
    expect(sale).toMatchObject({ subtotal: 4000, discountTotal: 401, total: 3599 });
  });
});

describe('articles suivis, kits et services', () => {
  it('vend un téléphone à l’unité, avec fin de garantie, et jamais deux fois', () => {
    const variantId = phone();
    h.sessions.open(h.manager, 0);
    const unit = unitId(IMEIS[0] ?? '');
    expect(
      h.sales
        .preview(h.manager, [{ variantId, quantity: 1, discount: null }], null, null)
        .issues.join(),
    ).toMatch(/choisissez 1 unité/);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 1, discount: null, serialUnitIds: [unit] }],
        payments: [{ method: 'cash', amount: 120_000, reference: null }],
      }),
    );
    expect(sale.lines[0]?.serialNumber).toBe(IMEIS[0]);
    expect(sale.lines[0]?.warrantyEnd).toMatch(new RegExp(`^${String(Number(year) + 1)}-`));
    expect(h.products.findSerial(h.manager, IMEIS[0] ?? '')[0]).toMatchObject({
      status: 'sold',
      invoiceNumber: sale.invoiceNumber,
    });
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({
          lines: [{ variantId, quantity: 1, discount: null, serialUnitIds: [unit] }],
          payments: [{ method: 'cash', amount: 120_000, reference: null }],
        }),
      ),
    ).toThrow(/pas en stock|pas disponible/);
  });

  it('éclate un kit en composants, sans stock propre, et vend un service sans stock', () => {
    const panel = h.product(
      { name: 'Panneau', productType: 'solar', variants: [variant({ salePrice: 90_000 })] },
      5,
    );
    const battery = h.product(
      { name: 'Batterie', productType: 'solar', variants: [variant({ salePrice: 150_000 })] },
      5,
    );
    const kit = h.product({
      name: 'Kit solaire',
      productType: 'kit',
      variants: [variant({ salePrice: 300_000 })],
    });
    h.products.setKitComponents(h.manager, kit, [
      { variantId: panel, quantity: 2 },
      { variantId: battery, quantity: 1 },
    ]);
    const install = h.product({
      name: 'Installation',
      productType: 'service',
      variants: [variant({ salePrice: 25_000 })],
    });
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [
          { variantId: kit, quantity: 2, discount: null },
          { variantId: install, quantity: 1, discount: null },
        ],
        payments: [{ method: 'transfer', amount: 625_000, reference: 'VIR-1' }],
      }),
    );
    expect(sale.lines.map((l) => [l.lineType, l.name, l.quantity, l.lineTotal])).toEqual([
      ['kit', 'Kit solaire', 2, 600_000],
      ['kit_component', 'Panneau', 4, 0],
      ['kit_component', 'Batterie', 2, 0],
      ['service', 'Installation', 1, 25_000],
    ]);
    expect([h.stockOf(panel), h.stockOf(battery)]).toEqual([1, 3]);
    expect(sale.margin).toBe(625_000 - 6 * 1000);
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({
          lines: [{ variantId: kit, quantity: 1, discount: null }],
          payments: [{ method: 'cash', amount: 300_000, reference: null }],
        }),
      ),
    ).toThrow(/Stock insuffisant pour « Panneau »/);
  });
});

describe('crédit, échéances et dettes', () => {
  it('exige client, échéances et plafond de crédit, puis impute les remboursements', () => {
    const variantId = cable(10, 10_000);
    h.sessions.open(h.manager, 0);
    const line = [{ variantId, quantity: 3, discount: null }];
    const partial = [{ method: 'cash' as const, amount: 10_000, reference: null }];
    expect(() =>
      h.sales.checkout(h.manager, h.checkoutInput({ lines: line, payments: partial })),
    ).toThrow(/choisissez le client/);
    const blocked = customer(0);
    const installments = [
      { dueDate: '2099-01-15', amount: 10_000 },
      { dueDate: '2099-02-15', amount: 10_000 },
    ];
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({ customerId: blocked, lines: line, payments: partial, installments }),
      ),
    ).toThrow(/plafond de crédit/);
    expect(() =>
      h.customers.save(h.as('seller'), {
        ...h.customers.get(h.manager, blocked),
        creditLimit: 50_000,
      }),
    ).toThrow(/droit/);
    h.customers.save(h.manager, { ...h.customers.get(h.manager, blocked), creditLimit: 50_000 });
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({ customerId: blocked, lines: line, payments: partial, installments }),
    );
    expect(sale).toMatchObject({ remaining: 20_000, dueDate: '2099-02-15' });
    expect(h.customers.get(h.manager, blocked).balance).toBe(20_000);
    expect(() =>
      h.customers.payDebt(h.manager, {
        customerId: blocked,
        amount: 25_000,
        method: 'cash',
        reference: null,
      }),
    ).toThrow(/dépasse/);
    h.customers.payDebt(h.manager, {
      customerId: blocked,
      amount: 15_000,
      method: 'cash',
      reference: null,
    });
    const after = h.sales.detail(h.manager, sale.id);
    expect(after.installments.map((i) => [i.paidAmount, i.status])).toEqual([
      [10_000, 'paid'],
      [5000, 'partial'],
    ]);
    expect(h.customers.get(h.manager, blocked).balance).toBe(5000);
    expect(h.sessions.current(h.manager)?.expectedCash).toBe(25_000);
  });
});

describe('paniers en attente', () => {
  it('met en attente, reprend puis termine la même vente, et bloque la clôture tant qu’un panier attend', () => {
    const variantId = cable();
    const tracked = phone();
    h.sessions.open(h.manager, 0);
    const { heldSaleId } = h.sales.hold(h.manager, {
      customerId: null,
      lines: [
        { variantId, quantity: 2, discount: { type: 'amount', value: 500 } },
        {
          variantId: tracked,
          quantity: 1,
          discount: null,
          serialUnitIds: [unitId(IMEIS[1] ?? '')],
        },
      ],
      globalDiscount: null,
    });
    expect(h.sales.heldSales(h.manager)).toEqual([
      expect.objectContaining({ id: heldSaleId, itemCount: 3 }),
    ]);
    expect(() => h.sessions.close(h.manager, 0, null)).toThrow(/paniers sont en attente/);
    const cart = h.sales.resume(h.manager, heldSaleId);
    expect(cart.lines).toEqual([
      { variantId, quantity: 2, discount: { type: 'amount', value: 500 } },
      { variantId: tracked, quantity: 1, discount: null, serialUnitIds: [unitId(IMEIS[1] ?? '')] },
    ]);
    expect(h.stockOf(variantId)).toBe(10);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        heldSaleId,
        lines: cart.lines,
        payments: [{ method: 'cash', amount: 124_500, reference: null }],
      }),
    );
    expect(sale.id).toBe(heldSaleId);
    expect(h.sales.heldSales(h.manager)).toEqual([]);
    const second = h.sales.hold(h.manager, {
      customerId: null,
      lines: [{ variantId, quantity: 1, discount: null }],
      globalDiscount: null,
    });
    h.sales.discard(h.manager, second.heldSaleId);
    expect(h.sales.heldSales(h.manager)).toEqual([]);
    const third = h.sales.hold(h.manager, {
      customerId: null,
      lines: [{ variantId, quantity: 1, discount: null }],
      globalDiscount: null,
    });
    expect(third.heldSaleId).toBe(second.heldSaleId);
  });
});

describe('annulation et retours', () => {
  it('annule pendant la session : stock, unité et espèces reviennent ; refusé après la clôture', () => {
    const variantId = phone();
    const unit = unitId(IMEIS[0] ?? '');
    h.sessions.open(h.manager, 1000);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 1, discount: null, serialUnitIds: [unit] }],
        payments: [{ method: 'cash', amount: 120_000, reference: null }],
      }),
    );
    expect(() => h.sales.cancel(h.as('seller'), sale.id, 'Erreur de caisse')).toThrow(/droit/);
    const cancelled = h.sales.cancel(h.manager, sale.id, 'Erreur de caisse');
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Erreur de caisse',
      cancellable: false,
    });
    expect(h.stockOf(variantId)).toBe(2);
    expect(h.products.findSerial(h.manager, IMEIS[0] ?? '')[0]).toMatchObject({
      status: 'in_stock',
      invoiceNumber: null,
    });
    expect(h.sessions.current(h.manager)?.expectedCash).toBe(1000);
    const other = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 1, discount: null, serialUnitIds: [unit] }],
        payments: [{ method: 'cash', amount: 120_000, reference: null }],
      }),
    );
    h.sessions.close(h.manager, 121_000, null);
    expect(() => h.sales.cancel(h.manager, other.id, 'Trop tard')).toThrow(/clôturée/);
  });

  it('retourne article par article : remise en stock, rebut, avoir et plafonds', () => {
    const variantId = cable(10, 5000);
    const tracked = phone();
    const client = customer(0);
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        customerId: client,
        lines: [
          { variantId, quantity: 4, discount: null },
          {
            variantId: tracked,
            quantity: 1,
            discount: null,
            serialUnitIds: [unitId(IMEIS[0] ?? '')],
          },
        ],
        payments: [{ method: 'cash', amount: 140_000, reference: null }],
      }),
    );
    const [cableLine, phoneLine] = sale.lines;
    expect(() =>
      h.sales.returnItems(h.as('seller'), {
        saleId: sale.id,
        reason: 'Défaut',
        lines: [{ saleLineId: cableLine?.id ?? 0, quantity: 1, restock: true }],
        refundMethod: 'cash',
      }),
    ).toThrow(/droit/);
    const afterReturn = h.sales.returnItems(h.manager, {
      saleId: sale.id,
      reason: 'Ne convient pas',
      lines: [{ saleLineId: cableLine?.id ?? 0, quantity: 2, restock: true }],
      refundMethod: 'cash',
    });
    expect(afterReturn.lines[0]?.returnedQuantity).toBe(2);
    expect(h.stockOf(variantId)).toBe(8);
    expect(h.sessions.current(h.manager)?.expectedCash).toBe(130_000);
    expect(() =>
      h.sales.returnItems(h.manager, {
        saleId: sale.id,
        reason: 'Encore',
        lines: [{ saleLineId: cableLine?.id ?? 0, quantity: 3, restock: true }],
        refundMethod: 'cash',
      }),
    ).toThrow(/supérieure à la quantité vendue/);
    h.sales.returnItems(h.manager, {
      saleId: sale.id,
      reason: 'Écran fissuré',
      lines: [{ saleLineId: phoneLine?.id ?? 0, quantity: 1, restock: false }],
      refundMethod: 'credit_note',
    });
    expect(h.products.findSerial(h.manager, IMEIS[0] ?? '')[0]?.status).toBe('written_off');
    expect(h.customers.get(h.manager, client).balance).toBe(-120_000);
    expect(() => h.sales.cancel(h.manager, sale.id, 'Annuler')).toThrow(/déjà un retour/);
  });
});

describe('devis', () => {
  it('réserve une unité, la protège des autres ventes et se convertit aux prix du devis', () => {
    const tracked = phone();
    const variantId = cable(5, 2000);
    const client = customer();
    const reserved = unitId(IMEIS[0] ?? '');
    const quote = h.quotes.save(h.manager, {
      customerId: client,
      validUntil: '2099-12-31',
      reserveStock: true,
      notes: null,
      lines: [
        {
          variantId: tracked,
          quantity: 1,
          discount: { type: 'amount', value: 10_000 },
          serialUnitIds: [reserved],
        },
        { variantId, quantity: 4, discount: null },
      ],
      globalDiscount: null,
    });
    expect(quote.quote).toMatchObject({
      number: `DEV-${year}-00001`,
      status: 'draft',
      total: 118_000,
    });
    expect(h.products.findSerial(h.manager, IMEIS[0] ?? '')[0]?.status).toBe('reserved');
    h.sessions.open(h.manager, 0);
    expect(
      h.sales
        .preview(h.manager, [{ variantId, quantity: 2, discount: null }], null, null)
        .issues.join(),
    ).toMatch(/1 disponible/);
    expect(() =>
      h.sales.checkout(
        h.manager,
        h.checkoutInput({
          lines: [{ variantId: tracked, quantity: 1, discount: null, serialUnitIds: [reserved] }],
          payments: [{ method: 'cash', amount: 120_000, reference: null }],
        }),
      ),
    ).toThrow(/pas disponible/);
    h.products.saveVariant(h.as('admin'), {
      productId: h.test.db
        .prepare('SELECT product_id FROM product_variants WHERE id = ?')
        .pluck()
        .get(variantId) as number,
      id: variantId,
      ...variant({
        sku: h.test.db
          .prepare('SELECT sku FROM product_variants WHERE id = ?')
          .pluck()
          .get(variantId) as string,
        salePrice: 9999,
      }),
    });
    const cart = h.quotes.toCart(h.manager, quote.quote.id);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        quoteId: quote.quote.id,
        customerId: client,
        lines: cart.lines,
        payments: [{ method: 'cash', amount: 118_000, reference: null }],
      }),
    );
    expect(sale.total).toBe(118_000);
    expect(h.quotes.get(h.manager, quote.quote.id).quote).toMatchObject({
      status: 'converted',
      convertedInvoice: sale.invoiceNumber,
    });
    expect(() => h.quotes.toCart(h.manager, quote.quote.id)).toThrow(/plus convertible/);
  });

  it('expire les devis échus et libère leurs unités', () => {
    const tracked = phone();
    const reserved = unitId(IMEIS[1] ?? '');
    const quote = h.quotes.save(h.manager, {
      customerId: null,
      validUntil: '2099-01-01',
      reserveStock: true,
      notes: null,
      lines: [{ variantId: tracked, quantity: 1, discount: null, serialUnitIds: [reserved] }],
      globalDiscount: null,
    });
    h.test.db
      .prepare("UPDATE quotes SET valid_until = '2020-01-01' WHERE id = ?")
      .run(quote.quote.id);
    expect(h.quotes.list(h.manager, 'all', 10)[0]?.status).toBe('expired');
    expect(h.products.findSerial(h.manager, IMEIS[1] ?? '')[0]?.status).toBe('in_stock');
  });
});

describe('livraisons et règles de la base', () => {
  it('crée la livraison avec la vente et la clôt une seule fois', () => {
    const variantId = cable();
    const client = customer();
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        customerId: client,
        lines: [{ variantId, quantity: 1, discount: null }],
        payments: [{ method: 'cash', amount: 2500, reference: null }],
        delivery: { address: 'Cocody Angré, villa 12', scheduledOn: '2099-01-02', notes: null },
      }),
    );
    const [delivery] = h.followups.deliveries(h.manager, 'to_deliver', 10);
    expect(delivery).toMatchObject({
      saleId: sale.id,
      address: 'Cocody Angré, villa 12',
      customerName: 'Aya Koné',
    });
    h.followups.updateDelivery(h.manager, delivery?.id ?? 0, 'delivered');
    expect(() => h.followups.updateDelivery(h.manager, delivery?.id ?? 0, 'cancelled')).toThrow(
      /déjà terminée/,
    );
  });

  it('refuse une taxe ajoutée au total (prix TTC, migration 0008)', () => {
    const variantId = cable();
    h.sessions.open(h.manager, 0);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId, quantity: 1, discount: null }],
        payments: [{ method: 'cash', amount: 2500, reference: null }],
      }),
    );
    expect(() =>
      h.test.db
        .prepare(
          "INSERT INTO quotes (number, user_id, valid_until, tax_total, subtotal, total) VALUES ('X', 1, '2099-01-01', 10, 0, 10)",
        )
        .run(),
    ).toThrow(/TTC/);
    expect(sale.taxIncluded).toBe(0);
  });
});

describe('anonymisation d’un client sur demande (B.3)', () => {
  it('refuse tant qu’il doit, réserve l’action à l’administrateur et garde ses ventes', () => {
    const variantId = cable(10, 10_000);
    h.sessions.open(h.manager, 0);
    const customerId = customer(50_000);
    const sale = h.sales.checkout(
      h.manager,
      h.checkoutInput({
        customerId,
        lines: [{ variantId, quantity: 2, discount: null }],
        payments: [{ method: 'cash', amount: 5000, reference: null }],
        installments: [{ dueDate: '2099-01-15', amount: 15_000 }],
      }),
    );
    const admin = h.as('admin');
    expect(() => h.customers.anonymize(h.manager, customerId)).toThrow(/droit/);
    expect(() => h.customers.anonymize(admin, customerId)).toThrow(/solde en cours/);
    h.customers.payDebt(h.manager, { customerId, amount: 15_000, method: 'cash', reference: null });
    const erased = h.customers.anonymize(admin, customerId);
    expect(erased).toMatchObject({
      fullName: `Client anonymisé n° ${String(customerId)}`,
      phone: null,
      address: null,
      notes: null,
      anonymized: true,
      isActive: false,
    });
    expect(h.customers.search(h.manager, 'Aya', 10)).toEqual([]);
    expect(h.sales.detail(h.manager, sale.id).total).toBe(20_000);
    expect(() =>
      h.customers.save(h.manager, { ...erased, fullName: 'Aya Koné', phone: '0707070707' }),
    ).toThrow(/anonymisé/);
    expect(() => h.customers.anonymize(admin, customerId)).toThrow(/déjà anonymisé/);
    expect(
      h.test.db
        .prepare("SELECT details FROM audit_log WHERE action = 'customer.anonymized'")
        .pluck()
        .all(),
    ).toEqual(['{}']);
  });
});
