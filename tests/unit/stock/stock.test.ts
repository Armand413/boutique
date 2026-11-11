import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../../../src/main/auth/session';
import { StockService } from '../../../src/main/stock/stock-service';
import { SupplierService } from '../../../src/main/stock/supplier-service';
import { weightedAverageCost } from '../../../src/main/stock/movements';
import type { CreateReceiptInput } from '../../../src/shared/schemas/stock';
import {
  createCatalogHarness,
  productInput,
  variant,
  type CatalogHarness,
} from '../catalog/harness';

let h: CatalogHarness;
let stock: StockService;
let suppliers: SupplierService;
let manager: Session;
let shop: number;

const IMEIS = ['490154203237518', '356938035643809', '352099001761481'];

beforeEach(() => {
  h = createCatalogHarness();
  stock = new StockService(h.test.db);
  suppliers = new SupplierService(h.test.db);
  manager = h.as('manager');
  shop = h.test.db
    .prepare('SELECT id FROM stock_locations WHERE is_default = 1')
    .pluck()
    .get() as number;
});

afterEach(() => {
  h.cleanup();
});

function cable(reorderLevel = 0): number {
  const product = h.products.create(
    manager,
    productInput(h.family('Téléphonie'), {
      reorderLevel,
      variants: [variant({ salePrice: 2500 })],
    }),
  );
  return product.variants[0]?.id ?? 0;
}

function phone(): number {
  const product = h.products.create(
    manager,
    productInput(h.family('Téléphonie'), {
      name: 'Galaxy A15',
      productType: 'phone',
      trackingMode: 'imei',
      variants: [variant({ salePrice: 120_000 })],
    }),
  );
  return product.variants[0]?.id ?? 0;
}

function supplier(name = 'Grossiste Adjamé'): number {
  return suppliers.save(manager, {
    name,
    phone: null,
    email: null,
    address: null,
    notes: null,
    isActive: true,
  }).id;
}

function receipt(
  supplierId: number,
  lines: CreateReceiptInput['lines'],
  extra: Partial<CreateReceiptInput> = {},
): CreateReceiptInput {
  return {
    supplierId,
    locationId: shop,
    receivedOn: '2026-11-11',
    notes: null,
    lines,
    payment: null,
    ...extra,
  };
}

function depot(): number {
  return stock.saveLocation(h.as('admin'), { name: 'Dépôt', isDefault: false, isActive: true }).id;
}

function quantityAt(variantId: number, locationId: number): number {
  return (
    (h.test.db
      .prepare('SELECT quantity FROM stock_levels WHERE variant_id = ? AND location_id = ?')
      .pluck()
      .get(variantId, locationId) as number | undefined) ?? 0
  );
}

function discrepancies(): unknown[] {
  return h.test.db.prepare('SELECT * FROM v_stock_discrepancies').all();
}

describe('coût moyen pondéré', () => {
  it('pondère par les quantités et arrondit à l’unité', () => {
    expect(weightedAverageCost(0, 0, 10, 1000)).toBe(1000);
    expect(weightedAverageCost(10, 1000, 10, 1500)).toBe(1250);
    expect(weightedAverageCost(3, 1000, 1, 1001)).toBe(1000);
    expect(weightedAverageCost(-2, 500, 5, 800)).toBe(800);
  });
});

describe('entrées de marchandise', () => {
  it('crée un bon numéroté, les mouvements et recalcule le coût moyen', () => {
    const variantId = cable();
    const supplierId = supplier();
    const first = suppliers.receive(
      manager,
      receipt(supplierId, [{ variantId, quantity: 10, unitCost: 1000 }]),
    );
    const second = suppliers.receive(
      manager,
      receipt(supplierId, [{ variantId, quantity: 10, unitCost: 1500 }]),
    );
    expect([first.receipt.number, second.receipt.number]).toEqual([
      'BR-2026-00001',
      'BR-2026-00002',
    ]);
    expect(second.receipt).toMatchObject({ status: 'validated', totalCost: 15_000, paid: 0 });
    expect(quantityAt(variantId, shop)).toBe(20);
    expect(
      h.test.db
        .prepare('SELECT avg_cost, cost_price FROM product_variants WHERE id = ?')
        .get(variantId),
    ).toEqual({
      avg_cost: 1250,
      cost_price: 1500,
    });
    const [last] = stock.movements(manager, { variantId, limit: 10 });
    expect(last).toMatchObject({
      type: 'purchase',
      quantityDelta: 10,
      quantityAfter: 20,
      unitCost: 1500,
      reference: 'BR-2026-00002',
    });
    expect(discrepancies()).toEqual([]);
  });

  it('enregistre un IMEI par téléphone reçu, avec un seul calcul du coût moyen', () => {
    const variantId = phone();
    const detail = suppliers.receive(
      manager,
      receipt(supplier(), [
        {
          variantId,
          quantity: 2,
          unitCost: 90_001,
          serials: [
            { serialNumber: IMEIS[0] ?? '', imei2: IMEIS[2] ?? null },
            { serialNumber: ` ${IMEIS[1] ?? ''} `, imei2: null },
          ],
        },
      ]),
    );
    expect(detail.lines[0]?.serials).toEqual([IMEIS[0], IMEIS[1]]);
    expect(quantityAt(variantId, shop)).toBe(2);
    expect(stock.availableUnits(manager, variantId, shop).map((unit) => unit.serialNumber)).toEqual(
      [IMEIS[1], IMEIS[0]],
    );
    expect(
      h.test.db
        .prepare('SELECT avg_cost FROM product_variants WHERE id = ?')
        .pluck()
        .get(variantId),
    ).toBe(90_001);
    expect(h.products.findSerial(manager, IMEIS[2] ?? '')[0]).toMatchObject({
      status: 'in_stock',
      productName: 'Galaxy A15',
    });
  });

  it('refuse tout le bon si un numéro manque, est invalide ou existe déjà', () => {
    const variantId = phone();
    const other = cable();
    const supplierId = supplier();
    const line = (serials: string[]) => ({
      variantId,
      quantity: 2,
      unitCost: 1,
      serials: serials.map((serialNumber) => ({ serialNumber, imei2: null })),
    });
    expect(() => suppliers.receive(manager, receipt(supplierId, [line([IMEIS[0] ?? ''])]))).toThrow(
      /2 article\(s\) reçus, 1 numéro/,
    );
    expect(() =>
      suppliers.receive(
        manager,
        receipt(supplierId, [
          { variantId: other, quantity: 5, unitCost: 10 },
          line([IMEIS[0] ?? '', '123456789012345']),
        ]),
      ),
    ).toThrow(/IMEI/);
    expect(() =>
      suppliers.receive(manager, receipt(supplierId, [line([IMEIS[0] ?? '', IMEIS[0] ?? ''])])),
    ).toThrow(/deux fois/);
    expect(quantityAt(other, shop)).toBe(0);
    expect(h.test.db.prepare('SELECT count(*) FROM goods_receipts').pluck().get()).toBe(0);
    suppliers.receive(manager, receipt(supplierId, [line([IMEIS[0] ?? '', IMEIS[1] ?? ''])]));
    expect(() =>
      suppliers.receive(manager, receipt(supplierId, [line([IMEIS[1] ?? '', IMEIS[2] ?? ''])])),
    ).toThrow();
    expect(quantityAt(variantId, shop)).toBe(2);
  });

  it('réserve les entrées au gérant et à l’administrateur', () => {
    const variantId = cable();
    const supplierId = supplier();
    expect(() =>
      suppliers.receive(
        h.as('seller'),
        receipt(supplierId, [{ variantId, quantity: 1, unitCost: 1 }]),
      ),
    ).toThrow(/droit/);
    expect(() =>
      suppliers.receive(
        h.as('manager', 'pin'),
        receipt(supplierId, [{ variantId, quantity: 1, unitCost: 1 }]),
      ),
    ).toThrow(/droit/);
  });
});

describe('fournisseurs et paiements', () => {
  it('calcule le solde dû et refuse un paiement qui le dépasse', () => {
    const variantId = cable();
    const supplierId = supplier();
    const detail = suppliers.receive(
      manager,
      receipt(supplierId, [{ variantId, quantity: 4, unitCost: 2500 }], {
        payment: { amount: 4000, method: 'cash', reference: null },
      }),
    );
    expect(detail.receipt.paid).toBe(4000);
    expect(suppliers.list(manager)[0]).toMatchObject({ balance: 6000, receiptCount: 1 });
    expect(() =>
      suppliers.pay(manager, {
        supplierId,
        receiptId: detail.receipt.id,
        amount: 7000,
        method: 'transfer',
        reference: null,
        paidOn: '2026-11-12',
      }),
    ).toThrow(/dépasse/);
    const after = suppliers.pay(manager, {
      supplierId,
      receiptId: null,
      amount: 6000,
      method: 'mobile_money',
      reference: 'OM-42',
      paidOn: '2026-11-12',
    });
    expect(after.balance).toBe(0);
    expect(suppliers.detail(manager, supplierId).payments.map((p) => p.amount)).toEqual([
      6000, 4000,
    ]);
    expect(() => h.test.db.prepare('DELETE FROM supplier_payments').run()).toThrow(/IMMUTABLE/);
  });

  it('refuse deux fournisseurs du même nom et réserve la gestion à supplier.manage', () => {
    supplier('Solaire Pro');
    expect(() => supplier('SOLAIRE PRO')).toThrow(/déjà/);
    expect(() => suppliers.list(h.as('seller'))).toThrow(/droit/);
  });
});

describe('sorties, transferts et retours', () => {
  it('refuse une sortie au-delà du stock et exige un motif enregistré', () => {
    const variantId = cable();
    suppliers.receive(manager, receipt(supplier(), [{ variantId, quantity: 3, unitCost: 1000 }]));
    expect(() =>
      stock.exit(manager, {
        variantId,
        locationId: shop,
        type: 'loss',
        direction: 'out',
        quantity: 4,
        reason: 'Introuvable',
      }),
    ).toThrow(/insuffisant/);
    stock.exit(manager, {
      variantId,
      locationId: shop,
      type: 'damage',
      direction: 'out',
      quantity: 1,
      reason: 'Écran cassé',
    });
    stock.exit(manager, {
      variantId,
      locationId: shop,
      type: 'adjustment',
      direction: 'in',
      quantity: 2,
      reason: 'Recomptage',
    });
    expect(quantityAt(variantId, shop)).toBe(4);
    expect(stock.movements(manager, { variantId, limit: 1 })[0]).toMatchObject({
      type: 'adjustment',
      reason: 'Recomptage',
    });
    expect(() =>
      stock.exit(h.as('seller'), {
        variantId,
        locationId: shop,
        type: 'loss',
        direction: 'out',
        quantity: 1,
        reason: 'Perdu',
      }),
    ).toThrow(/droit/);
    expect(discrepancies()).toEqual([]);
  });

  it('sort un appareil suivi à l’unité, puis le réintègre s’il est retrouvé', () => {
    const variantId = phone();
    suppliers.receive(
      manager,
      receipt(supplier(), [
        {
          variantId,
          quantity: 2,
          unitCost: 1,
          serials: IMEIS.slice(0, 2).map((s) => ({ serialNumber: s, imei2: null })),
        },
      ]),
    );
    const [unit] = stock
      .availableUnits(manager, variantId, shop)
      .filter((u) => u.serialNumber === IMEIS[0]);
    if (unit === undefined) throw new Error('unité absente');
    expect(() =>
      stock.exit(manager, {
        variantId,
        locationId: shop,
        type: 'theft',
        direction: 'out',
        quantity: 1,
        reason: 'Vol en vitrine',
      }),
    ).toThrow(/une unité/);
    stock.exit(manager, {
      variantId,
      locationId: shop,
      type: 'theft',
      direction: 'out',
      quantity: 1,
      reason: 'Vol en vitrine',
      serialUnitIds: [unit.id],
    });
    expect(h.products.findSerial(manager, IMEIS[0] ?? '')[0]?.status).toBe('written_off');
    expect(stock.availableUnits(manager, variantId, shop)).toHaveLength(1);
    stock.exit(manager, {
      variantId,
      locationId: shop,
      type: 'adjustment',
      direction: 'in',
      quantity: 1,
      reason: 'Retrouvé',
      serials: [{ serialNumber: IMEIS[0] ?? '', imei2: null }],
    });
    expect(h.products.findSerial(manager, IMEIS[0] ?? '')[0]?.status).toBe('in_stock');
    expect(quantityAt(variantId, shop)).toBe(2);
  });

  it('transfère entre emplacements, y compris un appareil suivi', () => {
    const store = depot();
    const variantId = cable();
    const tracked = phone();
    const supplierId = supplier();
    suppliers.receive(manager, receipt(supplierId, [{ variantId, quantity: 10, unitCost: 1000 }]));
    suppliers.receive(
      manager,
      receipt(supplierId, [
        {
          variantId: tracked,
          quantity: 1,
          unitCost: 1,
          serials: [{ serialNumber: IMEIS[0] ?? '', imei2: null }],
        },
      ]),
    );
    stock.transfer(manager, {
      variantId,
      fromLocationId: shop,
      toLocationId: store,
      quantity: 4,
      reason: null,
    });
    expect([quantityAt(variantId, shop), quantityAt(variantId, store)]).toEqual([6, 4]);
    const [unit] = stock.availableUnits(manager, tracked, shop);
    stock.transfer(manager, {
      variantId: tracked,
      fromLocationId: shop,
      toLocationId: store,
      quantity: 1,
      serialUnitIds: [unit?.id ?? 0],
      reason: 'Dépôt',
    });
    expect(stock.availableUnits(manager, tracked, store).map((u) => u.serialNumber)).toEqual([
      IMEIS[0],
    ]);
    expect(stock.availableUnits(manager, tracked, shop)).toEqual([]);
    expect(() =>
      stock.transfer(manager, {
        variantId,
        fromLocationId: store,
        toLocationId: shop,
        quantity: 5,
        reason: null,
      }),
    ).toThrow(/insuffisant/);
    const overview = stock.overview(h.as('seller'), { locationId: store, offset: 0, limit: 50 });
    expect(overview.rows.map((row) => [row.name, row.total, row.avgCost])).toEqual([
      ['Câble USB-C', 10, null],
      ['Galaxy A15', 1, null],
    ]);
    expect(discrepancies()).toEqual([]);
  });

  it('rend un appareil au fournisseur', () => {
    const variantId = phone();
    const supplierId = supplier();
    suppliers.receive(
      manager,
      receipt(supplierId, [
        {
          variantId,
          quantity: 1,
          unitCost: 1,
          serials: [{ serialNumber: IMEIS[1] ?? '', imei2: null }],
        },
      ]),
    );
    const [unit] = stock.availableUnits(manager, variantId, shop);
    suppliers.returnToSupplier(manager, {
      supplierId,
      variantId,
      locationId: shop,
      quantity: 1,
      reason: 'Écran défectueux',
      serialUnitIds: [unit?.id ?? 0],
    });
    expect(h.products.findSerial(manager, IMEIS[1] ?? '')[0]?.status).toBe('supplier_returned');
    expect(stock.movements(manager, { variantId, limit: 1 })[0]).toMatchObject({
      type: 'purchase_return',
      quantityDelta: -1,
    });
  });
});

describe('emplacements, valorisation et alertes', () => {
  it('réserve les emplacements à l’administrateur et garde actif un emplacement non vide', () => {
    expect(() =>
      stock.saveLocation(manager, { name: 'Vitrine', isDefault: false, isActive: true }),
    ).toThrow(/droit/);
    const admin = h.as('admin');
    const store = stock.saveLocation(admin, { name: 'Dépôt', isDefault: true, isActive: true });
    expect(
      stock
        .locations(admin)
        .filter((l) => l.isDefault)
        .map((l) => l.name),
    ).toEqual(['Dépôt']);
    const variantId = cable();
    suppliers.receive(
      manager,
      receipt(supplier(), [{ variantId, quantity: 1, unitCost: 1 }], { locationId: store.id }),
    );
    expect(() =>
      stock.saveLocation(admin, { id: store.id, name: 'Dépôt', isDefault: false, isActive: true }),
    ).toThrow(/autre emplacement/);
    stock.saveLocation(admin, { id: shop, name: 'Magasin', isDefault: true, isActive: true });
    expect(() =>
      stock.saveLocation(admin, { id: store.id, name: 'Dépôt', isDefault: false, isActive: false }),
    ).toThrow(/contient du stock/);
  });

  it('valorise au coût moyen et au prix de vente, coûts masqués au vendeur', () => {
    const variantId = cable(5);
    suppliers.receive(manager, receipt(supplier(), [{ variantId, quantity: 4, unitCost: 1000 }]));
    expect(stock.valuation(manager)).toMatchObject({
      totalCost: 4000,
      totalSale: 10_000,
      units: 4,
      byFamily: [{ name: 'Téléphonie', units: 4, cost: 4000, sale: 10_000 }],
    });
    const seller = h.as('seller');
    expect(stock.valuation(seller)).toMatchObject({ totalCost: null, totalSale: 10_000 });
    expect(stock.movements(seller, { variantId, limit: 5 })[0]?.unitCost).toBeNull();
    expect(stock.alerts(seller)).toEqual({ lowStock: 1 });
    expect(stock.overview(seller, { lowStock: true, offset: 0, limit: 10 }).total).toBe(1);
  });
});
