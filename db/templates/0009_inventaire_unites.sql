-- 0009 : numéros scannés pendant un inventaire (accord du client, D60). Les appareils suivis se
-- comptent un par un : un appareil manquant sort nommément à la validation, un appareil retrouvé
-- revient en stock. Aucune table existante n'est modifiée.

CREATE TABLE inventory_unit_scans (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions (id) ON DELETE RESTRICT,
  serial_unit_id INTEGER NOT NULL REFERENCES serial_units (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  scanned_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO scanned_at}},
  UNIQUE (session_id, serial_unit_id)
) STRICT;

CREATE INDEX idx_inventory_unit_scans_unit ON inventory_unit_scans (serial_unit_id);

-- Un numéro se scanne pendant le comptage, sur un article du périmètre de l'inventaire.
CREATE TRIGGER trg_inventory_unit_scans_insert BEFORE INSERT ON inventory_unit_scans
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: le comptage de cet inventaire est terminé')
  WHERE (SELECT s.status FROM inventory_sessions s WHERE s.id = NEW.session_id) NOT IN ('draft', 'counting');
  SELECT RAISE(ABORT, 'INVENTORY_SCOPE: cet appareil n''appartient pas au périmètre de l''inventaire')
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_lines l JOIN serial_units u ON u.variant_id = l.variant_id
    WHERE l.session_id = NEW.session_id AND u.id = NEW.serial_unit_id);
  SELECT RAISE(ABORT, 'INVENTORY_UNIT_SOLD: un appareil vendu ou rendu ne se compte pas en stock')
  WHERE (SELECT u.status FROM serial_units u WHERE u.id = NEW.serial_unit_id) IN ('sold', 'supplier_returned');
END;

CREATE TRIGGER trg_inventory_unit_scans_update BEFORE UPDATE ON inventory_unit_scans
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: inventory_unit_scans');
END;

-- Un scan erroné se retire pendant le comptage, jamais après.
CREATE TRIGGER trg_inventory_unit_scans_delete BEFORE DELETE ON inventory_unit_scans
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_LOCKED: le comptage de cet inventaire est terminé')
  WHERE (SELECT s.status FROM inventory_sessions s WHERE s.id = OLD.session_id) NOT IN ('draft', 'counting');
END;
