-- 0002 : catalogue multi-familles, attributs techniques, unités suivies et kits (E.2, E.4, E.5).

CREATE TABLE brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 80),
  logo_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

-- Les catégories de premier niveau sont les familles. Profondeur limitée à 3 niveaux
-- (famille > catégorie > sous-catégorie) pour que l'héritage des attributs reste vérifiable par trigger.
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 80),
  parent_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
  default_tracking_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (default_tracking_mode IN ('none', 'serial', 'imei')),
  default_warranty_months INTEGER NOT NULL DEFAULT 0
    CHECK (default_warranty_months BETWEEN 0 AND 600),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE UNIQUE INDEX ux_categories_parent_name ON categories (coalesce(parent_id, 0), name);
CREATE INDEX idx_categories_parent ON categories (parent_id);

CREATE TRIGGER trg_categories_depth_insert BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_DEPTH: trois niveaux de catégories au maximum')
  WHERE (SELECT p.parent_id FROM categories p WHERE p.id = NEW.parent_id) IN
    (SELECT gp.id FROM categories gp WHERE gp.parent_id IS NOT NULL);
END;

CREATE TRIGGER trg_categories_parent_update BEFORE UPDATE OF parent_id ON categories
WHEN NEW.parent_id IS NOT OLD.parent_id
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_MOVE: une catégorie qui a des sous-catégories ne peut pas changer de parent')
  WHERE EXISTS (SELECT 1 FROM categories c WHERE c.parent_id = OLD.id);
  SELECT RAISE(ABORT, 'CATEGORY_DEPTH: trois niveaux de catégories au maximum')
  WHERE NEW.parent_id IS NOT NULL AND (SELECT p.parent_id FROM categories p WHERE p.id = NEW.parent_id) IN
    (SELECT gp.id FROM categories gp WHERE gp.parent_id IS NOT NULL);
  SELECT RAISE(ABORT, 'CATEGORY_CYCLE: une catégorie ne peut pas être sa propre ancêtre')
  WHERE NEW.parent_id = OLD.id
     OR (SELECT p.parent_id FROM categories p WHERE p.id = NEW.parent_id) = OLD.id;
END;

CREATE TABLE tax_rates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  -- Centièmes de pourcent : 1800 = 18 %.
  rate INTEGER NOT NULL CHECK (rate BETWEEN 0 AND 10000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT
) STRICT;

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
  is_stocked INTEGER NOT NULL DEFAULT 1 CHECK (is_stocked IN (0, 1)),
  tax_rate_id INTEGER REFERENCES tax_rates (id) ON DELETE RESTRICT,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  warranty_months INTEGER NOT NULL DEFAULT 0 CHECK (warranty_months BETWEEN 0 AND 600),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  image_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (product_type <> 'phone' OR tracking_mode = 'imei'),
  CHECK (product_type NOT IN ('service', 'kit') OR (is_stocked = 0 AND tracking_mode = 'none')),
  CHECK (is_stocked = 1 OR tracking_mode = 'none')
) STRICT;

CREATE INDEX idx_products_brand ON products (brand_id);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_type ON products (product_type);
CREATE INDEX idx_products_active ON products (is_active);

-- Le type ou le suivi d'un produit ne change plus dès qu'il a des unités ou des mouvements.
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

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  sku TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(sku)) BETWEEN 1 AND 64),
  barcode TEXT UNIQUE CHECK (barcode IS NULL OR (length(barcode) BETWEEN 1 AND 64 AND barcode NOT GLOB '*[^ -~]*')),
  color TEXT,
  storage_gb INTEGER CHECK (storage_gb IS NULL OR storage_gb > 0),
  ram_gb INTEGER CHECK (ram_gb IS NULL OR ram_gb > 0),
  condition TEXT NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'refurbished', 'used')),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  avg_cost INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  sale_price INTEGER NOT NULL CHECK (sale_price >= 0),
  min_sale_price INTEGER NOT NULL DEFAULT 0 CHECK (min_sale_price >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (min_sale_price <= sale_price)
) STRICT;

CREATE UNIQUE INDEX ux_product_variants_combination ON product_variants
  (product_id, coalesce(color, ''), coalesce(storage_gb, 0), coalesce(ram_gb, 0), condition);
CREATE INDEX idx_product_variants_product ON product_variants (product_id);

-- Unités physiques : une ligne par téléphone (IMEI) ou appareil (numéro de série).
CREATE TABLE serial_units (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  serial_number TEXT NOT NULL UNIQUE CHECK (length(trim(serial_number)) BETWEEN 1 AND 64),
  imei2 TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'reserved', 'sold', 'returned', 'defective')),
  receipt_line_id INTEGER REFERENCES goods_receipt_lines (id) ON DELETE RESTRICT,
  sale_line_id INTEGER REFERENCES sale_lines (id) ON DELETE RESTRICT,
  received_at TEXT CHECK (received_at IS NULL OR received_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  sold_at TEXT CHECK (sold_at IS NULL OR sold_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  warranty_end TEXT CHECK (warranty_end IS NULL OR (warranty_end GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND length(warranty_end) = 10)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (status <> 'sold' OR (sale_line_id IS NOT NULL AND sold_at IS NOT NULL)),
  CHECK (imei2 IS NULL OR imei2 <> serial_number)
) STRICT;

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
    AND (NOT (length(NEW.serial_number) = 15 AND NEW.serial_number NOT GLOB '*[^0-9]*' AND (CAST(substr(NEW.serial_number, 1, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 2, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 2, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 3, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 4, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 4, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 5, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 6, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 6, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 7, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 8, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 8, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 9, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 10, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 10, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 11, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 12, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 12, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 13, 1) AS INTEGER) + (2 * CAST(substr(NEW.serial_number, 14, 1) AS INTEGER) - 9 * (CAST(substr(NEW.serial_number, 14, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.serial_number, 15, 1) AS INTEGER)) % 10 = 0) OR (NEW.imei2 IS NOT NULL AND NOT (length(NEW.imei2) = 15 AND NEW.imei2 NOT GLOB '*[^0-9]*' AND (CAST(substr(NEW.imei2, 1, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 2, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 2, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 3, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 4, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 4, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 5, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 6, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 6, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 7, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 8, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 8, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 9, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 10, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 10, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 11, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 12, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 12, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 13, 1) AS INTEGER) + (2 * CAST(substr(NEW.imei2, 14, 1) AS INTEGER) - 9 * (CAST(substr(NEW.imei2, 14, 1) AS INTEGER) >= 5)) + CAST(substr(NEW.imei2, 15, 1) AS INTEGER)) % 10 = 0)));
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
CREATE TRIGGER trg_serial_units_status BEFORE UPDATE OF status ON serial_units
WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'SERIAL_NOT_AVAILABLE: cette unité n''est pas disponible à la vente')
  WHERE NEW.status = 'sold' AND OLD.status NOT IN ('in_stock', 'reserved');
  SELECT RAISE(ABORT, 'SERIAL_STATUS: changement d''état non autorisé')
  WHERE (OLD.status = 'sold' AND NEW.status NOT IN ('returned'))
     OR (OLD.status = 'returned' AND NEW.status NOT IN ('in_stock', 'defective'))
     OR (OLD.status = 'defective' AND NEW.status NOT IN ('in_stock', 'returned'))
     OR (OLD.status = 'reserved' AND NEW.status NOT IN ('in_stock', 'sold', 'defective'))
     OR (OLD.status = 'in_stock' AND NEW.status NOT IN ('reserved', 'sold', 'defective'));
END;

-- Attributs techniques configurables par catégorie (Wc, V, A, Ah, W, pouces...).
CREATE TABLE attribute_definitions (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 40 AND code NOT GLOB '*[^a-z0-9_]*'),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  value_type TEXT NOT NULL CHECK (value_type IN ('text', 'number', 'choice', 'boolean')),
  unit TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 16),
  choices TEXT CHECK (choices IS NULL OR (json_valid(choices) AND json_type(choices) = 'array')),
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  is_filterable INTEGER NOT NULL DEFAULT 0 CHECK (is_filterable IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  UNIQUE (category_id, code),
  CHECK ((value_type = 'choice') = (choices IS NOT NULL AND json_array_length(choices) > 0))
) STRICT;

CREATE TRIGGER trg_attribute_definitions_type_locked BEFORE UPDATE OF value_type, category_id ON attribute_definitions
WHEN (NEW.value_type IS NOT OLD.value_type OR NEW.category_id IS NOT OLD.category_id)
  AND EXISTS (SELECT 1 FROM product_attribute_values v WHERE v.attribute_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTE_LOCKED: le type ou la catégorie d''un attribut déjà renseigné ne change plus');
END;

CREATE TABLE product_attribute_values (
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions (id) ON DELETE RESTRICT,
  value_text TEXT CHECK (value_text IS NULL OR length(trim(value_text)) > 0),
  value_number REAL,
  PRIMARY KEY (product_id, attribute_id),
  CHECK ((value_text IS NULL) <> (value_number IS NULL))
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_product_attribute_values_number ON product_attribute_values (attribute_id, value_number);
CREATE INDEX idx_product_attribute_values_text ON product_attribute_values (attribute_id, value_text);

-- Valeur cohérente avec la définition, et attribut défini sur la catégorie du produit ou un ancêtre.
CREATE TRIGGER trg_product_attribute_values_insert BEFORE INSERT ON product_attribute_values
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTE_CATEGORY: cet attribut n''appartient pas à la catégorie du produit')
  -- Les ancêtres absents (NULL) sont écartés : « x NOT IN (..., NULL) » ne serait jamais vrai.
  WHERE (SELECT a.category_id FROM attribute_definitions a WHERE a.id = NEW.attribute_id) NOT IN (
    SELECT ancestor FROM (
      SELECT c.id AS ancestor FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = NEW.product_id
      UNION SELECT c.parent_id FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = NEW.product_id
      UNION SELECT pc.parent_id FROM products p JOIN categories c ON c.id = p.category_id
        JOIN categories pc ON pc.id = c.parent_id WHERE p.id = NEW.product_id
    ) WHERE ancestor IS NOT NULL
  );
  SELECT RAISE(ABORT, 'ATTRIBUTE_VALUE: valeur incompatible avec le type de l''attribut')
  FROM attribute_definitions a WHERE a.id = NEW.attribute_id AND (
       (a.value_type = 'number' AND NEW.value_number IS NULL)
    OR (a.value_type = 'boolean' AND (NEW.value_number IS NULL OR NEW.value_number NOT IN (0, 1)))
    OR (a.value_type IN ('text', 'choice') AND NEW.value_text IS NULL)
    OR (a.value_type = 'choice' AND NOT EXISTS (SELECT 1 FROM json_each(a.choices) j WHERE j.value = NEW.value_text))
  );
END;

CREATE TRIGGER trg_product_attribute_values_update BEFORE UPDATE ON product_attribute_values
BEGIN
  SELECT RAISE(ABORT, 'ATTRIBUTE_VALUE: modifier une valeur, pas son produit ni son attribut')
  WHERE NEW.product_id IS NOT OLD.product_id OR NEW.attribute_id IS NOT OLD.attribute_id;
  SELECT RAISE(ABORT, 'ATTRIBUTE_VALUE: valeur incompatible avec le type de l''attribut')
  FROM attribute_definitions a WHERE a.id = NEW.attribute_id AND (
       (a.value_type = 'number' AND NEW.value_number IS NULL)
    OR (a.value_type = 'boolean' AND (NEW.value_number IS NULL OR NEW.value_number NOT IN (0, 1)))
    OR (a.value_type IN ('text', 'choice') AND NEW.value_text IS NULL)
    OR (a.value_type = 'choice' AND NOT EXISTS (SELECT 1 FROM json_each(a.choices) j WHERE j.value = NEW.value_text))
  );
END;

-- Kits : produit composé, sans stock propre ; un kit ne contient ni lui-même ni un autre kit.
CREATE TABLE kit_components (
  id INTEGER PRIMARY KEY,
  kit_variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  component_variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]*Z'),
  created_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  UNIQUE (kit_variant_id, component_variant_id),
  CHECK (kit_variant_id <> component_variant_id)
) STRICT;

CREATE INDEX idx_kit_components_component ON kit_components (component_variant_id);

CREATE TRIGGER trg_kit_components_insert BEFORE INSERT ON kit_components
BEGIN
  SELECT RAISE(ABORT, 'KIT_PARENT: seule une variante de type kit a des composants')
  WHERE (SELECT p.product_type FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.kit_variant_id) IS NOT 'kit';
  SELECT RAISE(ABORT, 'KIT_NESTED: un kit ne peut pas contenir un autre kit')
  WHERE (SELECT p.product_type FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = NEW.component_variant_id) = 'kit';
END;

CREATE TRIGGER trg_kit_components_update BEFORE UPDATE OF kit_variant_id, component_variant_id ON kit_components
BEGIN
  SELECT RAISE(ABORT, 'KIT_COMPONENT_LOCKED: remplacer un composant, pas le modifier');
END;

-- Recherche plein texte instantanée (E.5) : une ligne par variante, sans accents, avec préfixes.
CREATE VIRTUAL TABLE products_fts USING fts5 (
  name, brand, model, sku, barcode, category,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE TRIGGER trg_products_fts_variant_insert AFTER INSERT ON product_variants
BEGIN
  INSERT INTO products_fts (rowid, name, brand, model, sku, barcode, category)
  SELECT NEW.id, p.name, coalesce(b.name, ''), coalesce(p.model, ''), NEW.sku, coalesce(NEW.barcode, ''), c.name
  FROM products p LEFT JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
  WHERE p.id = NEW.product_id;
END;

CREATE TRIGGER trg_products_fts_variant_update AFTER UPDATE OF sku, barcode, product_id ON product_variants
BEGIN
  DELETE FROM products_fts WHERE rowid = OLD.id;
  INSERT INTO products_fts (rowid, name, brand, model, sku, barcode, category)
  SELECT NEW.id, p.name, coalesce(b.name, ''), coalesce(p.model, ''), NEW.sku, coalesce(NEW.barcode, ''), c.name
  FROM products p LEFT JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id
  WHERE p.id = NEW.product_id;
END;

CREATE TRIGGER trg_products_fts_product_update AFTER UPDATE OF name, model, brand_id, category_id ON products
BEGIN
  DELETE FROM products_fts WHERE rowid IN (SELECT id FROM product_variants WHERE product_id = NEW.id);
  INSERT INTO products_fts (rowid, name, brand, model, sku, barcode, category)
  SELECT v.id, NEW.name, coalesce(b.name, ''), coalesce(NEW.model, ''), v.sku, coalesce(v.barcode, ''), c.name
  FROM product_variants v LEFT JOIN brands b ON b.id = NEW.brand_id JOIN categories c ON c.id = NEW.category_id
  WHERE v.product_id = NEW.id;
END;

CREATE TRIGGER trg_products_fts_brand_update AFTER UPDATE OF name ON brands
BEGIN
  UPDATE products_fts SET brand = NEW.name
  WHERE rowid IN (SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.brand_id = NEW.id);
END;

CREATE TRIGGER trg_products_fts_category_update AFTER UPDATE OF name ON categories
BEGIN
  UPDATE products_fts SET category = NEW.name
  WHERE rowid IN (SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.category_id = NEW.id);
END;

CREATE TRIGGER trg_brands_no_delete BEFORE DELETE ON brands
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: brands s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_categories_no_delete BEFORE DELETE ON categories
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: categories s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_tax_rates_no_delete BEFORE DELETE ON tax_rates
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: tax_rates s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_products_no_delete BEFORE DELETE ON products
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: products s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_product_variants_no_delete BEFORE DELETE ON product_variants
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: product_variants s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_serial_units_no_delete BEFORE DELETE ON serial_units
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: serial_units s''archive, ne se supprime pas');
END;
CREATE TRIGGER trg_attribute_definitions_no_delete BEFORE DELETE ON attribute_definitions
BEGIN
  SELECT RAISE(ABORT, 'NO_DELETE: attribute_definitions s''archive, ne se supprime pas');
END;
