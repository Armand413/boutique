-- 0005 : inventaires et garantie / SAV simplifié.

CREATE TABLE inventory_sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('all', 'brand', 'category')),
  scope_id INTEGER,
  location_id INTEGER REFERENCES stock_locations (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'counting', 'review', 'validated', 'cancelled')),
  created_by INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  validated_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}},
  updated_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO updated_at}},
  validated_at TEXT {{ISO_NULL validated_at}},
  CHECK ((scope_type = 'all') = (scope_id IS NULL)),
  CHECK ((status = 'validated') = (validated_by IS NOT NULL AND validated_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_inventory_sessions_status ON inventory_sessions (status);

CREATE TRIGGER trg_inventory_sessions_update BEFORE UPDATE ON inventory_sessions
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: un inventaire validé ou annulé ne se modifie plus')
  WHERE OLD.status IN ('validated', 'cancelled');
  -- Double contrôle (paramètre) : le créateur ne valide pas seul son inventaire.
  SELECT RAISE(ABORT, 'INVENTORY_DOUBLE_CHECK: l''inventaire doit être validé par une autre personne')
  WHERE NEW.status = 'validated' AND NEW.validated_by = OLD.created_by
    AND (SELECT s.value FROM settings s WHERE s.key = 'inventory.double_check') = 'true';
END;

CREATE TABLE inventory_lines (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions (id) ON DELETE RESTRICT,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
  -- Quantité attendue figée à l'ouverture de l'inventaire.
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
  counted_quantity INTEGER CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  difference INTEGER GENERATED ALWAYS AS (counted_quantity - expected_quantity) VIRTUAL,
  note TEXT,
  UNIQUE (session_id, variant_id, location_id)
) STRICT;

CREATE INDEX idx_inventory_lines_variant ON inventory_lines (variant_id);

CREATE TRIGGER trg_inventory_lines_insert BEFORE INSERT ON inventory_lines
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: un inventaire validé ou annulé ne se modifie plus')
  WHERE (SELECT s.status FROM inventory_sessions s WHERE s.id = NEW.session_id) NOT IN ('draft', 'counting');
END;

CREATE TRIGGER trg_inventory_lines_update BEFORE UPDATE ON inventory_lines
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: un inventaire validé ou annulé ne se modifie plus')
  WHERE (SELECT s.status FROM inventory_sessions s WHERE s.id = OLD.session_id) NOT IN ('draft', 'counting', 'review');
  SELECT RAISE(ABORT, 'INVENTORY_EXPECTED_LOCKED: la quantité attendue est figée à l''ouverture')
  WHERE NEW.expected_quantity IS NOT OLD.expected_quantity OR NEW.session_id IS NOT OLD.session_id
     OR NEW.variant_id IS NOT OLD.variant_id OR NEW.location_id IS NOT OLD.location_id;
END;

CREATE TRIGGER trg_inventory_lines_delete BEFORE DELETE ON inventory_lines
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: seule une ligne d''un inventaire en préparation se retire')
  WHERE (SELECT s.status FROM inventory_sessions s WHERE s.id = OLD.session_id) IS NOT 'draft';
END;

CREATE TABLE warranty_claims (
  id INTEGER PRIMARY KEY,
  serial_unit_id INTEGER NOT NULL REFERENCES serial_units (id) ON DELETE RESTRICT,
  sale_id INTEGER REFERENCES sales (id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers (id) ON DELETE RESTRICT,
  supplier_id INTEGER REFERENCES suppliers (id) ON DELETE RESTRICT,
  issue TEXT NOT NULL CHECK (length(trim(issue)) > 0),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN
    ('received', 'sent_to_supplier', 'repaired', 'replaced', 'rejected', 'closed')),
  resolution TEXT,
  -- Garantie dépassée à l'ouverture : réclamation acceptée mais signalée (alerte).
  warranty_expired INTEGER NOT NULL DEFAULT 0 {{BOOL warranty_expired}},
  opened_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO opened_at}},
  closed_at TEXT {{ISO_NULL closed_at}},
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO updated_at}},
  CHECK ((status IN ('rejected', 'closed')) = (closed_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_warranty_claims_serial ON warranty_claims (serial_unit_id);
CREATE INDEX idx_warranty_claims_status ON warranty_claims (status);

CREATE TRIGGER trg_warranty_claims_insert BEFORE INSERT ON warranty_claims
BEGIN
  SELECT RAISE(ABORT, 'WARRANTY_NOT_SOLD: une réclamation porte sur une unité vendue')
  WHERE (SELECT u.status FROM serial_units u WHERE u.id = NEW.serial_unit_id) IS NOT 'sold';
  SELECT RAISE(ABORT, 'WARRANTY_SALE: la vente ne correspond pas à l''unité')
  WHERE NEW.sale_id IS NOT NULL AND NEW.sale_id IS NOT (
    SELECT l.sale_id FROM serial_units u JOIN sale_lines l ON l.id = u.sale_line_id WHERE u.id = NEW.serial_unit_id);
  SELECT RAISE(ABORT, 'WARRANTY_EXPIRED_FLAG: l''alerte de garantie dépassée doit refléter la date de fin')
  WHERE NEW.warranty_expired IS NOT coalesce(
    (SELECT u.warranty_end < substr(NEW.opened_at, 1, 10) FROM serial_units u WHERE u.id = NEW.serial_unit_id), 1);
END;

CREATE TRIGGER trg_warranty_claims_update BEFORE UPDATE ON warranty_claims
BEGIN
  SELECT RAISE(ABORT, 'WARRANTY_LOCKED: une réclamation clôturée ne se modifie plus')
  WHERE OLD.status IN ('rejected', 'closed');
  SELECT RAISE(ABORT, 'WARRANTY_LOCKED: l''unité, la vente et la date d''ouverture sont figées')
  WHERE NEW.serial_unit_id IS NOT OLD.serial_unit_id OR NEW.sale_id IS NOT OLD.sale_id
     OR NEW.opened_at IS NOT OLD.opened_at OR NEW.warranty_expired IS NOT OLD.warranty_expired;
END;

{{NO_DELETE inventory_sessions}}
{{NO_DELETE warranty_claims}}
