import { nowIsoUtc } from '@shared/format/date';
import type { CartLine } from '@shared/schemas/sales';
import type { Db } from '../db/types';
import { applyMovement, unitLocation } from '../stock/movements';
import { setUnitStatus } from '../stock/units';
import type { PricedCart } from './cart';
import { distribute, warrantyEnd } from './pricing';

/** Ligne écrite qui bouge le stock à la validation (articles et composants stockés). */
export interface StockedLine {
  lineId: number;
  variantId: number;
  quantity: number;
  serialUnitId: number | null;
  warrantyMonths: number;
}

type LineType = 'item' | 'kit' | 'kit_component' | 'service';

/**
 * Écrit les lignes d'une vente en attente : un kit devient une ligne de kit (seule valorisée) et ses
 * composants ; un article suivi devient une ligne par unité (remise répartie) ; un service n'a pas
 * de stock. Renvoie les lignes qui bougeront le stock.
 */
export function insertSaleLines(db: Db, saleId: number, cart: PricedCart): StockedLine[] {
  const insert = db.prepare(
    `INSERT INTO sale_lines (sale_id, variant_id, serial_unit_id, parent_line_id, line_type, quantity,
                             unit_price, unit_cost, discount, tax_rate, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = (
    type: LineType,
    variantId: number,
    quantity: number,
    unitPrice: number,
    unitCost: number,
    discount: number,
    taxRate: number,
    serialUnitId: number | null,
    parentLineId: number | null,
  ): number =>
    Number(
      insert.run(
        saleId,
        variantId,
        serialUnitId,
        parentLineId,
        type,
        quantity,
        unitPrice,
        unitCost,
        discount,
        taxRate,
        quantity * unitPrice - discount,
      ).lastInsertRowid,
    );
  const stocked: StockedLine[] = [];
  for (const line of cart.lines) {
    const { info } = line;
    if (info.productType === 'kit') {
      const kitLineId = write(
        'kit',
        info.variantId,
        line.quantity,
        line.unitPrice,
        0,
        line.discount,
        info.taxRate,
        null,
        null,
      );
      for (const component of line.components) {
        const c = component.info;
        if (c.trackingMode !== 'none' && c.isStocked) {
          for (const unitId of component.serialUnitIds) {
            const lineId = write(
              'kit_component',
              c.variantId,
              1,
              0,
              c.avgCost,
              0,
              c.taxRate,
              unitId,
              kitLineId,
            );
            stocked.push({
              lineId,
              variantId: c.variantId,
              quantity: 1,
              serialUnitId: unitId,
              warrantyMonths: c.warrantyMonths,
            });
          }
          continue;
        }
        const lineId = write(
          'kit_component',
          c.variantId,
          component.quantity,
          0,
          c.avgCost,
          0,
          c.taxRate,
          null,
          kitLineId,
        );
        if (c.isStocked) {
          stocked.push({
            lineId,
            variantId: c.variantId,
            quantity: component.quantity,
            serialUnitId: null,
            warrantyMonths: c.warrantyMonths,
          });
        }
      }
      continue;
    }
    if (info.productType === 'service') {
      write(
        'service',
        info.variantId,
        line.quantity,
        line.unitPrice,
        info.avgCost,
        line.discount,
        info.taxRate,
        null,
        null,
      );
      continue;
    }
    if (info.trackingMode !== 'none') {
      const discounts = distribute(
        line.discount,
        line.serialUnitIds.map(() => 1),
      );
      line.serialUnitIds.forEach((unitId, index) => {
        const lineId = write(
          'item',
          info.variantId,
          1,
          line.unitPrice,
          info.avgCost,
          discounts[index] ?? 0,
          info.taxRate,
          unitId,
          null,
        );
        stocked.push({
          lineId,
          variantId: info.variantId,
          quantity: 1,
          serialUnitId: unitId,
          warrantyMonths: info.warrantyMonths,
        });
      });
      continue;
    }
    const lineId = write(
      'item',
      info.variantId,
      line.quantity,
      line.unitPrice,
      info.avgCost,
      line.discount,
      info.taxRate,
      null,
      null,
    );
    stocked.push({
      lineId,
      variantId: info.variantId,
      quantity: line.quantity,
      serialUnitId: null,
      warrantyMonths: info.warrantyMonths,
    });
  }
  return stocked;
}

/**
 * Sorties de stock d'une vente validée (par la fonction unique de mouvement) et unités vendues :
 * état « vendu », ligne de vente, date et fin de garantie (date de vente + durée du produit).
 */
export function applySaleStock(
  db: Db,
  saleId: number,
  lines: readonly StockedLine[],
  context: { locationId: number; userId: number; soldAt: string },
): void {
  const reference = { type: 'sale' as const, id: saleId };
  for (const line of lines) {
    if (line.serialUnitId === null) {
      applyMovement(db, {
        variantId: line.variantId,
        locationId: context.locationId,
        type: 'sale',
        quantityDelta: -line.quantity,
        userId: context.userId,
        reference,
      });
      continue;
    }
    const locationId = unitLocation(db, line.serialUnitId) ?? context.locationId;
    applyMovement(db, {
      variantId: line.variantId,
      locationId,
      type: 'sale',
      quantityDelta: -1,
      serialUnitId: line.serialUnitId,
      userId: context.userId,
      reference,
    });
    // État, ligne de vente et date ensemble : la base exige les trois pour une unité vendue.
    db.prepare(
      "UPDATE serial_units SET status = 'sold', sale_line_id = ?, sold_at = ?, warranty_end = ?, updated_at = ? WHERE id = ?",
    ).run(
      line.lineId,
      context.soldAt,
      warrantyEnd(context.soldAt, line.warrantyMonths),
      nowIsoUtc(),
      line.serialUnitId,
    );
  }
}

/** Unité revenue en stock : plus rattachée à une vente ni sous garantie. */
export function releaseUnit(db: Db, unitId: number): void {
  setUnitStatus(db, unitId, 'returned');
  setUnitStatus(db, unitId, 'in_stock');
  db.prepare(
    'UPDATE serial_units SET sale_line_id = NULL, sold_at = NULL, warranty_end = NULL, updated_at = ? WHERE id = ?',
  ).run(nowIsoUtc(), unitId);
}

interface StoredLine {
  id: number;
  parent_line_id: number | null;
  line_type: LineType;
  variant_id: number;
  serial_unit_id: number | null;
  quantity: number;
  discount: number;
}

/** Panier reconstitué depuis les lignes d'une vente en attente (remises reprises en montant). */
export function cartFromLines(db: Db, saleId: number): CartLine[] {
  const rows = db
    .prepare<[number], StoredLine>(
      'SELECT id, parent_line_id, line_type, variant_id, serial_unit_id, quantity, discount FROM sale_lines WHERE sale_id = ? ORDER BY id',
    )
    .all(saleId);
  const cart: CartLine[] = [];
  const tracked = new Map<number, CartLine>();
  for (const row of rows) {
    if (row.line_type === 'kit_component') continue;
    if (row.line_type === 'kit') {
      const components = new Map<number, number[]>();
      for (const component of rows.filter(
        (other) => other.parent_line_id === row.id && other.serial_unit_id !== null,
      )) {
        components.set(component.variant_id, [
          ...(components.get(component.variant_id) ?? []),
          component.serial_unit_id ?? 0,
        ]);
      }
      cart.push({
        variantId: row.variant_id,
        quantity: row.quantity,
        discount: row.discount === 0 ? null : { type: 'amount', value: row.discount },
        components: [...components.entries()].map(([variantId, serialUnitIds]) => ({
          variantId,
          serialUnitIds,
        })),
      });
      continue;
    }
    if (row.serial_unit_id !== null) {
      const existing = tracked.get(row.variant_id);
      if (existing !== undefined) {
        existing.quantity += 1;
        existing.serialUnitIds = [...(existing.serialUnitIds ?? []), row.serial_unit_id];
        const total =
          (existing.discount?.type === 'amount' ? existing.discount.value : 0) + row.discount;
        existing.discount = total === 0 ? null : { type: 'amount', value: total };
        continue;
      }
      const line: CartLine = {
        variantId: row.variant_id,
        quantity: 1,
        discount: row.discount === 0 ? null : { type: 'amount', value: row.discount },
        serialUnitIds: [row.serial_unit_id],
      };
      tracked.set(row.variant_id, line);
      cart.push(line);
      continue;
    }
    cart.push({
      variantId: row.variant_id,
      quantity: row.quantity,
      discount: row.discount === 0 ? null : { type: 'amount', value: row.discount },
    });
  }
  return cart;
}
