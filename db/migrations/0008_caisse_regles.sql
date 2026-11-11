-- 0008 : règles de caisse fixées avec le client (D51, D53).

-- Prix TTC : la taxe est comprise dans le prix et seulement détaillée (« dont TVA ») sur la facture ;
-- elle n'est jamais ajoutée au total d'une vente ou d'un devis.
CREATE TRIGGER trg_sales_tax_included BEFORE UPDATE OF status ON sales
WHEN NEW.status = 'completed' AND NEW.tax_total <> 0
BEGIN
  SELECT RAISE(ABORT, 'SALE_TAX_INCLUDED: les prix sont TTC, la taxe n''est pas ajoutée au total');
END;

CREATE TRIGGER trg_quotes_tax_included_insert BEFORE INSERT ON quotes
WHEN NEW.tax_total <> 0
BEGIN
  SELECT RAISE(ABORT, 'SALE_TAX_INCLUDED: les prix sont TTC, la taxe n''est pas ajoutée au total');
END;

CREATE TRIGGER trg_quotes_tax_included_update BEFORE UPDATE OF tax_total ON quotes
WHEN NEW.tax_total <> 0
BEGIN
  SELECT RAISE(ABORT, 'SALE_TAX_INCLUDED: les prix sont TTC, la taxe n''est pas ajoutée au total');
END;

-- Annulation d'une vente terminée : uniquement tant que sa session de caisse est ouverte ;
-- ensuite, un retour (article par article) est la seule voie.
CREATE TRIGGER trg_sales_cancel_open_session BEFORE UPDATE OF status ON sales
WHEN OLD.status = 'completed' AND NEW.status = 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'SALE_CANCEL_CLOSED: la caisse de cette vente est clôturée, enregistrez un retour')
  WHERE (SELECT c.status FROM cash_sessions c WHERE c.id = OLD.cash_session_id) IS NOT 'open';
  SELECT RAISE(ABORT, 'SALE_CANCEL_RETURNED: une vente qui a déjà un retour ne s''annule plus')
  WHERE EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = OLD.id);
END;
