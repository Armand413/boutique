-- 0012 : entrée de marchandise sans fournisseur (accord du client, D90). SQLite ne modifie pas une
-- contrainte NOT NULL : la table goods_receipts est recréée à l'identique, fournisseur facultatif.
-- Même méthode que 0007 : clés étrangères différées jusqu'à la fin de la transaction, lignes recopiées
-- avec les mêmes identifiants, index et triggers recréés.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE goods_receipts_copy AS SELECT * FROM goods_receipts;

DROP TRIGGER trg_goods_receipts_status;
DROP TRIGGER trg_goods_receipts_total;
DROP TRIGGER trg_goods_receipts_no_delete;
DROP TABLE goods_receipts;

CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (length(number) BETWEEN 1 AND 32),
  supplier_id INTEGER REFERENCES suppliers (id) ON DELETE RESTRICT,
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

INSERT INTO goods_receipts SELECT * FROM goods_receipts_copy;
DROP TABLE goods_receipts_copy;

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

CREATE TRIGGER trg_goods_receipts_no_delete BEFORE DELETE ON goods_receipts
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: goods_receipts s''archive, ne se supprime pas');
END;
