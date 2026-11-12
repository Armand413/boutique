-- Migration 0011 : index des clés étrangères consultées par les écrans et les services (phase 9).
-- Mesuré au test de charge : la fiche d'une entrée de marchandise relisait toute la table des
-- unités suivies pour chaque ligne (2 à 3 ms par ligne à 20 000 produits). Index partiels : les
-- colonnes concernées sont le plus souvent vides, et `colonne = ?` les utilise.

CREATE INDEX idx_serial_units_receipt_line ON serial_units (receipt_line_id) WHERE receipt_line_id IS NOT NULL;
CREATE INDEX idx_serial_units_sale_line ON serial_units (sale_line_id) WHERE sale_line_id IS NOT NULL;
CREATE INDEX idx_stock_movements_serial_unit ON stock_movements (serial_unit_id, id) WHERE serial_unit_id IS NOT NULL;
CREATE INDEX idx_quote_lines_serial_unit ON quote_lines (serial_unit_id) WHERE serial_unit_id IS NOT NULL;
CREATE INDEX idx_supplier_payments_receipt ON supplier_payments (receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX idx_quotes_converted_sale ON quotes (converted_sale_id) WHERE converted_sale_id IS NOT NULL;
CREATE INDEX idx_sales_quote ON sales (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX idx_warranty_claims_sale ON warranty_claims (sale_id) WHERE sale_id IS NOT NULL;
