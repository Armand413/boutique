-- 0010 : vues de ventes et de marges hors taxe, nettes des retours (accord du client, D64).
-- Les prix sont TTC (D51) : la TVA comprise est retirée ligne par ligne, avec le même arrondi
-- que la facture. Un retour est imputé à la vente d'origine (date de la vente). Aucune table
-- n'est modifiée ; les vues remplacées n'étaient lues par aucun service.

DROP VIEW v_sales_by_family;
DROP VIEW v_daily_sales;
DROP VIEW v_sales_margin;

-- Une ligne par article, service ou kit d'une vente terminée (les composants d'un kit portent
-- le coût du kit, pas son prix) : quantité, chiffre d'affaires TTC et HT, coût et marge, nets
-- des retours.
CREATE VIEW v_sale_lines_net AS
SELECT n.sale_line_id, n.sale_id, n.invoice_number, n.completed_at, n.day, n.user_id, n.customer_id,
       n.variant_id, n.product_id, n.brand_id, n.category_id, f.family_id, f.family_name,
       n.line_type, n.tax_rate, n.quantity, n.revenue_ttc,
       n.revenue_ttc - CAST(round(n.revenue_ttc * 1.0 * n.tax_rate / (10000 + n.tax_rate)) AS INTEGER) AS revenue,
       n.cost,
       n.revenue_ttc - CAST(round(n.revenue_ttc * 1.0 * n.tax_rate / (10000 + n.tax_rate)) AS INTEGER) - n.cost AS margin
FROM (
  SELECT l.id AS sale_line_id, l.sale_id, s.invoice_number, s.completed_at,
         date(s.completed_at, 'localtime') AS day, s.user_id, s.customer_id,
         l.variant_id, p.id AS product_id, p.brand_id, p.category_id, l.line_type, l.tax_rate,
         l.quantity - coalesce((SELECT sum(r.quantity) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS quantity,
         l.line_total - coalesce((SELECT sum(r.amount) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0) AS revenue_ttc,
         CASE WHEN l.line_type = 'kit' THEN
           CAST(round(coalesce((SELECT sum(c.quantity * c.unit_cost) FROM sale_lines c WHERE c.parent_line_id = l.id), 0) * 1.0
             * (l.quantity - coalesce((SELECT sum(r.quantity) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0))
             / l.quantity) AS INTEGER)
         ELSE
           (l.quantity - coalesce((SELECT sum(r.quantity) FROM sale_return_lines r WHERE r.sale_line_id = l.id), 0)) * l.unit_cost
         END AS cost
  FROM sales s
  JOIN sale_lines l ON l.sale_id = s.id
  JOIN product_variants v ON v.id = l.variant_id
  JOIN products p ON p.id = v.product_id
  WHERE s.status = 'completed' AND l.line_type <> 'kit_component'
) n
JOIN v_category_families f ON f.category_id = n.category_id;

-- Marge par vente terminée (réservée aux rôles qui voient les coûts, contrôle dans les services).
CREATE VIEW v_sales_margin AS
SELECT n.sale_id, n.invoice_number, n.completed_at, n.user_id, n.customer_id,
       sum(n.revenue) AS revenue, sum(n.cost) AS cost, sum(n.margin) AS margin
FROM v_sale_lines_net n
GROUP BY n.sale_id;

-- Jour en heure locale du poste (dates stockées en UTC).
CREATE VIEW v_daily_sales AS
SELECT n.day, count(DISTINCT n.sale_id) AS sales_count,
       sum(n.revenue) AS revenue, sum(n.cost) AS cost, sum(n.margin) AS margin
FROM v_sale_lines_net n
GROUP BY n.day;

CREATE VIEW v_sales_by_family AS
SELECT n.day, n.family_id, n.family_name, sum(n.revenue) AS revenue, sum(n.cost) AS cost,
       sum(n.margin) AS margin, sum(n.quantity) AS quantity
FROM v_sale_lines_net n
GROUP BY n.day, n.family_id;

-- Rapports par période : les ventes terminées se lisent par date de validation.
CREATE INDEX idx_sales_completed ON sales (completed_at) WHERE status = 'completed';
CREATE INDEX idx_stock_movements_type ON stock_movements (movement_type, created_at);
