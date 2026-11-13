-- 0014 : moyens de paiement de la boutique (accord du client, D94) : espèces, Orange Money, Moov Money,
-- Telecel Money et Wave. SQLite ne modifie pas un CHECK : les tables payments, supplier_payments et
-- sale_returns sont recréées à l'identique (méthode de 0007), avec les nouveaux moyens. Les anciens
-- (carte, mobile money, virement, chèque) restent acceptés par la base pour l'historique ; l'application
-- ne les propose plus. Le résumé de caisse gagne une colonne par nouveau moyen.

PRAGMA defer_foreign_keys = ON;

DROP VIEW v_cash_session_summary;

-- payments
CREATE TABLE payments_copy AS SELECT * FROM payments;
DROP TRIGGER trg_payments_insert;
DROP TRIGGER trg_payments_no_update;
DROP TRIGGER trg_payments_no_delete;
DROP TABLE payments;

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  installment_id INTEGER REFERENCES sale_installments (id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash', 'orange_money', 'moov_money', 'telecel_money', 'wave',
                                     'card', 'mobile_money', 'transfer', 'cheque')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT,
  cash_session_id INTEGER REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  paid_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO paid_at}},
  CHECK (method <> 'cash' OR cash_session_id IS NOT NULL)
) STRICT;

INSERT INTO payments SELECT * FROM payments_copy;
DROP TABLE payments_copy;

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

-- supplier_payments
CREATE TABLE supplier_payments_copy AS SELECT * FROM supplier_payments;
DROP TRIGGER trg_supplier_payments_receipt;
DROP TRIGGER trg_supplier_payments_no_update;
DROP TRIGGER trg_supplier_payments_no_delete;
DROP TABLE supplier_payments;

CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  receipt_id INTEGER REFERENCES goods_receipts (id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'orange_money', 'moov_money', 'telecel_money', 'wave',
                                     'card', 'mobile_money', 'transfer', 'cheque')),
  reference TEXT,
  paid_at TEXT NOT NULL {{ISO paid_at}},
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}}
) STRICT;

INSERT INTO supplier_payments SELECT * FROM supplier_payments_copy;
DROP TABLE supplier_payments_copy;

CREATE INDEX idx_supplier_payments_supplier ON supplier_payments (supplier_id);
CREATE INDEX idx_supplier_payments_receipt ON supplier_payments (receipt_id) WHERE receipt_id IS NOT NULL;

CREATE TRIGGER trg_supplier_payments_receipt BEFORE INSERT ON supplier_payments
WHEN NEW.receipt_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'SUPPLIER_PAYMENT_RECEIPT: l''entrée doit être validée et appartenir à ce fournisseur')
  WHERE NOT EXISTS (SELECT 1 FROM goods_receipts r
    WHERE r.id = NEW.receipt_id AND r.supplier_id = NEW.supplier_id AND r.status = 'validated');
END;

{{IMMUTABLE supplier_payments}}

-- sale_returns
CREATE TABLE sale_returns_copy AS SELECT * FROM sale_returns;
DROP TRIGGER trg_sale_returns_insert;
DROP TRIGGER trg_sale_returns_no_update;
DROP TRIGGER trg_sale_returns_no_delete;
DROP TABLE sale_returns;

CREATE TABLE sale_returns (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (length(number) BETWEEN 1 AND 32),
  sale_id INTEGER NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  refund_amount INTEGER NOT NULL CHECK (refund_amount >= 0),
  refund_method TEXT CHECK (refund_method IS NULL OR refund_method IN
    ('cash', 'orange_money', 'moov_money', 'telecel_money', 'wave', 'credit_note',
     'card', 'mobile_money', 'transfer', 'cheque')),
  cash_session_id INTEGER REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT {{NOW}} {{ISO created_at}},
  CHECK (refund_amount = 0 OR refund_method IS NOT NULL),
  CHECK (refund_method IS NOT 'cash' OR cash_session_id IS NOT NULL)
) STRICT;

INSERT INTO sale_returns SELECT * FROM sale_returns_copy;
DROP TABLE sale_returns_copy;

CREATE INDEX idx_sale_returns_sale ON sale_returns (sale_id);

CREATE TRIGGER trg_sale_returns_insert BEFORE INSERT ON sale_returns
BEGIN
  SELECT RAISE(ABORT, 'RETURN_SALE_STATUS: seul un article d''une vente terminée peut être retourné')
  WHERE (SELECT s.status FROM sales s WHERE s.id = NEW.sale_id) IS NOT 'completed';
END;

{{IMMUTABLE sale_returns}}

CREATE VIEW v_cash_session_summary AS
SELECT cs.id AS cash_session_id, cs.status, cs.opened_at, cs.closed_at, cs.opening_float,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'cash'), 0) AS cash_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'orange_money'), 0) AS orange_money_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'moov_money'), 0) AS moov_money_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'telecel_money'), 0) AS telecel_money_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'wave'), 0) AS wave_in,
       -- Moyens abandonnés (D94), gardés pour l'historique : carte, mobile money, virement, chèque.
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id
                 AND p.method IN ('card', 'mobile_money', 'transfer', 'cheque')), 0) AS other_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'card'), 0) AS card_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'mobile_money'), 0) AS mobile_money_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'transfer'), 0) AS transfer_in,
       coalesce((SELECT sum(p.amount) FROM payments p WHERE p.cash_session_id = cs.id AND p.method = 'cheque'), 0) AS cheque_in,
       coalesce((SELECT sum(m.amount) FROM cash_movements m WHERE m.cash_session_id = cs.id AND m.direction = 'in'), 0) AS cash_movements_in,
       coalesce((SELECT sum(m.amount) FROM cash_movements m WHERE m.cash_session_id = cs.id AND m.direction = 'out'), 0) AS cash_movements_out,
       coalesce((SELECT sum(r.refund_amount) FROM sale_returns r WHERE r.cash_session_id = cs.id AND r.refund_method = 'cash'), 0) AS cash_refunds
FROM cash_sessions cs;
