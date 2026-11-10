-- 0006 : vues de lecture (E.6). Les vues de coûts et de marges ne sont servies qu'aux rôles
-- qui ont la permission cost.view : le contrôle est fait par les services métier.

-- Famille (catégorie de premier niveau) de chaque catégorie ; trois niveaux au maximum.
CREATE VIEW v_category_families AS
SELECT c.id AS category_id,
       coalesce(gp.id, p.id, c.id) AS family_id,
       coalesce(gp.name, p.name, c.name) AS family_name
FROM categories c
LEFT JOIN categories p ON p.id = c.parent_id
LEFT JOIN categories gp ON gp.id = p.parent_id;

CREATE VIEW v_stock_by_location AS
SELECT l.variant_id, l.location_id, sl.name AS location_name, l.quantity,
       v.sku, p.id AS product_id, p.name AS product_name, b.name AS brand_name,
       f.family_id, f.family_name, v.avg_cost, l.quantity * v.avg_cost AS stock_value
FROM stock_levels l
JOIN stock_locations sl ON sl.id = l.location_id
JOIN product_variants v ON v.id = l.variant_id
JOIN products p ON p.id = v.product_id
LEFT JOIN brands b ON b.id = p.brand_id
JOIN v_category_families f ON f.category_id = p.category_id;

CREATE VIEW v_stock_overview AS
SELECT v.id AS variant_id, v.sku, p.id AS product_id, p.name AS product_name, p.product_type,
       b.name AS brand_name, c.name AS category_name, f.family_id, f.family_name,
       p.reorder_level, coalesce(sum(l.quantity), 0) AS quantity, v.avg_cost,
       coalesce(sum(l.quantity), 0) * v.avg_cost AS stock_value
FROM product_variants v
JOIN products p ON p.id = v.product_id
LEFT JOIN brands b ON b.id = p.brand_id
JOIN categories c ON c.id = p.category_id
JOIN v_category_families f ON f.category_id = p.category_id
LEFT JOIN stock_levels l ON l.variant_id = v.id
WHERE p.is_stocked = 1
GROUP BY v.id;

CREATE VIEW v_low_stock AS
SELECT o.variant_id, o.sku, o.product_name, o.brand_name, o.family_name, o.quantity, o.reorder_level
FROM v_stock_overview o
JOIN product_variants v ON v.id = o.variant_id
JOIN products p ON p.id = v.product_id
WHERE v.is_active = 1 AND p.is_active = 1 AND o.reorder_level > 0 AND o.quantity <= o.reorder_level;

-- Écart entre le stock courant et la somme des mouvements : doit toujours être vide (E.8).
CREATE VIEW v_stock_discrepancies AS
SELECT m.variant_id, m.location_id, sum(m.quantity_delta) AS movements_total,
       coalesce(l.quantity, 0) AS level_quantity
FROM stock_movements m
LEFT JOIN stock_levels l ON l.variant_id = m.variant_id AND l.location_id = m.location_id
GROUP BY m.variant_id, m.location_id
HAVING sum(m.quantity_delta) <> coalesce(l.quantity, 0)
UNION ALL
SELECT l.variant_id, l.location_id, 0, l.quantity
FROM stock_levels l
WHERE NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.variant_id = l.variant_id AND m.location_id = l.location_id);

-- Marge par vente terminée : chiffre d'affaires hors taxe et coût figé des lignes
-- (la ligne de kit n'a pas de coût propre : ce sont ses composants qui le portent).
CREATE VIEW v_sales_margin AS
SELECT s.id AS sale_id, s.invoice_number, s.completed_at, s.user_id, s.customer_id,
       s.subtotal - s.discount_total AS revenue,
       coalesce((SELECT sum(l.quantity * l.unit_cost) FROM sale_lines l
                 WHERE l.sale_id = s.id AND l.line_type <> 'kit'), 0) AS cost,
       s.subtotal - s.discount_total
         - coalesce((SELECT sum(l.quantity * l.unit_cost) FROM sale_lines l
                     WHERE l.sale_id = s.id AND l.line_type <> 'kit'), 0) AS margin
FROM sales s
WHERE s.status = 'completed';

-- Solde dû par client : ventes terminées moins paiements reçus et avoirs accordés.
CREATE VIEW v_customer_balances AS
SELECT c.id AS customer_id, c.full_name, c.credit_limit,
       coalesce((SELECT sum(s.total) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
     - coalesce((SELECT sum(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
                 WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
     - coalesce((SELECT sum(r.refund_amount) FROM sale_returns r JOIN sales s ON s.id = r.sale_id
                 WHERE s.customer_id = c.id AND r.refund_method = 'credit_note'), 0) AS balance
FROM customers c;

CREATE VIEW v_supplier_balances AS
SELECT sp.id AS supplier_id, sp.name,
       coalesce((SELECT sum(r.total_cost) FROM goods_receipts r
                 WHERE r.supplier_id = sp.id AND r.status = 'validated'), 0)
     - coalesce((SELECT sum(p.amount) FROM supplier_payments p WHERE p.supplier_id = sp.id), 0) AS balance
FROM suppliers sp;

CREATE VIEW v_cash_session_summary AS
SELECT cs.id AS cash_session_id, cs.status, cs.opened_at, cs.closed_at, cs.opening_float,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'cash'), 0) AS cash_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'card'), 0) AS card_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'mobile_money'), 0) AS mobile_money_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'transfer'), 0) AS transfer_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'cheque'), 0) AS cheque_in,
       coalesce((SELECT sum(m.amount) FROM cash_movements m WHERE m.cash_session_id = cs.id AND m.direction = 'in'), 0) AS cash_movements_in,
       coalesce((SELECT sum(m.amount) FROM cash_movements m WHERE m.cash_session_id = cs.id AND m.direction = 'out'), 0) AS cash_movements_out,
       coalesce((SELECT sum(r.refund_amount) FROM sale_returns r WHERE r.cash_session_id = cs.id AND r.refund_method = 'cash'), 0) AS cash_refunds
FROM cash_sessions cs;

-- Jour en heure locale du poste (dates stockées en UTC).
CREATE VIEW v_daily_sales AS
SELECT date(m.completed_at, 'localtime') AS day, count(*) AS sales_count,
       sum(m.revenue) AS revenue, sum(m.cost) AS cost, sum(m.margin) AS margin
FROM v_sales_margin m
GROUP BY date(m.completed_at, 'localtime');

CREATE VIEW v_sales_by_family AS
SELECT date(s.completed_at, 'localtime') AS day, f.family_id, f.family_name,
       sum(CASE WHEN l.line_type <> 'kit_component' THEN l.line_total ELSE 0 END) AS revenue,
       sum(CASE WHEN l.line_type <> 'kit' THEN l.quantity * l.unit_cost ELSE 0 END) AS cost,
       sum(CASE WHEN l.line_type <> 'kit_component' THEN l.quantity ELSE 0 END) AS quantity
FROM sale_lines l
JOIN sales s ON s.id = l.sale_id AND s.status = 'completed'
JOIN product_variants v ON v.id = l.variant_id
JOIN products p ON p.id = v.product_id
JOIN v_category_families f ON f.category_id = p.category_id
GROUP BY date(s.completed_at, 'localtime'), f.family_id;

CREATE VIEW v_overdue_installments AS
SELECT i.id AS installment_id, i.sale_id, s.invoice_number, s.customer_id, c.full_name, c.phone,
       i.due_date, i.amount, i.paid_amount, i.amount - i.paid_amount AS remaining,
       CAST(julianday(date('now', 'localtime')) - julianday(i.due_date) AS INTEGER) AS days_overdue
FROM sale_installments i
JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
LEFT JOIN customers c ON c.id = s.customer_id
WHERE i.paid_amount < i.amount AND i.due_date < date('now', 'localtime');

CREATE VIEW v_open_quotes AS
SELECT q.id AS quote_id, q.number, q.customer_id, c.full_name, q.status, q.valid_until, q.total, q.reserve_stock,
       CAST(julianday(q.valid_until) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
FROM quotes q
LEFT JOIN customers c ON c.id = q.customer_id
WHERE q.status IN ('draft', 'sent', 'accepted') AND q.valid_until >= date('now', 'localtime');

CREATE VIEW v_warranty_expiring AS
SELECT u.id AS serial_unit_id, u.serial_number, u.warranty_end, v.sku, p.name AS product_name,
       l.sale_id, s.invoice_number, s.customer_id, c.full_name, c.phone,
       CAST(julianday(u.warranty_end) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
FROM serial_units u
JOIN product_variants v ON v.id = u.variant_id
JOIN products p ON p.id = v.product_id
LEFT JOIN sale_lines l ON l.id = u.sale_line_id
LEFT JOIN sales s ON s.id = l.sale_id
LEFT JOIN customers c ON c.id = s.customer_id
WHERE u.status = 'sold' AND u.warranty_end IS NOT NULL
  AND u.warranty_end BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+30 days');
