-- 0007 : états de sortie hors vente des unités suivies (D43). SQLite ne modifie pas un CHECK :
-- la table serial_units est recréée à l'identique avec deux états de plus. Les clés étrangères qui
-- la référencent restent actives ; leur contrôle est différé jusqu'à la fin de la transaction, après
-- la recopie des lignes (mêmes identifiants).

PRAGMA defer_foreign_keys = ON;

CREATE TABLE serial_units_copy AS SELECT * FROM serial_units;

DROP TRIGGER trg_serial_units_no_delete;
DROP TRIGGER trg_serial_units_format_insert;
DROP TRIGGER trg_serial_units_identity_locked;
DROP TRIGGER trg_serial_units_status;
DROP TABLE serial_units;

CREATE TABLE serial_units (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  serial_number TEXT NOT NULL UNIQUE CHECK (length(trim(serial_number)) BETWEEN 1 AND 64),
  imei2 TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'reserved', 'sold', 'returned', 'defective',
                      'supplier_returned', 'written_off')),
  receipt_line_id INTEGER REFERENCES goods_receipt_lines (id) ON DELETE RESTRICT,
  sale_line_id INTEGER REFERENCES sale_lines (id) ON DELETE RESTRICT,
  received_at TEXT {{ISO_NULL received_at}},
  sold_at TEXT {{ISO_NULL sold_at}},
  warranty_end TEXT {{DATE_NULL warranty_end}},
  {{STD}},
  CHECK (status <> 'sold' OR (sale_line_id IS NOT NULL AND sold_at IS NOT NULL)),
  CHECK (imei2 IS NULL OR imei2 <> serial_number)
) STRICT;

INSERT INTO serial_units SELECT * FROM serial_units_copy;
DROP TABLE serial_units_copy;

CREATE INDEX idx_serial_units_variant_status ON serial_units (variant_id, status);

CREATE TRIGGER trg_serial_units_format_insert BEFORE INSERT ON serial_units
BEGIN
  SELECT RAISE(ABORT, 'SERIAL_NOT_TRACKED: ce produit n''est pas suivi par numéro de série ou IMEI')
  WHERE (SELECT p.tracking_mode FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) IS NOT 'serial'
    AND (SELECT p.tracking_mode FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) IS NOT 'imei';
  SELECT RAISE(ABORT, 'IMEI_INVALID: un IMEI compte 15 chiffres et respecte la clé de Luhn')
  WHERE (SELECT p.tracking_mode FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) = 'imei'
    AND (NOT {{LUHN NEW.serial_number}} OR (NEW.imei2 IS NOT NULL AND NOT {{LUHN NEW.imei2}}));
  SELECT RAISE(ABORT, 'IMEI2_SERIAL_ONLY: le second IMEI est réservé aux téléphones')
  WHERE NEW.imei2 IS NOT NULL
    AND (SELECT p.tracking_mode FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.variant_id) <> 'imei';
  SELECT RAISE(ABORT, 'SERIAL_DUPLICATE: ce numéro est déjà enregistré')
  WHERE EXISTS (SELECT 1 FROM serial_units s WHERE s.imei2 = NEW.serial_number)
     OR (NEW.imei2 IS NOT NULL AND EXISTS (SELECT 1 FROM serial_units s WHERE s.serial_number = NEW.imei2));
END;

CREATE TRIGGER trg_serial_units_identity_locked BEFORE UPDATE OF variant_id, serial_number, imei2 ON serial_units
WHEN NEW.variant_id IS NOT OLD.variant_id
  OR NEW.serial_number IS NOT OLD.serial_number
  OR NEW.imei2 IS NOT OLD.imei2
BEGIN
  SELECT RAISE(ABORT, 'SERIAL_LOCKED: le numéro et la variante d''une unité ne se modifient pas');
END;

-- Cycle de vie d'une unité : vendue uniquement depuis le stock ou une réservation, jamais deux fois.
-- Sorties hors vente : « supplier_returned » (rendue au fournisseur, définitif) et « written_off »
-- (perte, vol, casse, usage interne ; peut revenir en stock si l'appareil est retrouvé).
CREATE TRIGGER trg_serial_units_status BEFORE UPDATE OF status ON serial_units
WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'SERIAL_NOT_AVAILABLE: cette unité n''est pas disponible à la vente')
  WHERE NEW.status = 'sold' AND OLD.status NOT IN ('in_stock', 'reserved');
  SELECT RAISE(ABORT, 'SERIAL_STATUS: changement d''état non autorisé')
  WHERE (OLD.status = 'sold' AND NEW.status NOT IN ('returned'))
     OR (OLD.status = 'returned' AND NEW.status NOT IN ('in_stock', 'defective', 'supplier_returned', 'written_off'))
     OR (OLD.status = 'defective' AND NEW.status NOT IN ('in_stock', 'returned', 'supplier_returned', 'written_off'))
     OR (OLD.status = 'reserved' AND NEW.status NOT IN ('in_stock', 'sold', 'defective'))
     OR (OLD.status = 'in_stock' AND NEW.status NOT IN ('reserved', 'sold', 'defective', 'supplier_returned', 'written_off'))
     OR (OLD.status = 'written_off' AND NEW.status NOT IN ('in_stock'))
     OR OLD.status = 'supplier_returned';
END;

{{NO_DELETE serial_units}}
