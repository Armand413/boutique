import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductSearchInput } from '../../../src/shared/schemas/catalog';
import { move } from '../db/helpers';
import { createCatalogHarness, productInput, variant, type CatalogHarness } from './harness';

let h: CatalogHarness;

beforeEach(() => {
  h = createCatalogHarness();
});

afterEach(() => {
  h.cleanup();
});

const ALL: ProductSearchInput = { status: 'active', sort: 'name', offset: 0, limit: 50 };

function phoneInput(categoryId: number) {
  return productInput(categoryId, {
    name: 'Galaxy A15',
    productType: 'phone',
    trackingMode: 'imei',
    warrantyMonths: 12,
    variants: [
      variant({
        color: 'Noir',
        storageGb: 128,
        ramGb: 6,
        salePrice: 120_000,
        minSalePrice: 110_000,
        costPrice: 95_000,
      }),
      variant({
        color: 'Bleu',
        storageGb: 128,
        ramGb: 6,
        salePrice: 120_000,
        barcode: '8806095012345',
      }),
    ],
  });
}

describe('création et modification des produits', () => {
  it('crée un produit avec ses variantes, des références générées et un audit', () => {
    const phone = h.products.create(h.as('manager'), phoneInput(h.family('Téléphonie')));
    expect(phone).toMatchObject({
      name: 'Galaxy A15',
      trackingMode: 'imei',
      isStocked: true,
      typeLocked: false,
    });
    expect(phone.variants.map((v) => v.label)).toEqual([
      'Noir · 128 Go / 6 Go RAM',
      'Bleu · 128 Go / 6 Go RAM',
    ]);
    expect(phone.variants.map((v) => v.sku)).toEqual([
      `P${String(phone.id).padStart(6, '0')}-1`,
      `P${String(phone.id).padStart(6, '0')}-2`,
    ]);
    expect(phone.variants[0]).toMatchObject({ costPrice: 95_000, avgCost: 95_000 });
    const audit = h.test.db
      .prepare("SELECT action FROM audit_log WHERE entity_type = 'product'")
      .pluck()
      .all();
    expect(audit).toEqual(['product.created']);
  });

  it('refuse la création à un vendeur, et à une session ouverte par PIN', () => {
    const input = phoneInput(h.family('Téléphonie'));
    expect(() => h.products.create(h.as('seller'), input)).toThrow(/droit/);
    expect(() => h.products.create(h.as('manager', 'pin'), input)).toThrow(/mot de passe/);
  });

  it('masque les prix d’achat aux vendeurs, dans la fiche comme dans la recherche', () => {
    const phone = h.products.create(h.as('manager'), phoneInput(h.family('Téléphonie')));
    const seller = h.as('seller');
    const detail = h.products.detail(seller, phone.id);
    expect(detail.variants.map((v) => [v.costPrice, v.avgCost])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(h.products.search(seller, ALL).rows.every((row) => row.costPrice === null)).toBe(true);
    expect(h.products.search(h.as('manager'), ALL).rows[0]?.costPrice).toBe(95_000);
  });

  it('impose l’IMEI aux téléphones et aucun suivi aux services et kits', () => {
    const manager = h.as('manager');
    const phones = h.family('Téléphonie');
    expect(() =>
      h.products.create(manager, { ...phoneInput(phones), trackingMode: 'serial' }),
    ).toThrow(/IMEI/);
    expect(() =>
      h.products.create(
        manager,
        productInput(phones, { productType: 'service', trackingMode: 'serial' }),
      ),
    ).toThrow(/suivi/);
    const delivery = h.products.create(
      manager,
      productInput(phones, { name: 'Livraison', productType: 'service', reorderLevel: 5 }),
    );
    expect(delivery).toMatchObject({ isStocked: false, reorderLevel: 0 });
  });

  it('refuse deux variantes identiques et une référence ou un code-barres déjà pris', () => {
    const manager = h.as('manager');
    const phones = h.family('Téléphonie');
    expect(() =>
      h.products.create(manager, {
        ...phoneInput(phones),
        variants: [variant({ color: 'Noir' }), variant({ color: 'noir' })],
      }),
    ).toThrow(/même couleur/);
    h.products.create(
      manager,
      productInput(phones, { variants: [variant({ sku: 'CAB-1', barcode: '123456' })] }),
    );
    expect(() =>
      h.products.create(manager, productInput(phones, { variants: [variant({ sku: 'cab-1' })] })),
    ).toThrow(/CAB-1|cab-1/);
    expect(() =>
      h.products.create(
        manager,
        productInput(phones, { variants: [variant({ barcode: '123456' })] }),
      ),
    ).toThrow(/123456/);
  });

  it('exige price.edit pour changer un prix et journalise l’ancien et le nouveau', () => {
    const manager = h.as('manager');
    const phone = h.products.create(manager, phoneInput(h.family('Téléphonie')));
    const first = phone.variants[0];
    if (first === undefined) throw new Error('variante absente');
    const updated = h.products.saveVariant(manager, {
      productId: phone.id,
      id: first.id,
      sku: first.sku,
      barcode: null,
      color: 'Noir',
      storageGb: 128,
      ramGb: 6,
      condition: 'new',
      salePrice: 115_000,
      minSalePrice: 100_000,
      isActive: true,
    });
    expect(updated.variants[0]).toMatchObject({ salePrice: 115_000, costPrice: 95_000 });
    const details = h.test.db
      .prepare("SELECT details FROM audit_log WHERE action = 'variant.updated'")
      .pluck()
      .get() as string;
    expect(JSON.parse(details)).toMatchObject({
      salePrice: [120_000, 115_000],
      minSalePrice: [110_000, 100_000],
    });
  });

  it('refuse un prix d’achat envoyé sans la permission cost.view', () => {
    const phone = h.products.create(h.as('manager'), phoneInput(h.family('Téléphonie')));
    // Session sans cost.view : le service refuse le champ au lieu de l'ignorer.
    const manager = h.as('manager');
    const limited = {
      ...manager,
      permissions: new Set([...manager.permissions].filter((p) => p !== 'cost.view')),
    };
    expect(() =>
      h.products.saveVariant(limited, {
        productId: phone.id,
        ...variant({ color: 'Vert', costPrice: 1 }),
      }),
    ).toThrow(/droit/);
  });

  it('valide les caractéristiques : type, liste de choix et champs obligatoires', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const power = h.references.saveAttribute(admin, {
      categoryId: solar,
      code: 'puissance',
      label: 'Puissance',
      valueType: 'number',
      unit: 'Wc',
      choices: null,
      isRequired: true,
      isFilterable: true,
      sortOrder: 0,
      isActive: true,
    });
    const base = productInput(solar, { name: 'Panneau', productType: 'solar' });
    expect(() => h.products.create(admin, base)).toThrow(/Puissance/);
    expect(() =>
      h.products.create(admin, {
        ...base,
        attributes: [{ attributeId: power.id, value: 'beaucoup' }],
      }),
    ).toThrow(/nombre/);
    const panel = h.products.create(admin, {
      ...base,
      attributes: [{ attributeId: power.id, value: 400 }],
    });
    expect(panel.attributes).toEqual([{ attributeId: power.id, value: 400 }]);
    // Un attribut d'une autre famille est refusé.
    const tv = h.references.saveAttribute(admin, {
      categoryId: h.family('Électronique et audio'),
      code: 'taille',
      label: 'Taille',
      valueType: 'number',
      unit: 'pouces',
      choices: null,
      isRequired: false,
      isFilterable: true,
      sortOrder: 0,
      isActive: true,
    });
    expect(() =>
      h.products.update(admin, {
        id: panel.id,
        ...base,
        attributes: [
          { attributeId: power.id, value: 400 },
          { attributeId: tv.id, value: 55 },
        ],
      }),
    ).toThrow(/catégorie/);
  });

  it('archive et restaure un produit sans le supprimer', () => {
    const manager = h.as('manager');
    const cable = h.products.create(manager, productInput(h.family('Téléphonie')));
    h.products.setActive(manager, cable.id, false);
    expect(h.products.search(manager, ALL).total).toBe(0);
    expect(h.products.search(manager, { ...ALL, status: 'archived' }).total).toBe(1);
    expect(h.products.setActive(manager, cable.id, true).isActive).toBe(true);
  });

  it('fige le type d’un produit dès son premier mouvement de stock', () => {
    const manager = h.as('manager');
    const cable = h.products.create(manager, productInput(h.family('Téléphonie')));
    const variantId = cable.variants[0]?.id ?? 0;
    move(h.test.db, { variantId, delta: 5, userId: manager.userId });
    const detail = h.products.detail(manager, cable.id);
    expect(detail).toMatchObject({ typeLocked: true });
    expect(detail.variants[0]).toMatchObject({ stockTotal: 5 });
    expect(() =>
      h.products.update(manager, {
        id: cable.id,
        ...productInput(detail.categoryId),
        productType: 'electronics',
        trackingMode: 'serial',
      }),
    ).toThrow(/ne changent plus/);
  });
});

describe('kits', () => {
  function kitWithComponents() {
    const manager = h.as('manager');
    const solar = h.family('Énergie solaire');
    const panel = h.products.create(
      manager,
      productInput(solar, {
        name: 'Panneau 400 Wc',
        productType: 'solar',
        variants: [variant({ salePrice: 90_000 })],
      }),
    );
    const battery = h.products.create(
      manager,
      productInput(solar, {
        name: 'Batterie 200 Ah',
        productType: 'solar',
        variants: [variant({ salePrice: 150_000 })],
      }),
    );
    const kit = h.products.create(
      manager,
      productInput(solar, {
        name: 'Kit solaire 1 kW',
        productType: 'kit',
        variants: [variant({ salePrice: 300_000 })],
      }),
    );
    const kitVariant = kit.variants[0]?.id ?? 0;
    const components = [
      { variantId: panel.variants[0]?.id ?? 0, quantity: 2 },
      { variantId: battery.variants[0]?.id ?? 0, quantity: 1 },
    ];
    return { manager, kit, kitVariant, components, panel };
  }

  it('compose un kit, modifie les quantités et retire un composant', () => {
    const { manager, kitVariant, components } = kitWithComponents();
    const composed = h.products.setKitComponents(manager, kitVariant, components);
    expect(composed.variants[0]?.components.map((c) => [c.productName, c.quantity])).toEqual([
      ['Panneau 400 Wc', 2],
      ['Batterie 200 Ah', 1],
    ]);
    const changed = h.products.setKitComponents(manager, kitVariant, [
      { variantId: components[0]?.variantId ?? 0, quantity: 4 },
    ]);
    expect(changed.variants[0]?.components.map((c) => c.quantity)).toEqual([4]);
  });

  it('refuse un kit dans un kit, un composant en double et un parent qui n’est pas un kit', () => {
    const { manager, kit, kitVariant, components, panel } = kitWithComponents();
    const other = h.products.create(
      manager,
      productInput(h.family('Énergie solaire'), { name: 'Kit 2', productType: 'kit' }),
    );
    expect(() =>
      h.products.setKitComponents(manager, other.variants[0]?.id ?? 0, [
        { variantId: kitVariant, quantity: 1 },
      ]),
    ).toThrow(/autre kit/);
    expect(() =>
      h.products.setKitComponents(
        manager,
        kitVariant,
        [components[0], components[0]].filter((c) => c !== undefined),
      ),
    ).toThrow(/deux fois/);
    expect(() =>
      h.products.setKitComponents(manager, panel.variants[0]?.id ?? 0, components),
    ).toThrow(/kit/);
    expect(kit.isStocked).toBe(false);
  });

  it('interdit de transformer un composant en kit, ou un kit composé en autre chose', () => {
    const { manager, kit, kitVariant, components, panel } = kitWithComponents();
    h.products.setKitComponents(manager, kitVariant, components);
    const asInput = (detail: typeof kit, productType: 'kit' | 'solar') => ({
      ...productInput(detail.categoryId, { name: detail.name }),
      id: detail.id,
      productType,
    });
    expect(() => h.products.update(manager, asInput(kit, 'solar'))).toThrow(/composants du kit/);
    expect(() => h.products.update(manager, asInput(panel, 'kit'))).toThrow(/composant de kit/);
  });
});

describe('recherche', () => {
  function seedCatalog() {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const panels = h.references.saveCategory(admin, {
      name: 'Panneaux',
      parentId: solar,
      defaultTrackingMode: 'serial',
      defaultWarrantyMonths: 120,
      sortOrder: 0,
      isActive: true,
    });
    const power = h.references.saveAttribute(admin, {
      categoryId: solar,
      code: 'puissance',
      label: 'Puissance',
      valueType: 'number',
      unit: 'Wc',
      choices: null,
      isRequired: false,
      isFilterable: true,
      sortOrder: 0,
      isActive: true,
    });
    const brand = h.references.saveBrand(admin, { name: 'Jinko', isActive: true });
    for (const watts of [200, 400, 550]) {
      h.products.create(
        admin,
        productInput(panels.id, {
          name: `Panneau monocristallin ${String(watts)} Wc`,
          productType: 'solar',
          trackingMode: 'serial',
          brandId: brand.id,
          reorderLevel: 2,
          attributes: [{ attributeId: power.id, value: watts }],
          variants: [variant({ salePrice: watts * 250, barcode: `PAN${String(watts)}` })],
        }),
      );
    }
    h.products.create(admin, phoneInput(h.family('Téléphonie')));
    return { admin, solar, panels, power, brand };
  }

  it('trouve par mots partiels, sans accents ni casse', () => {
    const { admin } = seedCatalog();
    const names = (query: string) =>
      h.products.search(admin, { ...ALL, query }).rows.map((r) => r.name);
    expect(names('mono 400')).toEqual(['Panneau monocristallin 400 Wc']);
    expect(names('GALAX')).toHaveLength(2);
    expect(names('jinko')).toHaveLength(3);
    expect(names('"; DROP TABLE products; --')).toEqual([]);
  });

  it('met en tête l’article dont le code-barres correspond exactement', () => {
    const { admin } = seedCatalog();
    const rows = h.products.search(admin, { ...ALL, query: 'PAN550', sort: 'price_asc' }).rows;
    expect(rows[0]?.barcode).toBe('PAN550');
  });

  it('filtre par famille (avec sa descendance), marque et caractéristique', () => {
    const { admin, solar, power, brand } = seedCatalog();
    expect(h.products.search(admin, { ...ALL, categoryId: solar }).total).toBe(3);
    expect(h.products.search(admin, { ...ALL, brandId: brand.id }).total).toBe(3);
    const strong = h.products.search(admin, {
      ...ALL,
      attributeFilters: [{ attributeId: power.id, min: 400 }],
    });
    expect(strong.rows.map((r) => r.name)).toEqual([
      'Panneau monocristallin 400 Wc',
      'Panneau monocristallin 550 Wc',
    ]);
    expect(strong.rows[0]).toMatchObject({
      familyName: 'Énergie solaire',
      categoryName: 'Panneaux',
    });
  });

  it('liste les articles sous le seuil d’alerte et pagine les résultats', () => {
    const { admin } = seedCatalog();
    expect(h.products.search(admin, { ...ALL, lowStock: true }).total).toBe(3);
    const page = h.products.search(admin, { ...ALL, limit: 2, offset: 2, sort: 'price_desc' });
    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);
  });
});

describe('recherche par numéro de série', () => {
  it('retrouve une unité par IMEI 1 ou 2, sans la vente pour qui n’a pas sale.view', () => {
    const manager = h.as('manager');
    const phone = h.products.create(manager, phoneInput(h.family('Téléphonie')));
    h.test.db
      .prepare(
        "INSERT INTO serial_units (variant_id, serial_number, imei2, warranty_end) VALUES (?, '490154203237518', '356938035643809', '2027-11-11')",
      )
      .run(phone.variants[0]?.id);
    const [unit] = h.products.findSerial(manager, '35693 8035643809');
    expect(unit).toMatchObject({
      serialNumber: '490154203237518',
      status: 'in_stock',
      productName: 'Galaxy A15',
    });
    expect(h.products.findSerial(manager, '000')).toEqual([]);
    const detail = h.products.detail(manager, phone.id);
    expect(detail.serialUnits.counts.in_stock).toBe(1);
    expect(detail.typeLocked).toBe(true);
  });
});
