import type { EnumKey, ReportKind, ReportRequest } from '@shared/schemas/reports';

/** Libellés français des exports (l'interface a les siens dans son dictionnaire). */
export const KIND_TITLES: Readonly<Record<ReportKind, string>> = {
  sales: 'Ventes',
  products: 'Produits les plus et les moins vendus',
  stock: 'Valorisation du stock',
  balances: 'Créances clients et dettes fournisseurs',
  movements: 'Journal des mouvements de stock',
  cash: 'Rapport de caisse',
  followups: 'Devis et échéances',
};

const GROUP_TITLES: Readonly<Record<string, string>> = {
  day: 'par jour',
  month: 'par mois',
  seller: 'par vendeur',
  family: 'par famille',
  category: 'par catégorie',
  brand: 'par marque',
  product: 'par produit',
  location: 'par emplacement',
  best: 'les plus vendus',
  worst: 'les moins vendus',
};

export const COLUMN_LABELS: Readonly<Record<string, string>> = {
  label: 'Libellé',
  sales_count: 'Ventes',
  quantity: 'Quantité',
  revenue_ttc: 'Ventes TTC',
  revenue: 'CA HT',
  cost: 'Coût',
  margin: 'Marge',
  margin_rate: 'Taux de marge',
  product: 'Produit',
  sku: 'Référence',
  brand: 'Marque',
  family: 'Famille',
  stock: 'Stock',
  coverage_days: 'Couverture (jours)',
  products: 'Articles',
  retail_value: 'Valeur au prix de vente',
  stock_value: 'Valeur au coût',
  created_at: 'Date',
  serial: 'Numéro de série',
  location: 'Emplacement',
  movement_type: 'Type',
  quantity_after: 'Stock après',
  unit_cost: 'Coût unitaire',
  reason: 'Motif',
  user: 'Utilisateur',
  party: 'Tiers',
  name: 'Nom',
  phone: 'Téléphone',
  balance: 'Solde dû',
  overdue: 'En retard',
  due_date: 'Échéance',
  opened_at: 'Ouverture',
  closed_at: 'Clôture',
  opened_by: 'Ouverte par',
  closed_by: 'Clôturée par',
  sales_total: 'Total des ventes',
  opening_float: 'Fond de caisse',
  cash_in: 'Espèces',
  card_in: 'Carte',
  mobile_money_in: 'Mobile money',
  transfer_in: 'Virement',
  cheque_in: 'Chèque',
  cash_movements: 'Entrées/sorties d’espèces',
  cash_refunds: 'Remboursements espèces',
  expected_amount: 'Attendu',
  counted_amount: 'Compté',
  difference: 'Écart',
  type: 'Type',
  number: 'Numéro',
  customer: 'Client',
  date: 'Date',
  amount: 'Montant',
  remaining: 'Reste dû',
  days: 'Jours restants',
};

export const ENUM_LABELS: Readonly<Record<EnumKey, Readonly<Record<string, string>>>> = {
  movement: {
    purchase: 'Achat',
    sale: 'Vente',
    sale_return: 'Retour client',
    purchase_return: 'Retour fournisseur',
    adjustment: 'Ajustement',
    inventory: 'Inventaire',
    loss: 'Perte',
    damage: 'Casse',
    theft: 'Vol',
    internal_use: 'Usage interne',
    transfer_in: 'Transfert reçu',
    transfer_out: 'Transfert envoyé',
  },
  party: { customer: 'Client', supplier: 'Fournisseur' },
  followup: { quote: 'Devis', installment: 'Échéance' },
  payment: {
    cash: 'Espèces',
    card: 'Carte',
    mobile_money: 'Mobile money',
    transfer: 'Virement',
    cheque: 'Chèque',
  },
};

/** Titre complet d'un rapport, avec son regroupement et sa période. */
export function reportTitle(request: ReportRequest): string {
  const parts = [KIND_TITLES[request.kind]];
  if ('groupBy' in request) parts.push(GROUP_TITLES[request.groupBy] ?? request.groupBy);
  if ('order' in request) parts.push(GROUP_TITLES[request.order] ?? request.order);
  if ('movementType' in request && request.movementType !== null) {
    parts.push(`(${ENUM_LABELS.movement[request.movementType] ?? request.movementType})`);
  }
  return parts.join(' ');
}

export function periodText(request: ReportRequest): string | null {
  if (!('period' in request)) return null;
  return request.period.from === request.period.to
    ? `le ${request.period.from}`
    : `du ${request.period.from} au ${request.period.to}`;
}
