import type { Discount } from '@shared/schemas/sales';

/** Montant d'une remise sur un montant brut (jamais au-delà du brut). */
export function discountAmount(gross: number, discount: Discount | null): number {
  if (discount === null) return 0;
  const value =
    discount.type === 'amount' ? discount.value : Math.round((gross * discount.value) / 10_000);
  return Math.min(Math.max(value, 0), gross);
}

/**
 * Répartit `total` proportionnellement aux poids, en entiers dont la somme vaut exactement `total`
 * (méthode du plus fort reste). Sert à porter une remise globale sur les lignes.
 */
export function distribute(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map(Math.floor);
  let remainder = total - shares.reduce((acc, share) => acc + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder === 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }
  return shares;
}

/** Taxe comprise dans un montant TTC (« dont TVA ») ; `rate` en centièmes de pourcent. */
export function includedTax(amountWithTax: number, rate: number): number {
  if (rate === 0) return 0;
  return Math.round((amountWithTax * rate) / (10_000 + rate));
}

/** Remise maximale autorisée sur un montant brut ; `cap` null = sans plafond. */
export function maxDiscount(gross: number, cap: number | null): number {
  return cap === null ? gross : Math.floor((gross * cap) / 10_000);
}

/** Date d'échéance de garantie : jour de la vente + n mois (null si aucune garantie). */
export function warrantyEnd(soldAtIso: string, months: number): string | null {
  if (months <= 0) return null;
  const sold = new Date(soldAtIso);
  const end = new Date(
    Date.UTC(sold.getUTCFullYear(), sold.getUTCMonth() + months, sold.getUTCDate()),
  );
  // 31 janvier + 1 mois : on s'arrête au dernier jour du mois visé, pas au 3 mars.
  if (end.getUTCDate() !== sold.getUTCDate()) end.setUTCDate(0);
  return end.toISOString().slice(0, 10);
}
