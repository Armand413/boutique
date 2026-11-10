-- 0004 : clients, caisse, ventes, paiements, retours, devis, échéanciers et livraisons.

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  phone TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 3 AND 32),
  address TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 {{BOOL is_active}},
  -- Anonymisation sur demande (B.3) : les ventes restent, les données personnelles disparaissent.
  anonymized_at TEXT {{ISO_NULL anonymized_at}},
  {{STD}},
  CHECK (anonymized_at IS NULL OR (phone IS NULL AND address IS NULL AND notes IS NULL))
) STRICT;

CREATE UNIQUE INDEX ux_customers_phone ON customers (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_customers_full_name ON customers (full_name COLLATE NOCASE);

CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY,
  opened_by INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  opened_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO opened_at}},
  opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
  closed_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  closed_at TEXT {{ISO_NULL closed_at}},
  expected_amount INTEGER,
  counted_amount INTEGER CHECK (counted_amount IS NULL OR counted_amount >= 0),
  difference INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  CHECK ((status = 'closed') = (closed_by IS NOT NULL AND closed_at IS NOT NULL
    AND expected_amount IS NOT NULL AND counted_amount IS NOT NULL AND difference IS NOT NULL)),
  CHECK (difference IS NULL OR difference = counted_amount - expected_amount)
) STRICT;

-- Une seule session de caisse ouverte à la fois (application mono-poste).
CREATE UNIQUE INDEX ux_cash_sessions_open ON cash_sessions (status) WHERE status = 'open';

CREATE TRIGGER trg_cash_sessions_closed BEFORE UPDATE ON cash_sessions
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'CASH_SESSION_CLOSED: une session de caisse clôturée ne se modifie plus');
END;

CREATE TABLE cash_movements (
  id INTEGER PRIMARY KEY,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}}
) STRICT;

CREATE INDEX idx_cash_movements_session ON cash_movements (cash_session_id);

CREATE TRIGGER trg_cash_movements_open_session BEFORE INSERT ON cash_movements
BEGIN
  SELECT RAISE(ABORT, 'CASH_SESSION_CLOSED: la session de caisse est clôturée')
  WHERE (SELECT s.status FROM cash_sessions s WHERE s.id = NEW.cash_session_id) IS NOT 'open';
END;

{{IMMUTABLE cash_movements}}

-- Numérotation des factures sans trou : incrément de 1, dans la transaction de la vente.
CREATE TABLE invoice_sequences (
  year INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 9999),
  last_number INTEGER NOT NULL CHECK (last_number >= 0)
) STRICT;

CREATE TRIGGER trg_invoice_sequences_increment BEFORE UPDATE ON invoice_sequences
BEGIN
  SELECT RAISE(ABORT, 'INVOICE_SEQUENCE: la numérotation avance de un en un, sans trou')
  WHERE NEW.year IS NOT OLD.year OR NEW.last_number IS NOT OLD.last_number + 1;
END;

CREATE TRIGGER trg_invoice_sequences_no_delete BEFORE DELETE ON invoice_sequences
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE: invoice_sequences');
END;

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (length(number) BETWEEN 1 AND 32),
  customer_id INTEGER REFERENCES customers (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'converted')),
  valid_until TEXT NOT NULL {{DATE valid_until}},
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  reserve_stock INTEGER NOT NULL DEFAULT 0 {{BOOL reserve_stock}},
  notes TEXT,
  converted_sale_id INTEGER REFERENCES sales (id) ON DELETE RESTRICT,
  {{STD}},
  CHECK (total = subtotal - discount_total + tax_total),
  CHECK (discount_total <= subtotal),
  CHECK ((status = 'converted') = (converted_sale_id IS NOT NULL))
) STRICT;

CREATE INDEX idx_quotes_customer ON quotes (customer_id);
CREATE INDEX idx_quotes_status_valid ON quotes (status, valid_until);

CREATE TRIGGER trg_quotes_converted BEFORE UPDATE ON quotes
WHEN OLD.status = 'converted'
BEGIN
  SELECT RAISE(ABORT, 'QUOTE_LOCKED: un devis converti en vente est figé');
END;

CREATE TABLE quote_lines (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes (id) ON DELETE RESTRICT,
  variant_id INTEGER REFERENCES product_variants (id) ON DELETE RESTRICT,
  -- Unité réservée par le devis (articles suivis, si reserve_stock = 1).
  serial_unit_id INTEGER REFERENCES serial_units (id) ON DELETE RESTRICT,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 10000),
  line_total INTEGER NOT NULL,
  CHECK (discount <= quantity * unit_price),
  CHECK (line_total = quantity * unit_price - discount),
  CHECK (serial_unit_id IS NULL OR (variant_id IS NOT NULL AND quantity = 1))
) STRICT;

CREATE INDEX idx_quote_lines_quote ON quote_lines (quote_id);

CREATE TRIGGER trg_quote_lines_insert BEFORE INSERT ON quote_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTE_LOCKED: seul un devis en préparation ou envoyé se modifie')
  WHERE (SELECT q.status FROM quotes q WHERE q.id = NEW.quote_id) NOT IN ('draft', 'sent');
END;

CREATE TRIGGER trg_quote_lines_update BEFORE UPDATE ON quote_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTE_LOCKED: seul un devis en préparation ou envoyé se modifie')
  WHERE (SELECT q.status FROM quotes q WHERE q.id = OLD.quote_id) NOT IN ('draft', 'sent')
     OR NEW.quote_id IS NOT OLD.quote_id;
END;

CREATE TRIGGER trg_quote_lines_delete BEFORE DELETE ON quote_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTE_LOCKED: seul un devis en préparation ou envoyé se modifie')
  WHERE (SELECT q.status FROM quotes q WHERE q.id = OLD.quote_id) NOT IN ('draft', 'sent');
END;

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  invoice_number TEXT UNIQUE CHECK (invoice_number IS NULL OR length(invoice_number) BETWEEN 1 AND 32),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'completed', 'cancelled')),
  customer_id INTEGER REFERENCES customers (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  cash_session_id INTEGER REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  quote_id INTEGER REFERENCES quotes (id) ON DELETE RESTRICT,
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date TEXT {{DATE_NULL due_date}},
  delivery_required INTEGER NOT NULL DEFAULT 0 {{BOOL delivery_required}},
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}},
  updated_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO updated_at}},
  completed_at TEXT {{ISO_NULL completed_at}},
  cancelled_at TEXT {{ISO_NULL cancelled_at}},
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (total = subtotal - discount_total + tax_total),
  CHECK (discount_total <= subtotal),
  CHECK (amount_paid <= total),
  CHECK (status = 'held' OR (invoice_number IS NOT NULL AND completed_at IS NOT NULL AND cash_session_id IS NOT NULL)),
  CHECK (status <> 'held' OR invoice_number IS NULL),
  -- Vente à crédit : client et date d'échéance obligatoires.
  CHECK (status = 'held' OR amount_paid = total OR (customer_id IS NOT NULL AND due_date IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
    AND length(trim(coalesce(cancel_reason, ''))) > 0))
) STRICT;

CREATE INDEX idx_sales_created ON sales (created_at);
CREATE INDEX idx_sales_customer ON sales (customer_id);
CREATE INDEX idx_sales_user ON sales (user_id);
CREATE INDEX idx_sales_status ON sales (status);
CREATE INDEX idx_sales_due_date ON sales (due_date);
CREATE INDEX idx_sales_cash_session ON sales (cash_session_id);

-- Une vente terminée est figée ; seule son annulation (motif obligatoire) reste possible.
CREATE TRIGGER trg_sales_locked BEFORE UPDATE ON sales
WHEN OLD.status <> 'held'
BEGIN
  SELECT RAISE(ABORT, 'SALE_LOCKED: une vente terminée ou annulée ne se modifie plus')
  WHERE OLD.status = 'cancelled'
     OR NEW.status <> 'cancelled'
     OR NEW.invoice_number IS NOT OLD.invoice_number OR NEW.customer_id IS NOT OLD.customer_id
     OR NEW.user_id IS NOT OLD.user_id OR NEW.cash_session_id IS NOT OLD.cash_session_id
     OR NEW.quote_id IS NOT OLD.quote_id OR NEW.subtotal IS NOT OLD.subtotal
     OR NEW.discount_total IS NOT OLD.discount_total OR NEW.tax_total IS NOT OLD.tax_total
     OR NEW.total IS NOT OLD.total OR NEW.amount_paid IS NOT OLD.amount_paid
     OR NEW.due_date IS NOT OLD.due_date OR NEW.delivery_required IS NOT OLD.delivery_required
     OR NEW.created_at IS NOT OLD.created_at OR NEW.completed_at IS NOT OLD.completed_at;
END;

-- Totaux cohérents à la validation : lignes = sous-total, paiements = montant payé.
CREATE TRIGGER trg_sales_complete BEFORE UPDATE OF status ON sales
WHEN OLD.status = 'held' AND NEW.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'SALE_EMPTY: une vente sans ligne ne peut pas être validée')
  WHERE NOT EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = NEW.id);
  SELECT RAISE(ABORT, 'SALE_TOTALS: le sous-total ne correspond pas aux lignes')
  WHERE NEW.subtotal IS NOT (SELECT sum(l.quantity * l.unit_price) FROM sale_lines l
                             WHERE l.sale_id = NEW.id AND l.line_type <> 'kit_component')
     OR NEW.discount_total IS NOT (SELECT sum(l.discount) FROM sale_lines l
                                   WHERE l.sale_id = NEW.id AND l.line_type <> 'kit_component');
  SELECT RAISE(ABORT, 'SALE_PAYMENTS: le montant payé ne correspond pas aux paiements')
  WHERE NEW.amount_paid IS NOT coalesce((SELECT sum(p.amount) FROM payments p WHERE p.sale_id = NEW.id), 0);
  SELECT RAISE(ABORT, 'SALE_SERIAL_REQUIRED: chaque article suivi doit porter son unité')
  WHERE EXISTS (SELECT 1 FROM sale_lines l JOIN product_variants v ON v.id = l.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE l.sale_id = NEW.id AND p.tracking_mode <> 'none' AND l.serial_unit_id IS NULL);
  SELECT RAISE(ABORT, 'SALE_CREDIT_LIMIT: plafond de crédit du client dépassé')
  WHERE NEW.amount_paid < NEW.total AND NEW.customer_id IS NOT NULL
    AND (SELECT c.credit_limit FROM customers c WHERE c.id = NEW.customer_id)
        < coalesce((SELECT b.balance FROM v_customer_balances b WHERE b.customer_id = NEW.customer_id), 0)
          + NEW.total - NEW.amount_paid;
END;

CREATE TABLE sale_lines (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  variant_id INTEGER NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  serial_unit_id INTEGER REFERENCES serial_units (id) ON DELETE RESTRICT,
  parent_line_id INTEGER REFERENCES sale_lines (id) ON DELETE RESTRICT,
  line_type TEXT NOT NULL DEFAULT 'item' CHECK (line_type IN ('item', 'kit', 'kit_component', 'service')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- Prix, coût et taxe figés au moment de la vente.
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 10000),
  line_total INTEGER NOT NULL,
  CHECK (discount <= quantity * unit_price),
  CHECK (line_total = quantity * unit_price - discount),
  CHECK (serial_unit_id IS NULL OR quantity = 1),
  CHECK ((line_type = 'kit_component') = (parent_line_id IS NOT NULL)),
  -- Un composant de kit est valorisé dans la ligne du kit.
  CHECK (line_type <> 'kit_component' OR (unit_price = 0 AND discount = 0))
) STRICT;

CREATE INDEX idx_sale_lines_sale ON sale_lines (sale_id);
CREATE INDEX idx_sale_lines_variant ON sale_lines (variant_id);
CREATE INDEX idx_sale_lines_parent ON sale_lines (parent_line_id);
CREATE INDEX idx_sale_lines_serial ON sale_lines (serial_unit_id);

CREATE TRIGGER trg_sale_lines_insert BEFORE INSERT ON sale_lines
BEGIN
  SELECT RAISE(ABORT, 'SALE_LOCKED: une vente terminée ou annulée ne se modifie plus')
  WHERE (SELECT s.status FROM sales s WHERE s.id = NEW.sale_id) IS NOT 'held';
  SELECT RAISE(ABORT, 'SALE_LINE_TYPE: type de ligne incompatible avec le produit')
  FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = NEW.variant_id AND (
       (NEW.line_type = 'kit') <> (p.product_type = 'kit')
    OR (NEW.line_type = 'service') <> (p.product_type = 'service' AND NEW.line_type <> 'kit_component')
    OR (NEW.line_type = 'kit_component' AND p.product_type = 'kit')
  );
  SELECT RAISE(ABORT, 'SALE_KIT_PARENT: un composant référence une ligne de kit de la même vente')
  WHERE NEW.parent_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sale_lines k WHERE k.id = NEW.parent_line_id AND k.sale_id = NEW.sale_id AND k.line_type = 'kit');
  SELECT RAISE(ABORT, 'SALE_SERIAL_MISMATCH: l''unité n''appartient pas à cette variante')
  WHERE NEW.serial_unit_id IS NOT NULL
    AND (SELECT s.variant_id FROM serial_units s WHERE s.id = NEW.serial_unit_id) IS NOT NEW.variant_id;
  SELECT RAISE(ABORT, 'SERIAL_NOT_AVAILABLE: cette unité n''est pas disponible à la vente')
  WHERE NEW.serial_unit_id IS NOT NULL
    AND (SELECT s.status FROM serial_units s WHERE s.id = NEW.serial_unit_id) NOT IN ('in_stock', 'reserved');
  SELECT RAISE(ABORT, 'SERIAL_DUPLICATE: cette unité est déjà dans la vente')
  WHERE NEW.serial_unit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM sale_lines l WHERE l.sale_id = NEW.sale_id AND l.serial_unit_id = NEW.serial_unit_id);
END;

CREATE TRIGGER trg_sale_lines_update BEFORE UPDATE ON sale_lines
BEGIN
  SELECT RAISE(ABORT, 'SALE_LOCKED: une vente terminée ou annulée ne se modifie plus')
  WHERE (SELECT s.status FROM sales s WHERE s.id = OLD.sale_id) IS NOT 'held'
     OR NEW.sale_id IS NOT OLD.sale_id OR NEW.variant_id IS NOT OLD.variant_id
     OR NEW.serial_unit_id IS NOT OLD.serial_unit_id OR NEW.line_type IS NOT OLD.line_type
     OR NEW.parent_line_id IS NOT OLD.parent_line_id;
END;

CREATE TRIGGER trg_sale_lines_delete BEFORE DELETE ON sale_lines
BEGIN
  SELECT RAISE(ABORT, 'SALE_LOCKED: une vente terminée ou annulée ne se modifie plus')
  WHERE (SELECT s.status FROM sales s WHERE s.id = OLD.sale_id) IS NOT 'held';
END;

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  installment_id INTEGER REFERENCES sale_installments (id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'mobile_money', 'transfer', 'cheque')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT,
  cash_session_id INTEGER REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  paid_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO paid_at}},
  CHECK (method <> 'cash' OR cash_session_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_payments_sale ON payments (sale_id);
CREATE INDEX idx_payments_session_method ON payments (cash_session_id, method);
CREATE INDEX idx_payments_installment ON payments (installment_id);

CREATE TRIGGER trg_payments_insert BEFORE INSERT ON payments
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_CANCELLED_SALE: aucun paiement sur une vente annulée')
  WHERE (SELECT s.status FROM sales s WHERE s.id = NEW.sale_id) = 'cancelled';
  SELECT RAISE(ABORT, 'PAYMENT_EXCEEDS_TOTAL: le paiement dépasse le reste à payer')
  WHERE coalesce((SELECT sum(p.amount) FROM payments p WHERE p.sale_id = NEW.sale_id), 0) + NEW.amount
        > (SELECT s.total FROM sales s WHERE s.id = NEW.sale_id);
  SELECT RAISE(ABORT, 'PAYMENT_INSTALLMENT: l''échéance n''appartient pas à cette vente')
  WHERE NEW.installment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sale_installments i WHERE i.id = NEW.installment_id AND i.sale_id = NEW.sale_id);
  SELECT RAISE(ABORT, 'CASH_SESSION_CLOSED: la session de caisse est clôturée')
  WHERE NEW.cash_session_id IS NOT NULL
    AND (SELECT c.status FROM cash_sessions c WHERE c.id = NEW.cash_session_id) IS NOT 'open';
END;

{{IMMUTABLE payments}}

CREATE TABLE sale_returns (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (length(number) BETWEEN 1 AND 32),
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  refund_amount INTEGER NOT NULL CHECK (refund_amount >= 0),
  refund_method TEXT CHECK (refund_method IS NULL OR refund_method IN
    ('cash', 'card', 'mobile_money', 'transfer', 'cheque', 'credit_note')),
  cash_session_id INTEGER REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}},
  CHECK (refund_amount = 0 OR refund_method IS NOT NULL),
  CHECK (refund_method IS NOT 'cash' OR cash_session_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_sale_returns_sale ON sale_returns (sale_id);

CREATE TRIGGER trg_sale_returns_insert BEFORE INSERT ON sale_returns
BEGIN
  SELECT RAISE(ABORT, 'RETURN_SALE_STATUS: seul un article d''une vente terminée peut être retourné')
  WHERE (SELECT s.status FROM sales s WHERE s.id = NEW.sale_id) IS NOT 'completed';
END;

{{IMMUTABLE sale_returns}}

CREATE TABLE sale_return_lines (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES sale_returns (id) ON DELETE RESTRICT,
  sale_line_id INTEGER NOT NULL REFERENCES sale_lines (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  restock INTEGER NOT NULL DEFAULT 1 {{BOOL restock}},
  amount INTEGER NOT NULL CHECK (amount >= 0)
) STRICT;

CREATE INDEX idx_sale_return_lines_return ON sale_return_lines (return_id);
CREATE INDEX idx_sale_return_lines_sale_line ON sale_return_lines (sale_line_id);

CREATE TRIGGER trg_sale_return_lines_insert BEFORE INSERT ON sale_return_lines
BEGIN
  SELECT RAISE(ABORT, 'RETURN_LINE_SALE: la ligne n''appartient pas à la vente retournée')
  WHERE (SELECT l.sale_id FROM sale_lines l WHERE l.id = NEW.sale_line_id)
        IS NOT (SELECT r.sale_id FROM sale_returns r WHERE r.id = NEW.return_id);
  SELECT RAISE(ABORT, 'RETURN_EXCEEDS_SOLD: quantité retournée supérieure à la quantité vendue')
  WHERE coalesce((SELECT sum(rl.quantity) FROM sale_return_lines rl WHERE rl.sale_line_id = NEW.sale_line_id), 0)
        + NEW.quantity > (SELECT l.quantity FROM sale_lines l WHERE l.id = NEW.sale_line_id);
  SELECT RAISE(ABORT, 'RETURN_EXCEEDS_AMOUNT: montant retourné supérieur au montant de la ligne')
  WHERE coalesce((SELECT sum(rl.amount) FROM sale_return_lines rl WHERE rl.sale_line_id = NEW.sale_line_id), 0)
        + NEW.amount > (SELECT l.line_total FROM sale_lines l WHERE l.id = NEW.sale_line_id);
END;

{{IMMUTABLE sale_return_lines}}

CREATE TABLE sale_installments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  due_date TEXT NOT NULL {{DATE due_date}},
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  -- « overdue » est calculé par la vue v_overdue_installments à partir de due_date.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue')),
  {{STD}},
  CHECK (paid_amount <= amount),
  CHECK ((status = 'paid') = (paid_amount = amount)),
  CHECK (status <> 'partial' OR paid_amount > 0),
  CHECK (status <> 'pending' OR paid_amount = 0)
) STRICT;

CREATE INDEX idx_sale_installments_status_due ON sale_installments (status, due_date);
CREATE INDEX idx_sale_installments_sale ON sale_installments (sale_id);

CREATE TRIGGER trg_sale_installments_insert BEFORE INSERT ON sale_installments
BEGIN
  SELECT RAISE(ABORT, 'INSTALLMENT_SALE: un échéancier porte sur une vente terminée à crédit')
  WHERE (SELECT s.status FROM sales s WHERE s.id = NEW.sale_id) IS NOT 'completed'
     OR (SELECT s.total - s.amount_paid FROM sales s WHERE s.id = NEW.sale_id) <= 0;
  SELECT RAISE(ABORT, 'INSTALLMENT_EXCEEDS_DUE: la somme des échéances dépasse le solde dû')
  WHERE coalesce((SELECT sum(i.amount) FROM sale_installments i WHERE i.sale_id = NEW.sale_id), 0) + NEW.amount
        > (SELECT s.total - s.amount_paid FROM sales s WHERE s.id = NEW.sale_id);
END;

CREATE TRIGGER trg_sale_installments_update BEFORE UPDATE ON sale_installments
BEGIN
  SELECT RAISE(ABORT, 'INSTALLMENT_LOCKED: seul le montant réglé d''une échéance évolue, à la hausse')
  WHERE NEW.sale_id IS NOT OLD.sale_id OR NEW.amount IS NOT OLD.amount OR NEW.due_date IS NOT OLD.due_date
     OR NEW.paid_amount < OLD.paid_amount;
END;

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  address TEXT NOT NULL CHECK (length(trim(address)) > 0),
  status TEXT NOT NULL DEFAULT 'to_deliver' CHECK (status IN ('to_deliver', 'delivered', 'cancelled')),
  scheduled_at TEXT {{ISO_NULL scheduled_at}},
  delivered_at TEXT {{ISO_NULL delivered_at}},
  delivered_by INTEGER REFERENCES users (id) ON DELETE RESTRICT,
  notes TEXT,
  {{STD}},
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL))
) STRICT;

CREATE INDEX idx_deliveries_status_scheduled ON deliveries (status, scheduled_at);
CREATE INDEX idx_deliveries_sale ON deliveries (sale_id);

CREATE TRIGGER trg_deliveries_final BEFORE UPDATE ON deliveries
WHEN OLD.status <> 'to_deliver'
BEGIN
  SELECT RAISE(ABORT, 'DELIVERY_LOCKED: une livraison faite ou annulée ne se modifie plus');
END;

{{NO_DELETE customers}}
{{NO_DELETE cash_sessions}}
{{NO_DELETE quotes}}
{{NO_DELETE sales}}
{{NO_DELETE sale_installments}}
{{NO_DELETE deliveries}}
