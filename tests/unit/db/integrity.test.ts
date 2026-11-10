import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VALID_IMEIS,
  addSaleLine,
  completeSale,
  createTestDatabase,
  defaultLocation,
  heldSale,
  insertSerial,
  insertUser,
  insertVariant,
  move,
  openCashSession,
  stockOf,
  type TestDatabase,
} from './helpers';
import type { Db } from '../../../src/main/db/types';

let test: TestDatabase;
let db: Db;
let userId: number;

beforeEach(() => {
  test = createTestDatabase();
  db = test.db;
  userId = insertUser(db);
});

afterEach(() => {
  test.cleanup();
});

describe('stock (E.4)', () => {
  it('tient le stock courant à jour depuis les mouvements', () => {
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 10, userId });
    move(db, { variantId, delta: -3, userId });
    expect(stockOf(db, variantId)).toBe(7);
    expect(
      db.prepare('SELECT quantity_after FROM stock_movements ORDER BY id').pluck().all(),
    ).toEqual([10, 7]);
  });

  it('refuse un stock négatif', () => {
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 2, userId });
    expect(() => move(db, { variantId, delta: -3, userId })).toThrow(/STOCK_NEGATIVE/);
    expect(stockOf(db, variantId)).toBe(2);
  });

  it('refuse une quantité après mouvement falsifiée', () => {
    const { variantId } = insertVariant(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO stock_movements (variant_id, location_id, movement_type, quantity_delta, quantity_after, user_id)
           VALUES (?, ?, 'purchase', 5, 50, ?)`,
        )
        .run(variantId, defaultLocation(db), userId),
    ).toThrow(/STOCK_QUANTITY_AFTER/);
  });

  it('interdit toute écriture directe sur le stock courant', () => {
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 4, userId });
    expect(() => db.prepare('UPDATE stock_levels SET quantity = 100').run()).toThrow(
      /STOCK_LEVEL_DIRECT/,
    );
    expect(() => db.prepare('DELETE FROM stock_levels').run()).toThrow(/STOCK_LEVEL_DIRECT/);
    const other = insertVariant(db).variantId;
    expect(() =>
      db
        .prepare('INSERT INTO stock_levels (variant_id, location_id, quantity) VALUES (?, ?, 9)')
        .run(other, defaultLocation(db)),
    ).toThrow(/STOCK_LEVEL_DIRECT/);
  });

  it('rend les mouvements immuables', () => {
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 4, userId });
    expect(() => db.prepare('UPDATE stock_movements SET quantity_delta = 40').run()).toThrow(
      /IMMUTABLE/,
    );
    expect(() => db.prepare('DELETE FROM stock_movements').run()).toThrow(/IMMUTABLE/);
  });

  it('ne crée aucun mouvement pour un service ou un kit', () => {
    for (const type of ['service', 'kit'] as const) {
      const { variantId } = insertVariant(db, { type });
      expect(() => move(db, { variantId, delta: 1, userId })).toThrow(/STOCK_NOT_STOCKED/);
    }
  });

  it('impose le signe et le motif selon le type de mouvement', () => {
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 5, userId });
    expect(() => move(db, { variantId, delta: -1, userId, type: 'purchase' })).toThrow(/CHECK/);
    expect(() => move(db, { variantId, delta: -1, userId, type: 'loss' })).toThrow(/CHECK/);
    move(db, { variantId, delta: -1, userId, type: 'loss', reason: 'Écran cassé' });
    expect(stockOf(db, variantId)).toBe(4);
  });

  it('se reconstruit à l’identique depuis les mouvements, sans aucun écart (E.8)', () => {
    const locations = [defaultLocation(db)];
    locations.push(
      Number(
        db.prepare("INSERT INTO stock_locations (name) VALUES ('Dépôt')").run().lastInsertRowid,
      ),
    );
    const variants = Array.from({ length: 5 }, () => insertVariant(db).variantId);
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    db.transaction(() => {
      for (let i = 0; i < 2000; i += 1) {
        const variantId = variants[Math.floor(random() * variants.length)] ?? 0;
        const locationId = locations[Math.floor(random() * locations.length)] ?? 0;
        const current = stockOf(db, variantId, locationId);
        const delta =
          current > 0 && random() < 0.45 ? -Math.ceil(random() * current) : Math.ceil(random() * 9);
        move(db, { variantId, delta, userId, locationId });
      }
    })();
    expect(db.prepare('SELECT * FROM v_stock_discrepancies').all()).toEqual([]);
  });
});

describe('numéros de série et IMEI (E.4)', () => {
  it('impose le suivi IMEI pour un téléphone', () => {
    expect(() => insertVariant(db, { type: 'phone', tracking: 'none' })).toThrow(/CHECK/);
  });

  it('refuse un IMEI invalide (longueur ou clé de Luhn)', () => {
    const { variantId } = insertVariant(db, { type: 'phone' });
    expect(() => insertSerial(db, variantId, '490154203237517')).toThrow(/IMEI_INVALID/);
    expect(() => insertSerial(db, variantId, '12345')).toThrow(/IMEI_INVALID/);
    expect(() => insertSerial(db, variantId, VALID_IMEIS[0] ?? '', '123')).toThrow(/IMEI_INVALID/);
    insertSerial(db, variantId, VALID_IMEIS[0] ?? '', VALID_IMEIS[1] ?? '');
  });

  it('accepte un numéro de série libre hors mode IMEI', () => {
    const { variantId } = insertVariant(db, { type: 'appliance', tracking: 'serial' });
    insertSerial(db, variantId, 'SN-ABC-2026-01');
    expect(() => insertSerial(db, variantId, 'X', 'Y')).toThrow(/IMEI2_SERIAL_ONLY/);
  });

  it('refuse un numéro sur un produit non suivi', () => {
    const { variantId } = insertVariant(db);
    expect(() => insertSerial(db, variantId, 'SN-1')).toThrow(/SERIAL_NOT_TRACKED/);
  });

  it('refuse un IMEI en double, y compris croisé avec un IMEI 2', () => {
    const { variantId } = insertVariant(db, { type: 'phone' });
    insertSerial(db, variantId, VALID_IMEIS[0] ?? '', VALID_IMEIS[1] ?? '');
    expect(() => insertSerial(db, variantId, VALID_IMEIS[0] ?? '')).toThrow(/UNIQUE/);
    expect(() => insertSerial(db, variantId, VALID_IMEIS[1] ?? '')).toThrow(/SERIAL_DUPLICATE/);
    expect(() => insertSerial(db, variantId, VALID_IMEIS[2] ?? '', VALID_IMEIS[0] ?? '')).toThrow(
      /SERIAL_DUPLICATE/,
    );
  });

  it('exige l’unité exacte pour un mouvement d’article suivi', () => {
    const { variantId } = insertVariant(db, { type: 'phone' });
    expect(() => move(db, { variantId, delta: 1, userId })).toThrow(/STOCK_SERIAL_REQUIRED/);
    const unit = insertSerial(db, variantId, VALID_IMEIS[0] ?? '');
    expect(() => move(db, { variantId, delta: 2, userId, serialUnitId: unit })).toThrow(
      /STOCK_SERIAL_REQUIRED/,
    );
    move(db, { variantId, delta: 1, userId, serialUnitId: unit });
    expect(stockOf(db, variantId)).toBe(1);
  });
});

describe('ventes et paiements (E.4)', () => {
  function soldPhone(): {
    saleId: number;
    lineId: number;
    unitId: number;
    variantId: number;
    session: number;
  } {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db, { type: 'phone' });
    const unitId = insertSerial(db, variantId, VALID_IMEIS[0] ?? '');
    const saleId = heldSale(db, userId, session);
    const lineId = addSaleLine(db, { saleId, variantId, serialUnitId: unitId });
    completeSale(db, saleId, userId, session);
    db.prepare(
      "UPDATE serial_units SET status = 'sold', sale_line_id = ?, sold_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(lineId, unitId);
    return { saleId, lineId, unitId, variantId, session };
  }

  it('fige une vente terminée : lignes, montants et paiements', () => {
    const { saleId, lineId, variantId } = soldPhone();
    expect(() => db.prepare('UPDATE sales SET total = 1 WHERE id = ?').run(saleId)).toThrow(
      /SALE_LOCKED/,
    );
    expect(() =>
      db.prepare('UPDATE sale_lines SET unit_price = 1 WHERE id = ?').run(lineId),
    ).toThrow(/SALE_LOCKED/);
    expect(() => db.prepare('DELETE FROM sale_lines WHERE id = ?').run(lineId)).toThrow(
      /SALE_LOCKED/,
    );
    expect(() => addSaleLine(db, { saleId, variantId })).toThrow(/SALE_LOCKED/);
    expect(() => db.prepare('UPDATE payments SET amount = 1').run()).toThrow(/IMMUTABLE/);
    expect(() => db.prepare('DELETE FROM payments').run()).toThrow(/IMMUTABLE/);
    expect(() => db.prepare('DELETE FROM sales').run()).toThrow(/NO_DELETE/);
  });

  it('autorise seulement l’annulation motivée d’une vente terminée, puis la fige', () => {
    const { saleId } = soldPhone();
    expect(() =>
      db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(saleId),
    ).toThrow(/CHECK/);
    db.prepare(
      `UPDATE sales SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         cancelled_by = ?, cancel_reason = 'Erreur de saisie' WHERE id = ?`,
    ).run(userId, saleId);
    expect(() =>
      db.prepare("UPDATE sales SET cancel_reason = 'autre' WHERE id = ?").run(saleId),
    ).toThrow(/SALE_LOCKED/);
  });

  it('ne vend jamais deux fois le même IMEI', () => {
    const { unitId, variantId, session } = soldPhone();
    const second = heldSale(db, userId, session);
    expect(() => addSaleLine(db, { saleId: second, variantId, serialUnitId: unitId })).toThrow(
      /SERIAL_NOT_AVAILABLE/,
    );
    expect(() =>
      db.prepare("UPDATE serial_units SET status = 'sold' WHERE id = ?").run(unitId),
    ).not.toThrow();
    expect(() =>
      db.prepare("UPDATE serial_units SET status = 'in_stock' WHERE id = ?").run(unitId),
    ).toThrow(/SERIAL_STATUS/);
  });

  it('refuse de terminer une vente d’article suivi sans son unité', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db, { type: 'appliance', tracking: 'serial' });
    const saleId = heldSale(db, userId, session);
    addSaleLine(db, { saleId, variantId });
    expect(() => completeSale(db, saleId, userId, session)).toThrow(/SALE_SERIAL_REQUIRED/);
  });

  it('vérifie les totaux et les paiements à la validation', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db);
    const saleId = heldSale(db, userId, session);
    addSaleLine(db, { saleId, variantId, quantity: 2, unitPrice: 5000 });
    db.prepare('UPDATE sales SET subtotal = 9000, total = 9000 WHERE id = ?').run(saleId);
    expect(() =>
      db
        .prepare(
          "UPDATE sales SET status = 'completed', amount_paid = 9000, invoice_number = 'F1', completed_at = '2026-11-10T10:00:00Z' WHERE id = ?",
        )
        .run(saleId),
    ).toThrow(/SALE_TOTALS/);
  });

  it('refuse un paiement supérieur au reste à payer', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db);
    const saleId = heldSale(db, userId, session);
    addSaleLine(db, { saleId, variantId });
    db.prepare('UPDATE sales SET subtotal = 10000, total = 10000 WHERE id = ?').run(saleId);
    const pay = (amount: number): unknown =>
      db
        .prepare(
          "INSERT INTO payments (sale_id, method, amount, cash_session_id, user_id) VALUES (?, 'cash', ?, ?, ?)",
        )
        .run(saleId, amount, session, userId);
    pay(6000);
    expect(() => pay(4001)).toThrow(/PAYMENT_EXCEEDS_TOTAL/);
  });

  it('impose client et échéance pour une vente à crédit, dans la limite du plafond', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db);
    const saleId = heldSale(db, userId, session);
    addSaleLine(db, { saleId, variantId });
    db.prepare('UPDATE sales SET subtotal = 10000, total = 10000 WHERE id = ?').run(saleId);
    const complete = (): unknown =>
      db
        .prepare(
          "UPDATE sales SET status = 'completed', invoice_number = 'F9', completed_at = '2026-11-10T10:00:00Z' WHERE id = ?",
        )
        .run(saleId);
    expect(complete).toThrow(/CHECK/);
    const customer = Number(
      db.prepare("INSERT INTO customers (full_name, credit_limit) VALUES ('Awa', 5000)").run()
        .lastInsertRowid,
    );
    db.prepare("UPDATE sales SET customer_id = ?, due_date = '2026-12-10' WHERE id = ?").run(
      customer,
      saleId,
    );
    expect(complete).toThrow(/SALE_CREDIT_LIMIT/);
    db.prepare('UPDATE customers SET credit_limit = 10000 WHERE id = ?').run(customer);
    complete();
    expect(
      db
        .prepare('SELECT balance FROM v_customer_balances WHERE customer_id = ?')
        .pluck()
        .get(customer),
    ).toBe(10000);
  });

  it('limite un retour à la quantité vendue', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db);
    const saleId = heldSale(db, userId, session);
    const lineId = addSaleLine(db, { saleId, variantId, quantity: 2, unitPrice: 5000 });
    completeSale(db, saleId, userId, session);
    const returnId = Number(
      db
        .prepare(
          "INSERT INTO sale_returns (number, sale_id, reason, refund_amount, user_id) VALUES ('R1', ?, 'Défaut', 0, ?)",
        )
        .run(saleId, userId).lastInsertRowid,
    );
    const returnLine = (quantity: number): unknown =>
      db
        .prepare(
          'INSERT INTO sale_return_lines (return_id, sale_line_id, quantity, amount) VALUES (?, ?, ?, 0)',
        )
        .run(returnId, lineId, quantity);
    returnLine(1);
    returnLine(1);
    expect(() => returnLine(1)).toThrow(/RETURN_EXCEEDS_SOLD/);
  });

  it('numérote les factures sans trou ni suppression', () => {
    db.prepare('INSERT INTO invoice_sequences (year, last_number) VALUES (2026, 0)').run();
    db.prepare(
      'UPDATE invoice_sequences SET last_number = last_number + 1 WHERE year = 2026',
    ).run();
    expect(() =>
      db.prepare('UPDATE invoice_sequences SET last_number = 5 WHERE year = 2026').run(),
    ).toThrow(/INVOICE_SEQUENCE/);
    expect(() => db.prepare('DELETE FROM invoice_sequences').run()).toThrow(/IMMUTABLE/);
  });

  it('ne laisse aucune vente à moitié enregistrée après une erreur en cours de transaction', () => {
    const session = openCashSession(db, userId);
    const { variantId } = insertVariant(db);
    move(db, { variantId, delta: 1, userId });
    const salesBefore = db.prepare('SELECT count(*) FROM sales').pluck().get();
    expect(() =>
      db.transaction(() => {
        const saleId = heldSale(db, userId, session);
        addSaleLine(db, { saleId, variantId, quantity: 2 });
        move(db, { variantId, delta: -2, userId });
      })(),
    ).toThrow(/STOCK_NEGATIVE/);
    expect(db.prepare('SELECT count(*) FROM sales').pluck().get()).toBe(salesBefore);
    expect(db.prepare('SELECT count(*) FROM sale_lines').pluck().get()).toBe(0);
    expect(stockOf(db, variantId)).toBe(1);
  });
});

describe('kits, attributs et catégories', () => {
  it('interdit un kit dans un kit et un kit composant de lui-même', () => {
    const kit = insertVariant(db, { type: 'kit' }).variantId;
    const otherKit = insertVariant(db, { type: 'kit' }).variantId;
    const panel = insertVariant(db, { type: 'solar' }).variantId;
    const add = (kitId: number, component: number): unknown =>
      db
        .prepare(
          'INSERT INTO kit_components (kit_variant_id, component_variant_id, quantity) VALUES (?, ?, 1)',
        )
        .run(kitId, component);
    add(kit, panel);
    expect(() => add(kit, otherKit)).toThrow(/KIT_NESTED/);
    expect(() => add(kit, kit)).toThrow(/KIT_NESTED|CHECK/);
    expect(() => add(panel, kit)).toThrow(/KIT_PARENT/);
  });

  it('valide les attributs selon leur type et leur catégorie, avec héritage', () => {
    const family = db
      .prepare("SELECT id FROM categories WHERE name = 'Énergie solaire'")
      .pluck()
      .get() as number;
    const panels = Number(
      db.prepare("INSERT INTO categories (name, parent_id) VALUES ('Panneaux', ?)").run(family)
        .lastInsertRowid,
    );
    const power = Number(
      db
        .prepare(
          "INSERT INTO attribute_definitions (category_id, code, label, value_type, unit) VALUES (?, 'power', 'Puissance', 'number', 'Wc')",
        )
        .run(family).lastInsertRowid,
    );
    const kind = Number(
      db
        .prepare(
          `INSERT INTO attribute_definitions (category_id, code, label, value_type, choices)
                  VALUES (?, 'cell', 'Cellules', 'choice', '["mono","poly"]')`,
        )
        .run(panels).lastInsertRowid,
    );
    const { productId } = insertVariant(db, { type: 'solar', categoryId: panels });
    const set = (attributeId: number, text: string | null, number: number | null): unknown =>
      db
        .prepare(
          'INSERT OR REPLACE INTO product_attribute_values (product_id, attribute_id, value_text, value_number) VALUES (?, ?, ?, ?)',
        )
        .run(productId, attributeId, text, number);
    set(power, null, 400);
    set(kind, 'mono', null);
    expect(() => set(kind, 'amorphe', null)).toThrow(/ATTRIBUTE_VALUE/);
    expect(() => set(power, '400', null)).toThrow(/ATTRIBUTE_VALUE/);
    const phones = db
      .prepare("SELECT id FROM categories WHERE name = 'Téléphonie'")
      .pluck()
      .get() as number;
    const screen = Number(
      db
        .prepare(
          "INSERT INTO attribute_definitions (category_id, code, label, value_type) VALUES (?, 'screen', 'Écran', 'number')",
        )
        .run(phones).lastInsertRowid,
    );
    expect(() => set(screen, null, 6.5)).toThrow(/ATTRIBUTE_CATEGORY/);
  });

  it('limite les catégories à trois niveaux, sans cycle', () => {
    const family = db
      .prepare('SELECT id FROM categories ORDER BY id LIMIT 1')
      .pluck()
      .get() as number;
    const insert = (name: string, parent: number): number =>
      Number(
        db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(name, parent)
          .lastInsertRowid,
      );
    const level2 = insert('Smartphones', family);
    const level3 = insert('Android', level2);
    expect(() => insert('Trop profond', level3)).toThrow(/CATEGORY_DEPTH/);
    expect(() =>
      db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(level3, family),
    ).toThrow(/CATEGORY_MOVE/);
    expect(() => db.prepare('DELETE FROM categories WHERE id = ?').run(level3)).toThrow(
      /NO_DELETE/,
    );
  });
});

describe('utilisateurs', () => {
  it('garde toujours un administrateur actif', () => {
    expect(() => db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId)).toThrow(
      /LAST_ADMIN/,
    );
    expect(() =>
      db
        .prepare(
          "UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'seller') WHERE id = ?",
        )
        .run(userId),
    ).toThrow(/LAST_ADMIN/);
    const second = insertUser(db, 'patron2');
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(second);
    expect(() => db.prepare('DELETE FROM users').run()).toThrow(/NO_DELETE/);
  });

  it('refuse un identifiant en double sans tenir compte de la casse', () => {
    expect(() => insertUser(db, 'ADMIN')).toThrow(/UNIQUE/);
  });
});

describe('plans d’exécution (E.8)', () => {
  const plan = (sql: string): string =>
    db
      .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .all('x')
      .map((row) => row.detail)
      .join(' | ');

  it('retrouve un code-barres, un SKU et un IMEI par index', () => {
    expect(plan('SELECT id FROM product_variants WHERE barcode = ?')).toMatch(
      /USING (COVERING )?INDEX/,
    );
    expect(plan('SELECT id FROM product_variants WHERE sku = ?')).toMatch(
      /USING (COVERING )?INDEX/,
    );
    expect(plan('SELECT id FROM serial_units WHERE serial_number = ?')).toMatch(
      /USING (COVERING )?INDEX/,
    );
    expect(plan('SELECT id FROM serial_units WHERE imei2 = ?')).toMatch(/USING (COVERING )?INDEX/);
  });

  it('cherche les produits par la table plein texte', () => {
    expect(plan('SELECT rowid FROM products_fts WHERE products_fts MATCH ?')).toMatch(
      /VIRTUAL TABLE/,
    );
  });
});
