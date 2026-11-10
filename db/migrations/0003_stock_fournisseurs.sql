-- 0003 : stock multi-emplacements, mouvements immuables, fournisseurs et entrées de marchandises.

CREATE TABLE stock_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (is_default = 0 OR is_active = 1)
) STRICT;

CREATE UNIQUE INDEX ux_stock_locations_default ON stock_locations (is_default) WHERE is_default = 1;

-- Stock courant : seule dénormalisation admise, tenue par trigger depuis stock_movements.
CREATE TABLE stock_levels (
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (variant_id, location_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_stock_levels_location ON stock_levels (location_id);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
  serial_unit_id INTEGER REFERENCES serial_units (id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'purchase', 'sale', 'sale_return', 'purchase_return', 'adjustment', 'inventory',
    'loss', 'damage', 'theft', 'internal_use', 'transfer_in', 'transfer_out')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  -- Stock de la variante à cet emplacement après le mouvement ; vérifié par trigger.
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reference_type TEXT CHECK (reference_type IS NULL OR reference_type IN (
    'goods_receipt', 'sale', 'sale_return', 'inventory_session', 'transfer', 'manual')),
  reference_id INTEGER,
  reason TEXT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  CHECK (movement_type NOT IN ('purchase', 'sale_return', 'transfer_in') OR quantity_delta > 0),
  CHECK (movement_type NOT IN ('sale', 'purchase_return', 'loss', 'damage', 'theft', 'internal_use', 'transfer_out')
         OR quantity_delta < 0),
  CHECK (movement_type NOT IN ('adjustment', 'loss', 'damage', 'theft', 'internal_use')
         OR length(trim(coalesce(reason, ''))) > 0),
  CHECK ((reference_type IS NULL) = (reference_id IS NULL))
) STRICT;

CREATE INDEX idx_stock_movements_variant_created ON stock_movements (variant_id, created_at);
CREATE INDEX idx_stock_movements_variant_location ON stock_movements (variant_id, location_id, id);
CREATE INDEX idx_stock_movements_reference ON stock_movements (reference_type, reference_id);
CREATE INDEX idx_stock_movements_created ON stock_movements (created_at);

CREATE TRIGGER trg_stock_movements_check BEFORE INSERT ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'STOCK_NOT_STOCKED: aucun mouvement de stock pour un service ou un kit')
  WHERE (SELECT p.is_stocked FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) IS NOT 1;
  SELECT RAISE(ABORT, 'STOCK_SERIAL_REQUIRED: un article suivi bouge à l''unité, avec son numéro')
  WHERE (SELECT p.tracking_mode FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) <> 'none'
    AND (NEW.serial_unit_id IS NULL OR abs(NEW.quantity_delta) <> 1);
  SELECT RAISE(ABORT, 'STOCK_SERIAL_MISMATCH: l''unité n''appartient pas à cette variante')
  WHERE NEW.serial_unit_id IS NOT NULL
    AND (SELECT s.variant_id FROM serial_units s WHERE s.id = NEW.serial_unit_id) IS NOT NEW.variant_id;
  SELECT RAISE(ABORT, 'STOCK_NEGATIVE: stock insuffisant')
  WHERE coalesce((SELECT l.quantity FROM stock_levels l
                  WHERE l.variant_id = NEW.variant_id AND l.location_id = NEW.location_id), 0)
        + NEW.quantity_delta < 0;
  SELECT RAISE(ABORT, 'STOCK_QUANTITY_AFTER: quantité après mouvement incohérente')
  WHERE NEW.quantity_after IS NOT coalesce((SELECT l.quantity FROM stock_levels l
          WHERE l.variant_id = NEW.variant_id AND l.location_id = NEW.location_id), 0) + NEW.quantity_delta;
END;

CREATE TRIGGER trg_stock_movements_apply AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO stock_levels (variant_id, location_id, quantity)
  VALUES (NEW.variant_id, NEW.location_id, NEW.quantity_after)
  ON CONFLICT (variant_id, location_id) DO UPDATE SET quantity = excluded.quantity;
END;

-- stock_levels n'accepte que la valeur du dernier mouvement : aucune écriture directe possible.
CREATE TRIGGER trg_stock_levels_insert_guard BEFORE INSERT ON stock_levels
BEGIN
  SELECT RAISE(ABORT, 'STOCK_LEVEL_DIRECT: le stock se modifie uniquement par un mouvement')
  WHERE NEW.quantity IS NOT (SELECT m.quantity_after FROM stock_movements m
    WHERE m.variant_id = NEW.variant_id AND m.location_id = NEW.location_id ORDER BY m.id DESC LIMIT 1);
END;

CREATE TRIGGER trg_stock_levels_update_guard BEFORE UPDATE ON stock_levels
BEGIN
  SELECT RAISE(ABORT, 'STOCK_LEVEL_DIRECT: le stock se modifie uniquement par un mouvement')
  WHERE NEW.variant_id IS NOT OLD.variant_id OR NEW.location_id IS NOT OLD.location_id
     OR NEW.quantity IS NOT (SELECT m.quantity_after FROM stock_movements m
       WHERE m.variant_id = NEW.variant_id AND m.location_id = NEW.location_id ORDER BY m.id DESC LIMIT 1);
END;

CREATE TRIGGER trg_stock_levels_no_delete BEFORE DELETE ON stock_levels
BEGIN
  SELECT RAISE(ABORT, 'STOCK_LEVEL_DIRECT: le stock se modifie uniquement par un mouvement');
END;

CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: stock_movements');
END;

CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: stock_movements');
END;

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 120),
  phone TEXT,
  email TEXT CHECK (email IS NULL OR email GLOB '*?@?*.?*'),
  address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (length(number) BETWEEN 1 AND 32),
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
  received_at TEXT NOT NULL CHECK (received_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),
  notes TEXT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  validated_at TEXT CHECK (validated_at IS NULL OR validated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK ((status = 'validated') = (validated_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_goods_receipts_supplier ON goods_receipts (supplier_id);

CREATE TRIGGER trg_goods_receipts_status BEFORE UPDATE ON goods_receipts
WHEN OLD.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_LOCKED: une entrée validée ou annulée ne se modifie plus');
END;

CREATE TRIGGER trg_goods_receipts_total BEFORE UPDATE OF status ON goods_receipts
WHEN NEW.status = 'validated'
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_EMPTY: une entrée sans ligne ne peut pas être validée')
  WHERE NOT EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.receipt_id = NEW.id);
  SELECT RAISE(ABORT, 'RECEIPT_TOTAL: le total ne correspond pas aux lignes')
  WHERE NEW.total_cost IS NOT (SELECT sum(l.quantity * l.unit_cost) FROM goods_receipt_lines l WHERE l.receipt_id = NEW.id);
END;

CREATE TABLE goods_receipt_lines (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts (id) ON DELETE RESTRICT,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
) STRICT;

CREATE INDEX idx_goods_receipt_lines_receipt ON goods_receipt_lines (receipt_id);
CREATE INDEX idx_goods_receipt_lines_variant ON goods_receipt_lines (variant_id);

CREATE TRIGGER trg_goods_receipt_lines_insert BEFORE INSERT ON goods_receipt_lines
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_LOCKED: une entrée validée ou annulée ne se modifie plus')
  WHERE (SELECT r.status FROM goods_receipts r WHERE r.id = NEW.receipt_id) IS NOT 'draft';
END;

CREATE TRIGGER trg_goods_receipt_lines_update BEFORE UPDATE ON goods_receipt_lines
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_LOCKED: une entrée validée ou annulée ne se modifie plus')
  WHERE (SELECT r.status FROM goods_receipts r WHERE r.id = OLD.receipt_id) IS NOT 'draft'
     OR NEW.receipt_id IS NOT OLD.receipt_id;
END;

CREATE TRIGGER trg_goods_receipt_lines_delete BEFORE DELETE ON goods_receipt_lines
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_LOCKED: une entrée validée ou annulée ne se modifie plus')
  WHERE (SELECT r.status FROM goods_receipts r WHERE r.id = OLD.receipt_id) IS NOT 'draft';
END;

CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  receipt_id INTEGER REFERENCES goods_receipts (id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'mobile_money', 'transfer', 'cheque')),
  reference TEXT,
  paid_at TEXT NOT NULL CHECK (paid_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z')
) STRICT;

CREATE INDEX idx_supplier_payments_supplier ON supplier_payments (supplier_id);

CREATE TRIGGER trg_supplier_payments_receipt BEFORE INSERT ON supplier_payments
WHEN NEW.receipt_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SUPPLIER_PAYMENT_RECEIPT: l''entrée doit être validée et appartenir à ce fournisseur')
  WHERE NOT EXISTS (SELECT 1 FROM goods_receipts r
    WHERE r.id = NEW.receipt_id AND r.supplier_id = NEW.supplier_id AND r.status = 'validated');
END;

CREATE TRIGGER trg_supplier_payments_no_update BEFORE UPDATE ON supplier_payments
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: supplier_payments');
END;

CREATE TRIGGER trg_supplier_payments_no_delete BEFORE DELETE ON supplier_payments
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: supplier_payments');
END;
CREATE TRIGGER trg_stock_locations_no_delete BEFORE DELETE ON stock_locations
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: stock_locations s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_suppliers_no_delete BEFORE DELETE ON suppliers
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: suppliers s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_goods_receipts_no_delete BEFORE DELETE ON goods_receipts
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: goods_receipts s''archive, ne se supprime pas');
END;
