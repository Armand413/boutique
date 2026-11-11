import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralizeFormula, parseCatalogRows } from '../../../src/main/catalog/catalog-io';
import { createCatalogHarness, productInput, variant, type CatalogHarness } from './harness';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let h: CatalogHarness;

beforeEach(() => {
  h = createCatalogHarness();
});

afterEach(() => {
  h.cleanup();
});

const HEADER = [
  'Nom',
  'Marque',
  'Catégorie',
  'Type',
  'Référence',
  'Couleur',
  'Stockage (Go)',
  'Prix de vente',
  'Prix d’achat',
];

function context(canCreateBrands = true) {
  const references = h.references.references(h.as('admin'));
  return { ...references, canCreateBrands, canSetCost: true };
}

async function writeWorkbook(name: string, rows: (string | number)[][]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Produits');
  for (const row of rows) sheet.addRow(row);
  const path = join(h.test.directory, name);
  await workbook.xlsx.writeFile(path);
  return path;
}

describe('analyse d’un fichier de catalogue', () => {
  it('regroupe en variantes les lignes du même produit', () => {
    const result = parseCatalogRows(
      [
        HEADER,
        [
          'Redmi 13',
          'Xiaomi',
          'Téléphonie',
          'Téléphone',
          'RN13-N',
          'Noir',
          '128',
          '95 000',
          '80000',
        ],
        ['Redmi 13', 'xiaomi', 'téléphonie', 'telephone', 'RN13-B', 'Bleu', '256', '105000', ''],
        ['Câble USB-C', '', 'Telephonie', 'Accessoire', '', '', '', '2500', ''],
      ],
      context(),
    );
    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(2);
    const [redmi] = result.products;
    expect(redmi?.newBrandName).toBe('Xiaomi');
    expect(redmi?.input).toMatchObject({
      productType: 'phone',
      trackingMode: 'imei',
      warrantyMonths: 12,
    });
    expect(
      redmi?.input.variants.map((v) => [v.sku, v.storageGb, v.salePrice, v.costPrice]),
    ).toEqual([
      ['RN13-N', 128, 95_000, 80_000],
      ['RN13-B', 256, 105_000, undefined],
    ]);
  });

  it('liste toutes les erreurs avec leur numéro de ligne', () => {
    const result = parseCatalogRows(
      [
        HEADER,
        ['', '', 'Téléphonie', 'Accessoire', '', '', '', '100', ''],
        ['Télé 55"', '', 'Inconnue', 'Électronique', '', '', '', '100', ''],
        ['Ampli', '', 'Électronique et audio', 'Fusée', '', '', '', '100', ''],
        ['Frigo', '', 'Électroménager', 'Électroménager', '', '', '', 'cher', ''],
        ['Frigo 2', 'Haier', 'Électroménager', 'Électroménager', '', '', '-1', '100', ''],
      ],
      context(false),
    );
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(result.errors[1]?.message).toMatch(/Inconnue/);
    expect(result.errors[4]?.message).toMatch(/Haier|Stockage/);
  });

  it('signale les colonnes obligatoires absentes', () => {
    const result = parseCatalogRows([['Nom', 'Marque']], context());
    expect(result.errors[0]?.message).toMatch(/Catégorie, Type, Prix de vente/);
  });

  it('neutralise les formules dans les cellules exportées en CSV', () => {
    expect(neutralizeFormula('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(neutralizeFormula('Câble')).toBe('Câble');
  });
});

describe('import et export du catalogue', () => {
  it('analyse puis importe un classeur, tout ou rien, avec audit', async () => {
    const admin = h.as('admin');
    h.dialogs.open = await writeWorkbook('import.xlsx', [
      HEADER,
      ['Redmi 13', 'Xiaomi', 'Téléphonie', 'Téléphone', 'RN13-N', 'Noir', 128, 95000, 80000],
      ['Redmi 13', 'Xiaomi', 'Téléphonie', 'Téléphone', 'RN13-B', 'Bleu', 128, 95000, 80000],
    ]);
    const analysis = await h.files.analyzeImport(admin);
    expect(analysis).toMatchObject({
      fileName: 'import.xlsx',
      productCount: 1,
      variantCount: 2,
      errors: [],
    });
    expect(
      h.products.search(admin, { status: 'all', sort: 'name', offset: 0, limit: 10 }).total,
    ).toBe(0);
    expect(h.files.commitImport(admin, analysis.token ?? '')).toEqual({ products: 1, variants: 2 });
    expect(() => h.files.commitImport(admin, analysis.token ?? '')).toThrow(/expiré/);
    const rows = h.products.search(admin, {
      status: 'active',
      sort: 'name',
      offset: 0,
      limit: 10,
    }).rows;
    expect(rows.map((r) => [r.sku, r.brandName, r.costPrice])).toEqual([
      ['RN13-N', 'Xiaomi', 80_000],
      ['RN13-B', 'Xiaomi', 80_000],
    ]);
    expect(
      h.test.db
        .prepare("SELECT count(*) FROM audit_log WHERE action = 'catalog.imported'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('refuse tout le fichier si une référence existe déjà', async () => {
    const admin = h.as('admin');
    h.products.create(
      admin,
      productInput(h.family('Téléphonie'), { variants: [variant({ sku: 'RN13-B' })] }),
    );
    h.dialogs.open = await writeWorkbook('doublon.xlsx', [
      HEADER,
      ['Redmi 13', '', 'Téléphonie', 'Téléphone', 'RN13-N', 'Noir', 128, 95000, ''],
      ['Redmi 14', '', 'Téléphonie', 'Téléphone', 'RN13-B', 'Bleu', 128, 95000, ''],
    ]);
    const analysis = await h.files.analyzeImport(admin);
    expect(analysis.token).toBeNull();
    expect(analysis.errors.map((issue) => issue.row)).toEqual([3]);
    expect(analysis.errors[0]?.message).toMatch(/RN13-B/);
    expect(
      h.products.search(admin, { status: 'all', sort: 'name', offset: 0, limit: 10 }).total,
    ).toBe(1);
  });

  it('lit un CSV au point-virgule sans perdre les zéros d’un code-barres', async () => {
    const admin = h.as('admin');
    const path = join(h.test.directory, 'import.csv');
    writeFileSync(
      path,
      '﻿Nom;Catégorie;Type;Code-barres;Prix de vente\nCoque;Téléphonie;Accessoire;0012345;1 500\n',
    );
    h.dialogs.open = path;
    const analysis = await h.files.analyzeImport(admin);
    expect(analysis.errors).toEqual([]);
    h.files.commitImport(admin, analysis.token ?? '');
    const [row] = h.products.search(admin, {
      status: 'active',
      sort: 'name',
      offset: 0,
      limit: 10,
    }).rows;
    expect(row).toMatchObject({ barcode: '0012345', salePrice: 1500 });
  });

  it('exporte sans prix d’achat pour qui n’a pas cost.view, et se réimporte à l’identique', async () => {
    const admin = h.as('admin');
    const created = h.products.create(
      admin,
      productInput(h.family('Téléphonie'), {
        variants: [variant({ sku: 'CAB-1', costPrice: 900, salePrice: 2500 })],
      }),
    );
    const path = join(h.test.directory, 'export.xlsx');
    h.dialogs.save = path;
    expect(await h.files.exportCatalog(admin, 'xlsx')).toEqual({ saved: true, rows: 1 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const header = workbook.worksheets[0]?.getRow(1).values as unknown[];
    expect(header).toContain('Prix d’achat');

    const limited = {
      ...admin,
      permissions: new Set([...admin.permissions].filter((p) => p !== 'cost.view')),
    };
    const csv = join(h.test.directory, 'export.csv');
    h.dialogs.save = csv;
    await h.files.exportCatalog(limited, 'csv');
    const text = readFileSync(csv, 'utf8');
    expect(text).not.toContain('Prix d’achat');
    expect(text).not.toContain('900');

    h.products.setActive(admin, created.id, false);
    h.test.db.prepare("UPDATE product_variants SET sku = 'ANCIEN-1'").run();
    h.dialogs.open = path;
    const analysis = await h.files.analyzeImport(admin);
    expect(analysis.errors).toEqual([]);
    h.files.commitImport(admin, analysis.token ?? '');
    const [row] = h.products.search(admin, {
      status: 'active',
      sort: 'name',
      offset: 0,
      limit: 10,
    }).rows;
    expect(row).toMatchObject({ sku: 'CAB-1', salePrice: 2500, costPrice: 900 });
  });

  it('refuse l’export sans la permission export.run', async () => {
    await expect(h.files.exportCatalog(h.as('seller'), 'xlsx')).rejects.toThrow(/droit/);
  });
});

describe('étiquettes et photo', () => {
  it('génère un PDF d’étiquettes, une par unité suivie', async () => {
    const admin = h.as('admin');
    const tv = h.products.create(
      admin,
      productInput(h.family('Électronique et audio'), {
        name: 'Téléviseur 55 pouces',
        productType: 'electronics',
        trackingMode: 'serial',
        variants: [variant({ salePrice: 350_000 })],
      }),
    );
    const variantId = tv.variants[0]?.id ?? 0;
    const unit = Number(
      h.test.db
        .prepare("INSERT INTO serial_units (variant_id, serial_number) VALUES (?, 'SN-TV-0001')")
        .run(variantId).lastInsertRowid,
    );
    const path = join(h.test.directory, 'etiquettes.pdf');
    h.dialogs.save = path;
    for (const layout of ['a4', 'roll'] as const) {
      const result = await h.files.labels(admin, {
        layout,
        showPrice: true,
        items: [
          { variantId, copies: 2 },
          { variantId, copies: 1, serialUnitIds: [unit] },
        ],
      });
      expect(result).toEqual({ saved: true });
      expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await expect(
      h.files.labels(admin, {
        layout: 'a4',
        showPrice: false,
        items: [{ variantId, copies: 1, serialUnitIds: [unit + 99] }],
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it('accepte une photo PNG, refuse un faux fichier image et la retire', async () => {
    const admin = h.as('admin');
    const product = h.products.create(admin, productInput(h.family('Téléphonie')));
    const fake = join(h.test.directory, 'photo.png');
    writeFileSync(fake, 'pas une image');
    h.dialogs.open = fake;
    await expect(h.files.chooseImage(admin, product.id)).rejects.toThrow(/Format/);
    const png = join(h.test.directory, 'vraie.png');
    writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    h.dialogs.open = png;
    expect(await h.files.chooseImage(admin, product.id)).toEqual({ hasImage: true });
    expect(h.files.image(h.as('seller'), product.id).dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(h.files.clearImage(admin, product.id)).toEqual({ hasImage: false });
    expect(h.files.image(admin, product.id).dataUrl).toBeNull();
  });
});
