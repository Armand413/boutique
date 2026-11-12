-- 0013 : plus de suivi unitaire (accord du client, D93). Les téléphones ne sont plus obligatoirement
-- suivis par IMEI : SQLite ne retire pas une contrainte CHECK, la table products est recréée à
-- l'identique sans elle (méthode de 0007 : clés étrangères différées, mêmes identifiants, index et
-- triggers recréés). Tous les produits et toutes les catégories passent ensuite sans suivi : les
-- articles s'entrent et se vendent par quantité. Les unités déjà enregistrées restent en base.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE products_copy AS SELECT * FROM products;

DROP TRIGGER trg_products_type_locked;
DROP TRIGGER trg_products_fts_product_update;
DROP TRIGGER trg_products_no_delete;
DROP TABLE products;

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  brand_id INTEGER REFERENCES brands (id) ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  model TEXT,
  description TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN
    ('phone', 'accessory', 'electronics', 'appliance', 'solar', 'part', 'service', 'kit')),
  tracking_mode TEXT NOT NULL DEFAULT 'none' CHECK (tracking_mode IN ('none', 'serial', 'imei')),
  is_stocked INTEGER NOT NULL DEFAULT 1 {{BOOL is_stocked}},
  tax_rate_id INTEGER REFERENCES tax_rates (id) ON DELETE RESTRICT,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  warranty_months INTEGER NOT NULL DEFAULT 0 CHECK (warranty_months BETWEEN 0 AND 600),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  image_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 {{BOOL is_active}},
  {{STD}},
  CHECK (product_type NOT IN ('service', 'kit') OR (is_stocked = 0 AND tracking_mode = 'none')),
  CHECK (is_stocked = 1 OR tracking_mode = 'none')
) STRICT;

INSERT INTO products SELECT * FROM products_copy;
DROP TABLE products_copy;

-- Avant de recréer le verrou du type : tout passe sans suivi, articles déjà mouvementés compris.
UPDATE products SET tracking_mode = 'none' WHERE tracking_mode <> 'none';
UPDATE categories SET default_tracking_mode = 'none' WHERE default_tracking_mode <> 'none';

CREATE INDEX idx_products_brand ON products (brand_id);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_type ON products (product_type);
CREATE INDEX idx_products_active ON products (is_active);

CREATE TRIGGER trg_products_type_locked BEFORE UPDATE OF product_type, tracking_mode, is_stocked ON products
WHEN NEW.product_type IS NOT OLD.product_type
  OR NEW.tracking_mode IS NOT OLD.tracking_mode
  OR NEW.is_stocked IS NOT OLD.is_stocked
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_TYPE_LOCKED: le type et le suivi d''un produit déjà mouvementé ne changent plus')
  WHERE EXISTS (
    SELECT 1 FROM product_variants v JOIN stock_movements m ON m.variant_id = v.id WHERE v.product_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM product_variants v JOIN serial_units s ON s.variant_id = v.id WHERE v.product_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM product_variants v JOIN sale_lines l ON l.variant_id = v.id WHERE v.product_id = OLD.id
  );
END;

CREATE TRIGGER trg_products_fts_product_update AFTER UPDATE OF name, model, brand_id, category_id ON products
BEGIN
  DELETE FROM products_fts WHERE rowid IN (SELECT id FROM product_variants WHERE product_id = NEW.id);
  INSERT INTO products_fts (rowid, name, brand, model, sku, barcode, category)
  SELECT v.id, NEW.name, coalesce(b.name, ''), coalesce(NEW.model, ''), v.sku, coalesce(v.barcode, ''), c.name
  FROM product_variants v LEFT JOIN brands b ON b.id = NEW.brand_id JOIN categories c ON c.id = NEW.category_id
  WHERE v.product_id = NEW.id;
END;

{{NO_DELETE products}}
