import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import { normalizeSerial } from '@shared/catalog/imei';
import type { SerialStatus, TrackingMode } from '@shared/catalog/constants';
import type { AvailableUnit } from '@shared/schemas/stock';
import type { Db } from '../db/types';

export interface StockedVariant {
  variantId: number;
  productId: number;
  name: string;
  trackingMode: TrackingMode;
  isStocked: boolean;
  isActive: boolean;
}

export function stockedVariant(db: Db, variantId: number): StockedVariant {
  const row = db
    .prepare<
      [number],
      {
        product_id: number;
        name: string;
        tracking_mode: TrackingMode;
        is_stocked: number;
        is_active: number;
      }
    >(
      `SELECT p.id AS product_id, p.name, p.tracking_mode, p.is_stocked,
              (p.is_active = 1 AND v.is_active = 1) AS is_active
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
    )
    .get(variantId);
  if (row === undefined) throw new AppError('NOT_FOUND', 'Article introuvable.');
  if (row.is_stocked !== 1) {
    throw new AppError('VALIDATION_ERROR', `« ${row.name} » n’a pas de stock (service ou kit).`);
  }
  return {
    variantId,
    productId: row.product_id,
    name: row.name,
    trackingMode: row.tracking_mode,
    isStocked: true,
    isActive: row.is_active === 1,
  };
}

export interface SerialEntry {
  serialNumber: string;
  imei2: string | null;
}

/** Numéros normalisés et sans doublon dans la saisie. */
export function normalizedSerials(entries: readonly SerialEntry[]): SerialEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const serialNumber = normalizeSerial(entry.serialNumber);
    const imei2 = entry.imei2 === null ? null : normalizeSerial(entry.imei2);
    for (const value of [serialNumber, imei2]) {
      if (value === null || value === '') continue;
      if (seen.has(value))
        throw new AppError('CONFLICT', `Le numéro ${value} est saisi deux fois.`);
      seen.add(value);
    }
    return { serialNumber, imei2: imei2 === '' ? null : imei2 };
  });
}

/** Crée une unité suivie (le trigger contrôle l'IMEI et l'unicité). */
export function insertUnit(
  db: Db,
  variantId: number,
  entry: SerialEntry,
  context: { receiptLineId: number | null; userId: number },
): number {
  const now = nowIsoUtc();
  const result = db
    .prepare(
      `INSERT INTO serial_units (variant_id, serial_number, imei2, status, receipt_line_id,
                                 received_at, created_at, updated_at, created_by)
       VALUES (?, ?, ?, 'in_stock', ?, ?, ?, ?, ?)`,
    )
    .run(
      variantId,
      entry.serialNumber,
      entry.imei2,
      context.receiptLineId,
      now,
      now,
      now,
      context.userId,
    );
  return Number(result.lastInsertRowid);
}

export function setUnitStatus(db: Db, unitId: number, status: SerialStatus): void {
  db.prepare('UPDATE serial_units SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    nowIsoUtc(),
    unitId,
  );
}

/**
 * Unités physiquement présentes à un emplacement : leur dernier mouvement est une entrée à cet
 * endroit (en stock, mais aussi défectueuses ou retournées par un client et réintégrées).
 */
export function unitsAt(db: Db, variantId: number, locationId: number): AvailableUnit[] {
  return db
    .prepare<
      [number, number],
      { id: number; serial_number: string; imei2: string | null; status: SerialStatus }
    >(
      `SELECT u.id, u.serial_number, u.imei2, u.status
       FROM serial_units u
       JOIN stock_movements m ON m.id = (SELECT max(id) FROM stock_movements WHERE serial_unit_id = u.id)
       WHERE u.variant_id = ? AND m.location_id = ? AND m.quantity_delta > 0
         AND u.status IN ('in_stock', 'defective', 'returned')
       ORDER BY u.serial_number`,
    )
    .all(variantId, locationId)
    .map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      imei2: row.imei2,
      status: row.status,
    }));
}

/** Vérifie que les unités choisies sont distinctes et présentes à l'emplacement. */
export function requireUnitsAt(
  db: Db,
  variantId: number,
  locationId: number,
  unitIds: readonly number[],
  quantity: number,
  options: { inStockOnly: boolean },
): AvailableUnit[] {
  if (unitIds.length !== quantity || new Set(unitIds).size !== unitIds.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Article suivi : choisissez exactement une unité (numéro) par article.',
    );
  }
  const present = new Map(unitsAt(db, variantId, locationId).map((unit) => [unit.id, unit]));
  return unitIds.map((id) => {
    const unit = present.get(id);
    if (unit === undefined) {
      throw new AppError('CONFLICT', 'Une unité choisie n’est pas présente à cet emplacement.');
    }
    if (options.inStockOnly && unit.status !== 'in_stock') {
      throw new AppError('CONFLICT', `L’unité ${unit.serialNumber} n’est pas disponible.`);
    }
    return unit;
  });
}
