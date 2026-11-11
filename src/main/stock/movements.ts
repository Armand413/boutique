import { nowIsoUtc } from '@shared/format/date';
import type { MovementType } from '@shared/schemas/stock';
import type { Db } from '../db/types';

export type MovementReference = {
  type: 'goods_receipt' | 'transfer' | 'manual' | 'sale' | 'sale_return' | 'inventory_session';
  id: number;
} | null;

export interface MovementInput {
  variantId: number;
  locationId: number;
  type: MovementType;
  /** Signé : positif pour une entrée, négatif pour une sortie. */
  quantityDelta: number;
  userId: number;
  /** Coût unitaire d'une entrée (base du coût moyen pondéré) ; 0 sinon. */
  unitCost?: number;
  /**
   * Achat : quantité prise en compte dans le coût moyen (par défaut la quantité du mouvement).
   * Une ligne d'articles suivis entre unité par unité : la première porte toute la ligne, les
   * suivantes 0, pour un seul calcul (et un seul arrondi) par ligne.
   */
  averageQuantity?: number;
  serialUnitId?: number | null;
  reason?: string | null;
  reference?: MovementReference;
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

function stockTotal(db: Db, variantId: number): number {
  return (
    db
      .prepare<[number], number>(
        'SELECT coalesce(sum(quantity), 0) FROM stock_levels WHERE variant_id = ?',
      )
      .pluck()
      .get(variantId) ?? 0
  );
}

/**
 * Coût moyen pondéré après une entrée (4.3, E.4) :
 * (stock avant × coût moyen + quantité reçue × coût d'achat) / stock après, arrondi à l'unité.
 */
export function weightedAverageCost(
  stockBefore: number,
  averageBefore: number,
  received: number,
  unitCost: number,
): number {
  if (stockBefore <= 0) return unitCost;
  return Math.round((stockBefore * averageBefore + received * unitCost) / (stockBefore + received));
}

/**
 * UNIQUE point d'écriture du stock (CLAUDE.md) : insère un mouvement, que les triggers appliquent
 * à stock_levels. Doit être appelée dans la transaction de l'opération (tout ou rien). Un achat
 * recalcule le coût moyen pondéré et le dernier prix d'achat de la variante.
 */
export function applyMovement(db: Db, input: MovementInput): number {
  if (!db.inTransaction) {
    throw new Error('applyMovement doit être appelée dans une transaction.');
  }
  const unitCost = input.unitCost ?? 0;
  const averageQuantity = input.averageQuantity ?? input.quantityDelta;
  if (input.type === 'purchase' && averageQuantity > 0) {
    const average = db
      .prepare<[number], number>('SELECT avg_cost FROM product_variants WHERE id = ?')
      .pluck()
      .get(input.variantId);
    db.prepare(
      'UPDATE product_variants SET avg_cost = ?, cost_price = ?, updated_at = ? WHERE id = ?',
    ).run(
      weightedAverageCost(stockTotal(db, input.variantId), average ?? 0, averageQuantity, unitCost),
      unitCost,
      nowIsoUtc(),
      input.variantId,
    );
  }
  const quantityAfter = stockAt(db, input.variantId, input.locationId) + input.quantityDelta;
  const result = db
    .prepare(
      `INSERT INTO stock_movements (variant_id, location_id, serial_unit_id, movement_type,
         quantity_delta, unit_cost, quantity_after, reference_type, reference_id, reason, user_id,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.variantId,
      input.locationId,
      input.serialUnitId ?? null,
      input.type,
      input.quantityDelta,
      unitCost,
      quantityAfter,
      input.reference?.type ?? null,
      input.reference?.id ?? null,
      input.reason ?? null,
      input.userId,
      nowIsoUtc(),
    );
  return Number(result.lastInsertRowid);
}

/** Emplacement actuel d'une unité suivie : celui de son dernier mouvement. */
export function unitLocation(db: Db, serialUnitId: number): number | null {
  return (
    db
      .prepare<[number], number>(
        'SELECT location_id FROM stock_movements WHERE serial_unit_id = ? ORDER BY id DESC LIMIT 1',
      )
      .pluck()
      .get(serialUnitId) ?? null
  );
}
