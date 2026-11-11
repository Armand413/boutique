import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../../src/main/auth/session';
import { createCatalogHarness, type CatalogHarness } from './harness';

const PRODUCTS = 50_000;
let h: CatalogHarness;
let seller: Session;

/** Catalogue de charge inséré directement (les triggers FTS tournent comme en production). */
beforeAll(() => {
  h = createCatalogHarness();
  seller = h.as('seller');
  const { db } = h.test;
  const categories = db.prepare('SELECT id FROM categories').pluck().all() as number[];
  const brands = [
    'Samsung',
    'Tecno',
    'Infinix',
    'Itel',
    'Xiaomi',
    'Hisense',
    'LG',
    'Jinko',
    'Victron',
    'Haier',
  ];
  db.transaction(() => {
    const brandIds = brands.map((name) =>
      Number(db.prepare('INSERT INTO brands (name) VALUES (?)').run(name).lastInsertRowid),
    );
    const product = db.prepare(
      "INSERT INTO products (name, brand_id, category_id, product_type, model) VALUES (?, ?, ?, 'accessory', ?)",
    );
    const variant = db.prepare(
      'INSERT INTO product_variants (product_id, sku, barcode, sale_price) VALUES (?, ?, ?, ?)',
    );
    for (let index = 0; index < PRODUCTS; index += 1) {
      const id = Number(
        product.run(
          `Article ${['chargeur', 'coque', 'écouteurs', 'câble', 'batterie'][index % 5] ?? ''} ${String(index)}`,
          brandIds[index % brandIds.length],
          categories[index % categories.length],
          `M${String(index % 997)}`,
        ).lastInsertRowid,
      );
      variant.run(
        id,
        `SKU-${String(index)}`,
        `200${String(index).padStart(10, '0')}`,
        1000 + (index % 500) * 100,
      );
    }
  })();
}, 120_000);

afterAll(() => {
  h.cleanup();
});

function timed(run: () => unknown): number {
  run();
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe(`recherche sur ${String(PRODUCTS)} produits (5.1 : moins de 100 ms)`, () => {
  const base = { status: 'active' as const, sort: 'name' as const, offset: 0, limit: 50 };

  it.each([
    ['mot partiel', { query: 'ecout' }],
    ['marque et mot', { query: 'samsung coque' }],
    ['code-barres exact', { query: '2000000012345' }],
    ['première page sans filtre', {}],
    ['tri par prix', { sort: 'price_desc' as const }],
  ])('%s', (_label, extra) => {
    const elapsed = timed(() => h.products.search(seller, { ...base, ...extra }));
    expect(elapsed).toBeLessThan(100);
  });

  it('place le code-barres scanné en premier', () => {
    const [first] = h.products.search(seller, { ...base, query: '2000000012345' }).rows;
    expect(first?.sku).toBe('SKU-12345');
  });
});
