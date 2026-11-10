import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openDatabase } from '../../../src/main/db/connection';
import { bundledMigrations, migrate } from '../../../src/main/db/migrations';
import { seedSystem } from '../../../src/main/db/seed';
import type { Db } from '../../../src/main/db/types';

export interface TestDatabase {
  db: Db;
  file: string;
  key: Buffer;
  directory: string;
  reopen: () => Db;
  cleanup: () => void;
}

/** Base chiffrée réelle dans un dossier temporaire, migrée et initialisée. */
export function createTestDatabase(options: { migrateAndSeed?: boolean } = {}): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'boutique-db-'));
  const file = join(directory, 'boutique.db');
  const key = randomBytes(32);
  const db = openDatabase(file, key);
  if (options.migrateAndSeed !== false) {
    migrate(db, bundledMigrations());
    seedSystem(db);
  }
  const state: TestDatabase = {
    db,
    file,
    key,
    directory,
    reopen: () => {
      closeDatabase(state.db);
      state.db = openDatabase(file, key);
      return state.db;
    },
    cleanup: () => {
      if (state.db.open) state.db.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  return state;
}

const FAKE_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2VsLWRlLXRlc3Q$aGFzaC1kZS10ZXN0LXBhcy11bi12cmFpLWhhY2hhZ2U';

export function insertUser(
  db: Db,
  username = 'admin',
  role: 'admin' | 'manager' | 'seller' = 'admin',
): number {
  const result = db
    .prepare(
      `INSERT INTO users (username, full_name, password_hash, role_id)
       VALUES (?, ?, ?, (SELECT id FROM roles WHERE code = ?))`,
    )
    .run(username, `Utilisateur ${username}`, FAKE_HASH, role);
  return Number(result.lastInsertRowid);
}

type ProductType =
  'phone' | 'accessory' | 'electronics' | 'appliance' | 'solar' | 'part' | 'service' | 'kit';

export interface ProductOptions {
  type?: ProductType;
  tracking?: 'none' | 'serial' | 'imei';
  categoryId?: number;
  name?: string;
}

let skuCounter = 0;

/** Crée un produit et sa variante unique ; renvoie l'id de la variante. */
export function insertVariant(
  db: Db,
  options: ProductOptions = {},
): { productId: number; variantId: number } {
  const type = options.type ?? 'accessory';
  const tracking = options.tracking ?? (type === 'phone' ? 'imei' : 'none');
  const isStocked = type === 'service' || type === 'kit' ? 0 : 1;
  const categoryId = options.categoryId ?? defaultCategory(db);
  const product = db
    .prepare(
      `INSERT INTO products (name, category_id, product_type, tracking_mode, is_stocked)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(options.name ?? `Produit ${type}`, categoryId, type, tracking, isStocked);
  const productId = Number(product.lastInsertRowid);
  skuCounter += 1;
  const variant = db
    .prepare(
      'INSERT INTO product_variants (product_id, sku, sale_price, cost_price) VALUES (?, ?, 10000, 6000)',
    )
    .run(productId, `SKU-${skuCounter}`);
  return { productId, variantId: Number(variant.lastInsertRowid) };
}

export function defaultCategory(db: Db): number {
  return db.prepare('SELECT id FROM categories ORDER BY id LIMIT 1').pluck().get() as number;
}

export function defaultLocation(db: Db): number {
  return db.prepare('SELECT id FROM stock_locations WHERE is_default = 1').pluck().get() as number;
}

export function stockOf(db: Db, variantId: number, locationId = defaultLocation(db)): number {
  return (
    (db
      .prepare('SELECT quantity FROM stock_levels WHERE variant_id = ? AND location_id = ?')
      .pluck()
      .get(variantId, locationId) as number | undefined) ?? 0
  );
}

/** Mouvement de stock conforme (quantité après calculée comme le fera le service de stock). */
export function move(
  db: Db,
  input: {
    variantId: number;
    delta: number;
    userId: number;
    type?: string;
    serialUnitId?: number;
    reason?: string;
    locationId?: number;
  },
): void {
  const locationId = input.locationId ?? defaultLocation(db);
  const type = input.type ?? (input.delta > 0 ? 'purchase' : 'sale');
  db.prepare(
    `INSERT INTO stock_movements
       (variant_id, location_id, serial_unit_id, movement_type, quantity_delta, quantity_after, reason, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.variantId,
    locationId,
    input.serialUnitId ?? null,
    type,
    input.delta,
    stockOf(db, input.variantId, locationId) + input.delta,
    input.reason ?? null,
    input.userId,
  );
}

/** IMEI valides (clé de Luhn) pour les tests. */
export const VALID_IMEIS = [
  '490154203237518',
  '356938035643809',
  '352099001761481',
  '013440001737488',
];

export function insertSerial(
  db: Db,
  variantId: number,
  serial: string,
  imei2: string | null = null,
): number {
  return Number(
    db
      .prepare('INSERT INTO serial_units (variant_id, serial_number, imei2) VALUES (?, ?, ?)')
      .run(variantId, serial, imei2).lastInsertRowid,
  );
}

export function openCashSession(db: Db, userId: number): number {
  return Number(
    db.prepare('INSERT INTO cash_sessions (opened_by, opening_float) VALUES (?, 0)').run(userId)
      .lastInsertRowid,
  );
}

export function heldSale(db: Db, userId: number, cashSessionId: number): number {
  return Number(
    db
      .prepare('INSERT INTO sales (user_id, cash_session_id) VALUES (?, ?)')
      .run(userId, cashSessionId).lastInsertRowid,
  );
}

export function addSaleLine(
  db: Db,
  input: {
    saleId: number;
    variantId: number;
    quantity?: number;
    unitPrice?: number;
    serialUnitId?: number;
  },
): number {
  const quantity = input.quantity ?? 1;
  const unitPrice = input.unitPrice ?? 10000;
  return Number(
    db
      .prepare(
        `INSERT INTO sale_lines (sale_id, variant_id, serial_unit_id, quantity, unit_price, unit_cost, line_total)
         VALUES (?, ?, ?, ?, ?, 6000, ?)`,
      )
      .run(
        input.saleId,
        input.variantId,
        input.serialUnitId ?? null,
        quantity,
        unitPrice,
        quantity * unitPrice,
      ).lastInsertRowid,
  );
}

/** Termine une vente payée comptant : totaux, paiement, numéro de facture. */
export function completeSale(db: Db, saleId: number, userId: number, cashSessionId: number): void {
  const subtotal = db
    .prepare(
      "SELECT sum(quantity * unit_price) FROM sale_lines WHERE sale_id = ? AND line_type <> 'kit_component'",
    )
    .pluck()
    .get(saleId) as number;
  db.prepare('UPDATE sales SET subtotal = ?, total = ? WHERE id = ?').run(
    subtotal,
    subtotal,
    saleId,
  );
  db.prepare(
    "INSERT INTO payments (sale_id, method, amount, cash_session_id, user_id) VALUES (?, 'cash', ?, ?, ?)",
  ).run(saleId, subtotal, cashSessionId, userId);
  db.prepare(
    `UPDATE sales SET status = 'completed', amount_paid = ?, invoice_number = ?,
       completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(subtotal, `F-${saleId}`, saleId);
}
