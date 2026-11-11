import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InventoryReport } from '../../../src/main/inventory/inventory-report';
import { InventoryService } from '../../../src/main/inventory/inventory-service';
import { WarrantyService } from '../../../src/main/warranty/warranty-service';
import { fakeDialogs } from '../auth/harness';
import { createSalesHarness, variant, type SalesHarness } from '../sales/harness';

let h: SalesHarness;
let inventories: InventoryService;
let shop: number;
const IMEIS = ['490154203237518', '356938035643809', '352099001761481'];

beforeEach(() => {
  h = createSalesHarness();
  inventories = new InventoryService(h.test.db);
  shop = h.test.db
    .prepare('SELECT id FROM stock_locations WHERE is_default = 1')
    .pluck()
    .get() as number;
});

afterEach(() => {
  h.cleanup();
});

function cable(quantity = 10) {
  return h.product(
    { name: 'Câble USB-C', variants: [variant({ salePrice: 2500, barcode: '0011' })] },
    quantity,
  );
}

function phones() {
  return h.product(
    {
      name: 'Galaxy A15',
      productType: 'phone',
      trackingMode: 'imei',
      warrantyMonths: 12,
      variants: [variant({ salePrice: 120_000 })],
    },
    3,
    IMEIS,
  );
}

function unitId(serial: string): number {
  return h.test.db
    .prepare('SELECT id FROM serial_units WHERE serial_number = ?')
    .pluck()
    .get(serial) as number;
}

function open(name = 'Inventaire de novembre') {
  return inventories.create(h.manager, { name, scopeType: 'all', scopeId: null, locationId: shop });
}

function lineOf(detail: ReturnType<typeof open>, name: string) {
  const line = detail.lines.find((candidate) => candidate.name === name);
  if (line === undefined) throw new Error(`ligne ${name} absente`);
  return line;
}

describe('inventaire', () => {
  it('fige les quantités attendues à l’ouverture et compte au scanner', () => {
    const cableId = cable();
    phones();
    h.product({
      name: 'Installation',
      productType: 'service',
      variants: [variant({ salePrice: 1 })],
    });
    const created = open();
    expect(created.lines.map((line) => [line.name, line.expected])).toEqual([
      ['Câble USB-C', 10],
      ['Galaxy A15', 3],
    ]);
    h.sessions.open(h.manager, 0);
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [{ variantId: cableId, quantity: 1, discount: null }],
        payments: [{ method: 'cash', amount: 2500, reference: null }],
      }),
    );
    const id = created.inventory.id;
    expect(lineOf(inventories.detail(h.manager, id), 'Câble USB-C').expected).toBe(10);
    expect(inventories.scan(h.manager, id, '0011')).toMatchObject({ kind: 'item', counted: 1 });
    expect(inventories.scan(h.manager, id, IMEIS[0] ?? '')).toMatchObject({
      kind: 'unit',
      counted: 1,
    });
    expect(() => inventories.scan(h.manager, id, IMEIS[0] ?? '')).toThrow(/déjà compté/);
    expect(() => inventories.scan(h.manager, id, 'P999999-1')).toThrow(/n’appartient pas/);
    const detail = inventories.detail(h.manager, id);
    expect(
      lineOf(detail, 'Galaxy A15')
        .missing.map((unit) => unit.serialNumber)
        .sort(),
    ).toEqual([IMEIS[1], IMEIS[2]].sort());
    expect(() => inventories.setCount(h.manager, id, lineOf(detail, 'Galaxy A15').id, 3)).toThrow(
      /scannez le numéro/,
    );
  });

  it('exige que tout soit compté, puis valide les écarts par des mouvements « inventaire »', () => {
    const cableId = cable();
    phones();
    const created = open();
    const id = created.inventory.id;
    inventories.setCount(
      h.manager,
      id,
      lineOf(created, 'Câble USB-C').id,
      7,
      'Trois câbles abîmés jetés',
    );
    inventories.scan(h.manager, id, IMEIS[0] ?? '');
    inventories.scan(h.manager, id, IMEIS[1] ?? '');
    const review = inventories.finishCounting(h.manager, id);
    expect(review.inventory).toMatchObject({
      status: 'review',
      differenceCount: 2,
      differenceValue: -3 * 1000 - 1000,
    });
    expect(review.canValidate).toBe(true);
    expect(() => inventories.validate(h.as('seller'), id)).toThrow(/droit/);
    const validated = inventories.validate(h.manager, id);
    expect(validated.inventory.status).toBe('validated');
    expect(h.stockOf(cableId)).toBe(7);
    expect(h.products.findSerial(h.manager, IMEIS[2] ?? '')[0]?.status).toBe('written_off');
    expect(
      h.stock
        .movements(h.manager, { type: 'inventory', limit: 10 })
        .map((m) => m.quantityDelta)
        .sort((a, b) => a - b),
    ).toEqual([-3, -1]);
    expect(h.test.db.prepare('SELECT * FROM v_stock_discrepancies').all()).toEqual([]);
    expect(() => inventories.setCount(h.manager, id, lineOf(created, 'Câble USB-C').id, 1)).toThrow(
      /terminé/,
    );
  });

  it('refuse de terminer avec des lignes non comptées sans mise à zéro explicite', () => {
    cable();
    const id = open().inventory.id;
    expect(() => inventories.finishCounting(h.manager, id)).toThrow(/ne sont pas comptés/);
    inventories.zeroUncounted(h.manager, id);
    expect(inventories.finishCounting(h.manager, id).inventory.status).toBe('review');
    expect(inventories.resumeCounting(h.manager, id).inventory.status).toBe('counting');
  });

  it('remet en stock un appareil retrouvé après une sortie', () => {
    const phoneId = phones();
    h.stock.exit(h.manager, {
      variantId: phoneId,
      locationId: shop,
      type: 'loss',
      direction: 'out',
      quantity: 1,
      reason: 'Introuvable',
      serialUnitIds: [unitId(IMEIS[2] ?? '')],
    });
    const id = open().inventory.id;
    for (const serial of IMEIS) inventories.scan(h.manager, id, serial);
    inventories.finishCounting(h.manager, id);
    inventories.validate(h.manager, id);
    expect(h.products.findSerial(h.manager, IMEIS[2] ?? '')[0]?.status).toBe('in_stock');
    expect(h.stockOf(phoneId)).toBe(3);
  });

  it('ne compte pas un appareil vendu et applique le double contrôle', () => {
    const phoneId = phones();
    h.sessions.open(h.manager, 0);
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        lines: [
          {
            variantId: phoneId,
            quantity: 1,
            discount: null,
            serialUnitIds: [unitId(IMEIS[0] ?? '')],
          },
        ],
        payments: [{ method: 'cash', amount: 120_000, reference: null }],
      }),
    );
    const id = open().inventory.id;
    expect(() => inventories.scan(h.manager, id, IMEIS[0] ?? '')).toThrow(/vendu/);
    inventories.zeroUncounted(h.manager, id);
    inventories.finishCounting(h.manager, id);
    h.test.db
      .prepare("UPDATE settings SET value = 'true' WHERE key = 'inventory.double_check'")
      .run();
    expect(inventories.detail(h.manager, id).canValidate).toBe(false);
    expect(() => inventories.validate(h.manager, id)).toThrow(/autre personne/);
    expect(inventories.validate(h.as('admin'), id).inventory.validatedBy).toBe(
      'Utilisateur user_admin',
    );
  });

  it('limite le périmètre à une marque et exporte le rapport', async () => {
    const admin = h.as('admin');
    const brand = h.references.saveBrand(admin, { name: 'Oraimo', isActive: true });
    h.product(
      { name: 'Écouteurs Oraimo', brandId: brand.id, variants: [variant({ salePrice: 9000 })] },
      4,
    );
    cable();
    const created = inventories.create(h.manager, {
      name: 'Oraimo',
      scopeType: 'brand',
      scopeId: brand.id,
      locationId: shop,
    });
    expect(created.lines.map((line) => line.name)).toEqual(['Écouteurs Oraimo']);
    expect(created.inventory.scopeLabel).toBe('Marque : Oraimo');
    const fake = fakeDialogs({ save: join(h.test.directory, 'inventaire.xlsx') });
    const report = new InventoryReport(h.test.db, inventories, fake.dialogs);
    expect(await report.export(h.manager, created.inventory.id, 'xlsx')).toEqual({ saved: true });
    fake.state.save = join(h.test.directory, 'inventaire.pdf');
    await report.export(h.manager, created.inventory.id, 'pdf');
    expect(readFileSync(fake.state.save).subarray(0, 5).toString()).toBe('%PDF-');
    expect(inventories.cancel(h.manager, created.inventory.id).inventory.status).toBe('cancelled');
    expect(() => inventories.scan(h.manager, created.inventory.id, '0011')).toThrow(/terminé/);
  });
});

describe('garantie et SAV', () => {
  function soldPhone() {
    const phoneId = phones();
    h.sessions.open(h.manager, 0);
    const client = h.customers.save(h.manager, {
      fullName: 'Aya Koné',
      phone: '0707070707',
      address: null,
      notes: null,
      creditLimit: 0,
      isActive: true,
    });
    h.sales.checkout(
      h.manager,
      h.checkoutInput({
        customerId: client.id,
        lines: [
          {
            variantId: phoneId,
            quantity: 1,
            discount: null,
            serialUnitIds: [unitId(IMEIS[0] ?? '')],
          },
        ],
        payments: [{ method: 'cash', amount: 120_000, reference: null }],
      }),
    );
    return phoneId;
  }

  it('retrouve la vente par IMEI et suit une réclamation jusqu’à sa clôture', () => {
    soldPhone();
    const warranty = new WarrantyService(h.test.db);
    const found = warranty.lookup(h.manager, ` ${IMEIS[0] ?? ''} `);
    expect(found).toMatchObject({ status: 'sold', customerName: 'Aya Koné', claims: [] });
    expect(found.daysLeft).toBeGreaterThan(360);
    const claim = warranty.open(h.manager, found.unitId, 'Ne charge plus', null);
    expect(claim).toMatchObject({
      status: 'received',
      warrantyExpired: false,
      customerName: 'Aya Koné',
    });
    expect(() => warranty.open(h.manager, found.unitId, 'Écran', null)).toThrow(/déjà en cours/);
    warranty.update(h.manager, {
      claimId: claim.id,
      status: 'sent_to_supplier',
      resolution: null,
      supplierId: null,
    });
    expect(() =>
      warranty.update(h.manager, {
        claimId: claim.id,
        status: 'received',
        resolution: null,
        supplierId: null,
      }),
    ).toThrow(/impossible/);
    expect(() =>
      warranty.update(h.manager, {
        claimId: claim.id,
        status: 'closed',
        resolution: null,
        supplierId: null,
      }),
    ).toThrow(/solution/);
    warranty.update(h.manager, {
      claimId: claim.id,
      status: 'repaired',
      resolution: 'Connecteur remplacé',
      supplierId: null,
    });
    const closed = warranty.update(h.manager, {
      claimId: claim.id,
      status: 'closed',
      resolution: null,
      supplierId: null,
    });
    expect(closed).toMatchObject({ status: 'closed', resolution: 'Connecteur remplacé' });
    expect(closed.closedAt).not.toBeNull();
    expect(() =>
      h.test.db.prepare('UPDATE warranty_claims SET issue = ? WHERE id = ?').run('x', claim.id),
    ).toThrow(/WARRANTY_LOCKED/);
    expect(warranty.lookup(h.manager, IMEIS[0] ?? '').claims).toHaveLength(1);
  });

  it('signale une garantie dépassée, refuse un appareil non vendu et liste les fins proches', () => {
    soldPhone();
    const later = new WarrantyService(h.test.db, () => Date.parse('2099-01-01T10:00:00Z'));
    const unit = unitId(IMEIS[0] ?? '');
    expect(later.lookup(h.manager, IMEIS[0] ?? '').daysLeft).toBeLessThan(0);
    expect(later.open(h.manager, unit, 'Batterie gonflée', null).warrantyExpired).toBe(true);
    expect(() => later.open(h.manager, unitId(IMEIS[1] ?? ''), 'Panne', null)).toThrow(
      /appareil vendu/,
    );
    expect(() => later.lookup(h.manager, '000')).toThrow(/Aucun appareil/);
    h.test.db
      .prepare(
        "UPDATE serial_units SET warranty_end = date('now', 'localtime', '+10 days') WHERE id = ?",
      )
      .run(unit);
    expect(new WarrantyService(h.test.db).expiring(h.manager)).toEqual([
      expect.objectContaining({ serialNumber: IMEIS[0], customerName: 'Aya Koné', daysLeft: 10 }),
    ]);
    expect(() => later.lookup(h.as('admin', 'pin'), IMEIS[0] ?? '')).toThrow(/droit/);
  });
});
