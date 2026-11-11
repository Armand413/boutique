import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveAttributes } from '../../../src/shared/catalog/tree';
import type { SaveAttributeInput, SaveCategoryInput } from '../../../src/shared/schemas/catalog';
import { createCatalogHarness, productInput, type CatalogHarness } from './harness';

let h: CatalogHarness;

beforeEach(() => {
  h = createCatalogHarness();
});

afterEach(() => {
  h.cleanup();
});

function category(parentId: number | null, name: string): SaveCategoryInput {
  return {
    name,
    parentId,
    defaultTrackingMode: 'serial',
    defaultWarrantyMonths: 24,
    sortOrder: 0,
    isActive: true,
  };
}

function attribute(
  categoryId: number,
  code: string,
  overrides: Partial<SaveAttributeInput> = {},
): SaveAttributeInput {
  return {
    categoryId,
    code,
    label: code,
    valueType: 'number',
    unit: null,
    choices: null,
    isRequired: false,
    isFilterable: true,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

describe('référentiels du catalogue', () => {
  it('expose les quatre familles du seed avec leur profondeur', () => {
    const { categories, taxRates, locations } = h.references.references(h.as('seller'));
    const families = categories.filter((c) => c.depth === 0).map((c) => c.name);
    expect(families).toEqual([
      'Téléphonie',
      'Électronique et audio',
      'Électroménager',
      'Énergie solaire',
    ]);
    expect(taxRates.map((t) => t.rate)).toEqual([0, 1800]);
    expect(locations).toEqual([expect.objectContaining({ name: 'Magasin', isDefault: true })]);
  });

  it('réserve la modification des référentiels à l’administrateur', () => {
    expect(() =>
      h.references.saveBrand(h.as('manager'), { name: 'Tecno', isActive: true }),
    ).toThrow(/droit/);
    expect(() => h.references.saveBrand(h.as('seller'), { name: 'Tecno', isActive: true })).toThrow(
      /droit/,
    );
    const brand = h.references.saveBrand(h.as('admin'), { name: 'Tecno', isActive: true });
    expect(brand).toMatchObject({ name: 'Tecno', isActive: true, productCount: 0 });
  });

  it('refuse deux marques du même nom, sans tenir compte de la casse', () => {
    const admin = h.as('admin');
    h.references.saveBrand(admin, { name: 'Samsung', isActive: true });
    expect(() => h.references.saveBrand(admin, { name: 'SAMSUNG', isActive: true })).toThrow(
      /déjà/,
    );
  });

  it('journalise la création et la modification d’une marque', () => {
    const admin = h.as('admin');
    const brand = h.references.saveBrand(admin, { name: 'Itel', isActive: true });
    h.references.saveBrand(admin, { id: brand.id, name: 'itel', isActive: false });
    const actions = h.test.db
      .prepare("SELECT action FROM audit_log WHERE entity_type = 'brand' ORDER BY id")
      .pluck()
      .all();
    expect(actions).toEqual(['catalog.brand_created', 'catalog.brand_updated']);
  });

  it('crée des sous-catégories sur trois niveaux au maximum', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const panels = h.references.saveCategory(admin, category(solar, 'Panneaux'));
    const mono = h.references.saveCategory(admin, category(panels.id, 'Monocristallins'));
    expect(panels).toMatchObject({ depth: 1, familyId: solar });
    expect(mono).toMatchObject({ depth: 2, familyId: solar });
    expect(() => h.references.saveCategory(admin, category(mono.id, 'Trop profond'))).toThrow(
      /trois niveaux/,
    );
  });

  it('refuse de déplacer une catégorie qui contient des produits', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const panels = h.references.saveCategory(admin, category(solar, 'Panneaux'));
    h.products.create(
      admin,
      productInput(panels.id, { name: 'Panneau 400 Wc', productType: 'solar' }),
    );
    expect(() =>
      h.references.saveCategory(admin, {
        ...category(h.family('Électroménager'), 'Panneaux'),
        id: panels.id,
      }),
    ).toThrow(/contient des produits/);
  });

  it('refuse de ranger une catégorie sous sa propre descendante', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const panels = h.references.saveCategory(admin, category(solar, 'Panneaux'));
    expect(() =>
      h.references.saveCategory(admin, { ...category(panels.id, 'Énergie solaire'), id: solar }),
    ).toThrow();
  });

  it('fait hériter les attributs d’une famille à ses sous-catégories', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const batteries = h.references.saveCategory(admin, category(solar, 'Batteries'));
    h.references.saveAttribute(admin, attribute(solar, 'tension', { unit: 'V' }));
    h.references.saveAttribute(admin, attribute(batteries.id, 'capacite', { unit: 'Ah' }));
    const { categories, attributes } = h.references.references(admin);
    expect(effectiveAttributes(categories, attributes, batteries.id).map((a) => a.code)).toEqual([
      'tension',
      'capacite',
    ]);
    expect(effectiveAttributes(categories, attributes, solar).map((a) => a.code)).toEqual([
      'tension',
    ]);
  });

  it('refuse un code d’attribut déjà utilisé dans la lignée', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const batteries = h.references.saveCategory(admin, category(solar, 'Batteries'));
    h.references.saveAttribute(admin, attribute(solar, 'tension'));
    expect(() => h.references.saveAttribute(admin, attribute(batteries.id, 'tension'))).toThrow(
      /déjà utilisé/,
    );
    // Une autre famille peut réutiliser le code.
    expect(() =>
      h.references.saveAttribute(admin, attribute(h.family('Électroménager'), 'tension')),
    ).not.toThrow();
  });

  it('exige une liste pour un attribut à choix et protège les choix déjà utilisés', () => {
    const admin = h.as('admin');
    const solar = h.family('Énergie solaire');
    const type = h.references.saveAttribute(
      admin,
      attribute(solar, 'type_regulateur', { valueType: 'choice', choices: ['PWM', 'MPPT'] }),
    );
    h.products.create(
      admin,
      productInput(solar, {
        name: 'Régulateur 30 A',
        productType: 'solar',
        attributes: [{ attributeId: type.id, value: 'MPPT' }],
      }),
    );
    expect(() =>
      h.references.saveAttribute(admin, {
        ...attribute(solar, 'type_regulateur'),
        id: type.id,
        valueType: 'choice',
        choices: ['PWM'],
      }),
    ).toThrow(/MPPT/);
    expect(() =>
      h.references.saveAttribute(admin, {
        ...attribute(solar, 'type_regulateur'),
        id: type.id,
        valueType: 'number',
        choices: null,
      }),
    ).toThrow(/ne change plus/);
  });
});
