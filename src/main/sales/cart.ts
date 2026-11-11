import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { formatMoney } from '@shared/format/money';
import { variantLabel } from '@shared/catalog/tree';
import type { Condition, ProductType, TrackingMode } from '@shared/catalog/constants';
import type { CartLine, CartPreview, Discount } from '@shared/schemas/sales';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { getSetting } from '../settings/settings-repository';
import { discountAmount, distribute, includedTax, maxDiscount } from './pricing';

interface VariantInfo {
  variantId: number;
  productId: number;
  name: string;
  label: string;
  sku: string;
  productType: ProductType;
  trackingMode: TrackingMode;
  isStocked: boolean;
  isActive: boolean;
  salePrice: number;
  minSalePrice: number;
  avgCost: number;
  taxRate: number;
  warrantyMonths: number;
}

export interface PricedComponent {
  info: VariantInfo;
  quantity: number;
  serialUnitIds: number[];
}

export interface PricedLine {
  info: VariantInfo;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  serialUnitIds: number[];
  components: PricedComponent[];
  quoteLineId: number | null;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  taxIncluded: number;
  /** Tous les problèmes bloquants pour une vente. */
  issues: string[];
  /** Remises et prix minimum seulement (un devis sans réservation ignore le stock). */
  pricingIssues: string[];
}

export interface CartContext {
  /** Devis converti : ses prix s'appliquent et ses unités réservées sont utilisables. */
  quoteId: number | null;
  /** Emplacement de vente des articles non suivis (emplacement par défaut). */
  locationId: number;
}

const capsSchema = z.strictObject({
  seller: z.number().int().min(0).max(10_000).nullable(),
  manager: z.number().int().min(0).max(10_000).nullable(),
  admin: z.number().int().min(0).max(10_000).nullable(),
});

/** Plafond de remise du rôle (centièmes de pourcent) ; null = sans plafond. */
export function discountCap(db: Db, actor: Session): number | null {
  if (actor.permissions.has('price.override')) return null;
  return getSetting(db, 'pos.discount_caps', capsSchema)[actor.role];
}

export function defaultLocation(db: Db): number {
  const id = db
    .prepare<[], number>('SELECT id FROM stock_locations WHERE is_default = 1')
    .pluck()
    .get();
  if (id === undefined) throw new AppError('UNAVAILABLE', 'Aucun emplacement par défaut.');
  return id;
}

export function variantInfo(db: Db, variantId: number): VariantInfo {
  const row = db
    .prepare<
      [number],
      {
        product_id: number;
        name: string;
        sku: string;
        color: string | null;
        storage_gb: number | null;
        ram_gb: number | null;
        condition: Condition;
        product_type: ProductType;
        tracking_mode: TrackingMode;
        is_stocked: number;
        is_active: number;
        sale_price: number;
        min_sale_price: number;
        avg_cost: number;
        tax_rate: number | null;
        warranty_months: number;
      }
    >(
      `SELECT p.id AS product_id, p.name, v.sku, v.color, v.storage_gb, v.ram_gb, v.condition,
              p.product_type, p.tracking_mode, p.is_stocked, (p.is_active = 1 AND v.is_active = 1) AS is_active,
              v.sale_price, v.min_sale_price, v.avg_cost, t.rate AS tax_rate, p.warranty_months
       FROM product_variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN tax_rates t ON t.id = p.tax_rate_id
       WHERE v.id = ?`,
    )
    .get(variantId);
  if (row === undefined) throw new AppError('NOT_FOUND', 'Article introuvable.');
  return {
    variantId,
    productId: row.product_id,
    name: row.name,
    label: variantLabel({
      color: row.color,
      storageGb: row.storage_gb,
      ramGb: row.ram_gb,
      condition: row.condition,
    }),
    sku: row.sku,
    productType: row.product_type,
    trackingMode: row.tracking_mode,
    isStocked: row.is_stocked === 1,
    isActive: row.is_active === 1,
    salePrice: row.sale_price,
    minSalePrice: row.min_sale_price,
    avgCost: row.avg_cost,
    taxRate: row.tax_rate ?? 0,
    warrantyMonths: row.warranty_months,
  };
}

function displayName(info: VariantInfo): string {
  return info.label === '' ? info.name : `${info.name} (${info.label})`;
}

function quoteLine(db: Db, quoteId: number | null, quoteLineId: number, variantId: number) {
  const row = db
    .prepare<
      [number],
      {
        quote_id: number;
        variant_id: number | null;
        quantity: number;
        unit_price: number;
        discount: number;
      }
    >('SELECT quote_id, variant_id, quantity, unit_price, discount FROM quote_lines WHERE id = ?')
    .get(quoteLineId);
  if (row?.quote_id !== quoteId || row.variant_id !== variantId) {
    throw new AppError('VALIDATION_ERROR', 'Ligne de devis introuvable pour cette vente.');
  }
  return row;
}

/** Quantités d'articles non suivis réservées par d'autres devis ouverts (réservation de stock). */
function reservedByQuotes(db: Db, variantId: number, exceptQuoteId: number | null): number {
  return (
    db
      .prepare<[number, number], number>(
        `SELECT coalesce(sum(l.quantity), 0) FROM quote_lines l JOIN quotes q ON q.id = l.quote_id
         WHERE l.variant_id = ? AND l.serial_unit_id IS NULL AND q.reserve_stock = 1
           AND q.status IN ('draft', 'sent', 'accepted') AND q.valid_until >= date('now', 'localtime')
           AND q.id <> ?`,
      )
      .pluck()
      .get(variantId, exceptQuoteId ?? 0) ?? 0
  );
}

function stockAt(db: Db, variantId: number, locationId: number): number {
  return (
    db
      .prepare<[number, number], number>(
        'SELECT quantity FROM stock_levels WHERE variant_id = ? AND location_id = ?',
      )
      .pluck()
      .get(variantId, locationId) ?? 0
  );
}

/** Unité vendable : bonne variante, présente en stock, libre ou réservée par le devis converti. */
function unitIssue(
  db: Db,
  unitId: number,
  variantId: number,
  quoteId: number | null,
): string | null {
  const unit = db
    .prepare<
      [number],
      {
        variant_id: number;
        serial_number: string;
        status: string;
        reserved_by: number | null;
        last_delta: number | null;
      }
    >(
      `SELECT u.variant_id, u.serial_number, u.status,
              (SELECT l.quote_id FROM quote_lines l JOIN quotes q ON q.id = l.quote_id
               WHERE l.serial_unit_id = u.id AND q.status IN ('draft', 'sent', 'accepted') LIMIT 1) AS reserved_by,
              (SELECT m.quantity_delta FROM stock_movements m WHERE m.serial_unit_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_delta
       FROM serial_units u WHERE u.id = ?`,
    )
    .get(unitId);
  if (unit?.variant_id !== variantId) return 'Une unité choisie ne correspond pas à l’article.';
  if ((unit.last_delta ?? 0) <= 0) return `L’unité ${unit.serial_number} n’est pas en stock.`;
  if (unit.status === 'in_stock') return null;
  if (unit.status === 'reserved' && unit.reserved_by !== null && unit.reserved_by === quoteId)
    return null;
  return `L’unité ${unit.serial_number} n’est pas disponible.`;
}

/**
 * Panier chiffré selon les règles de la caisse : prix TTC du catalogue (ou du devis), remises par
 * ligne puis remise globale répartie, plafonds par rôle, prix minimum, disponibilité du stock et
 * des unités. Les problèmes sont listés ; la validation de la vente refuse s'il y en a.
 */
export function priceCart(
  db: Db,
  actor: Session,
  lines: readonly CartLine[],
  globalDiscount: Discount | null,
  context: CartContext,
): PricedCart {
  const issues: string[] = [];
  const cap = discountCap(db, actor);
  const priced: PricedLine[] = lines.map((line) => {
    const info = variantInfo(db, line.variantId);
    if (!info.isActive) issues.push(`« ${displayName(info)} » est archivé.`);
    let unitPrice = info.salePrice;
    let discount: number;
    if (line.quoteLineId !== undefined) {
      const fromQuote = quoteLine(db, context.quoteId, line.quoteLineId, line.variantId);
      if (fromQuote.quantity !== line.quantity) {
        throw new AppError(
          'VALIDATION_ERROR',
          'La quantité d’une ligne de devis ne change pas à la conversion.',
        );
      }
      unitPrice = fromQuote.unit_price;
      discount = fromQuote.discount;
    } else {
      discount = discountAmount(line.quantity * unitPrice, line.discount);
    }
    const components =
      info.productType !== 'kit'
        ? []
        : db
            .prepare<[number], { component_variant_id: number; quantity: number }>(
              'SELECT component_variant_id, quantity FROM kit_components WHERE kit_variant_id = ? ORDER BY id',
            )
            .all(line.variantId)
            .map((component) => ({
              info: variantInfo(db, component.component_variant_id),
              quantity: component.quantity * line.quantity,
              serialUnitIds:
                line.components?.find(
                  (chosen) => chosen.variantId === component.component_variant_id,
                )?.serialUnitIds ?? [],
            }));
    if (info.productType === 'kit' && components.length === 0) {
      issues.push(`Le kit « ${displayName(info)} » n’a aucun composant.`);
    }
    return {
      info,
      quantity: line.quantity,
      unitPrice,
      discount,
      lineTotal: 0,
      serialUnitIds: line.serialUnitIds ?? [],
      components,
      quoteLineId: line.quoteLineId ?? null,
    };
  });

  // Remise globale répartie sur les lignes, au prorata de leur montant après remise de ligne.
  const nets = priced.map((line) => line.quantity * line.unitPrice - line.discount);
  const globalAmount = discountAmount(
    nets.reduce((sum, net) => sum + net, 0),
    globalDiscount,
  );
  distribute(globalAmount, nets).forEach((share, index) => {
    const line = priced[index];
    if (line !== undefined) line.discount += share;
  });
  for (const line of priced) line.lineTotal = line.quantity * line.unitPrice - line.discount;

  const pricingIssues: string[] = [];
  checkPricing(priced, cap, pricingIssues);
  issues.push(...pricingIssues);
  checkAvailability(db, priced, context, issues);
  const subtotal = priced.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const discountTotal = priced.reduce((sum, line) => sum + line.discount, 0);
  return {
    lines: priced,
    subtotal,
    discountTotal,
    total: subtotal - discountTotal,
    taxIncluded: priced.reduce(
      (sum, line) => sum + includedTax(line.lineTotal, line.info.taxRate),
      0,
    ),
    issues,
    pricingIssues,
  };
}

/** Plafond de remise du rôle et prix minimum (dérogation : price.override). Les lignes de devis sont déjà validées. */
function checkPricing(lines: readonly PricedLine[], cap: number | null, issues: string[]): void {
  if (cap === null) return;
  for (const line of lines) {
    if (line.quoteLineId !== null) continue;
    const gross = line.quantity * line.unitPrice;
    const name = displayName(line.info);
    if (line.discount > maxDiscount(gross, cap)) {
      issues.push(`Remise sur « ${name} » au-delà de votre plafond (${String(cap / 100)} %).`);
    }
    if (line.lineTotal < line.info.minSalePrice * line.quantity) {
      issues.push(
        `« ${name} » : prix inférieur au minimum autorisé (${formatMoney(line.info.minSalePrice)}).`,
      );
    }
  }
}

function checkAvailability(
  db: Db,
  lines: readonly PricedLine[],
  context: CartContext,
  issues: string[],
): void {
  const demand = new Map<number, { info: VariantInfo; quantity: number }>();
  const units = new Set<number>();
  const visit = (info: VariantInfo, quantity: number, unitIds: readonly number[]): void => {
    if (!info.isStocked) return;
    if (info.trackingMode !== 'none') {
      if (unitIds.length !== quantity) {
        issues.push(
          `« ${displayName(info)} » : choisissez ${String(quantity)} unité(s) (numéro de série ou IMEI).`,
        );
      }
      for (const unitId of unitIds) {
        if (units.has(unitId)) issues.push('Une même unité figure deux fois dans le panier.');
        units.add(unitId);
        const problem = unitIssue(db, unitId, info.variantId, context.quoteId);
        if (problem !== null) issues.push(problem);
      }
      return;
    }
    const current = demand.get(info.variantId);
    demand.set(info.variantId, { info, quantity: (current?.quantity ?? 0) + quantity });
  };
  for (const line of lines) {
    visit(line.info, line.quantity, line.serialUnitIds);
    for (const component of line.components)
      visit(component.info, component.quantity, component.serialUnitIds);
  }
  for (const { info, quantity } of demand.values()) {
    const available =
      stockAt(db, info.variantId, context.locationId) -
      reservedByQuotes(db, info.variantId, context.quoteId);
    if (quantity > available) {
      issues.push(
        `Stock insuffisant pour « ${displayName(info)} » : ${String(Math.max(available, 0))} disponible(s).`,
      );
    }
  }
}

/** Aperçu renvoyé à l'interface (aucune donnée de coût). */
export function toPreview(cart: PricedCart): CartPreview {
  return {
    lines: cart.lines.map((line) => ({
      variantId: line.info.variantId,
      name: line.info.name,
      variantLabel: line.info.label,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      lineTotal: line.lineTotal,
      taxIncluded: includedTax(line.lineTotal, line.info.taxRate),
    })),
    subtotal: cart.subtotal,
    discountTotal: cart.discountTotal,
    total: cart.total,
    taxIncluded: cart.taxIncluded,
    issues: [...new Set(cart.issues)],
  };
}
