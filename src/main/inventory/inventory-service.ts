import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import { normalizeSerial } from '@shared/catalog/imei';
import { descendantIds, variantLabel } from '@shared/catalog/tree';
import type { Condition, TrackingMode } from '@shared/catalog/constants';
import type {
  CreateInventoryInput,
  InventoryDetail,
  InventoryLine,
  InventoryStatus,
  InventorySummary,
} from '@shared/schemas/inventory';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import { listBrands, listCategories } from '../catalog/reference-repository';
import type { Db } from '../db/types';
import { getSetting } from '../settings/settings-repository';
import { applyMovement, unitLocation } from '../stock/movements';
import { setUnitStatus, unitsAt } from '../stock/units';

interface SessionRow {
  id: number;
  name: string;
  scope_type: 'all' | 'brand' | 'category';
  scope_id: number | null;
  location_id: number;
  location_name: string;
  status: InventoryStatus;
  created_at: string;
  created_by: number;
  creator: string;
  validated_at: string | null;
  validator: string | null;
  line_count: number;
  counted_count: number;
  difference_count: number;
  difference_value: number;
}

const SESSION_SELECT = `
  SELECT s.id, s.name, s.scope_type, s.scope_id, s.location_id, l.name AS location_name, s.status, s.created_at,
         s.created_by, c.full_name AS creator, s.validated_at, v.full_name AS validator,
         (SELECT count(*) FROM inventory_lines x WHERE x.session_id = s.id) AS line_count,
         (SELECT count(*) FROM inventory_lines x WHERE x.session_id = s.id AND x.counted_quantity IS NOT NULL) AS counted_count,
         (SELECT count(*) FROM inventory_lines x WHERE x.session_id = s.id AND x.difference <> 0) AS difference_count,
         (SELECT coalesce(sum(x.difference * pv.avg_cost), 0) FROM inventory_lines x
          JOIN product_variants pv ON pv.id = x.variant_id WHERE x.session_id = s.id AND x.difference <> 0) AS difference_value
  FROM inventory_sessions s
  JOIN stock_locations l ON l.id = s.location_id
  JOIN users c ON c.id = s.created_by
  LEFT JOIN users v ON v.id = s.validated_by`;

interface LineRow {
  id: number;
  variant_id: number;
  name: string;
  sku: string;
  barcode: string | null;
  color: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  condition: Condition;
  tracking_mode: TrackingMode;
  expected_quantity: number;
  counted_quantity: number | null;
  difference: number | null;
  avg_cost: number;
  note: string | null;
}

/**
 * Inventaires (4.4) : périmètre (tout, marque ou catégorie) sur un emplacement, quantités attendues
 * figées à l'ouverture, comptage manuel ou au scanner (un numéro par appareil suivi, D60), écarts,
 * validation par un rôle autorisé qui crée les mouvements « inventaire ».
 */
export class InventoryService {
  constructor(private readonly db: Db) {}

  list(actor: Session, limit: number): InventorySummary[] {
    requirePermission(actor, 'inventory.manage');
    return this.db
      .prepare<[number], SessionRow>(`${SESSION_SELECT} ORDER BY s.id DESC LIMIT ?`)
      .all(limit)
      .map((row) => this.summary(row, actor.permissions.has('cost.view')));
  }

  create(actor: Session, input: CreateInventoryInput): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    const location = this.db
      .prepare<[number], number>('SELECT is_active FROM stock_locations WHERE id = ?')
      .pluck()
      .get(input.locationId);
    if (location !== 1)
      throw new AppError('VALIDATION_ERROR', 'Emplacement introuvable ou désactivé.');
    const conditions = ['p.is_stocked = 1', 'p.is_active = 1', 'v.is_active = 1'];
    const params: Record<string, unknown> = { location: input.locationId };
    if (input.scopeType === 'brand') {
      if (!listBrands(this.db).some((brand) => brand.id === input.scopeId))
        throw new AppError('NOT_FOUND', 'Marque introuvable.');
      conditions.push('p.brand_id = @scope');
      params.scope = input.scopeId;
    }
    if (input.scopeType === 'category') {
      const categories = listCategories(this.db);
      if (!categories.some((category) => category.id === input.scopeId))
        throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
      conditions.push('p.category_id IN (SELECT value FROM json_each(@categories))');
      params.categories = JSON.stringify(descendantIds(categories, input.scopeId ?? 0));
    }
    const id = this.db.transaction(() => {
      const now = nowIsoUtc();
      const sessionId = Number(
        this.db
          .prepare(
            `INSERT INTO inventory_sessions (name, scope_type, scope_id, location_id, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'counting', ?, ?, ?)`,
          )
          .run(input.name, input.scopeType, input.scopeId, input.locationId, actor.userId, now, now)
          .lastInsertRowid,
      );
      const inserted = this.db
        .prepare(
          `INSERT INTO inventory_lines (session_id, variant_id, location_id, expected_quantity)
           SELECT @session, v.id, @location,
                  coalesce((SELECT l.quantity FROM stock_levels l WHERE l.variant_id = v.id AND l.location_id = @location), 0)
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY p.name COLLATE NOCASE, v.id`,
        )
        .run({ ...params, session: sessionId }).changes;
      if (inserted === 0)
        throw new AppError('VALIDATION_ERROR', 'Aucun article stocké dans ce périmètre.');
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'inventory.opened',
        entityType: 'inventory_session',
        entityId: sessionId,
        details: { ...input, lines: inserted },
      });
      return sessionId;
    })();
    return this.detail(actor, id);
  }

  detail(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    const session = this.session(inventoryId);
    const withCost = actor.permissions.has('cost.view');
    const rows = this.db
      .prepare<[number], LineRow>(
        `SELECT l.id, l.variant_id, p.name, v.sku, v.barcode, v.color, v.storage_gb, v.ram_gb, v.condition, p.tracking_mode,
                l.expected_quantity, l.counted_quantity, l.difference, v.avg_cost, l.note
         FROM inventory_lines l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
         WHERE l.session_id = ? ORDER BY l.id`,
      )
      .all(inventoryId);
    const scans = this.db
      .prepare<[number], { variant_id: number; unit_id: number; serial_number: string }>(
        `SELECT u.variant_id, u.id AS unit_id, u.serial_number FROM inventory_unit_scans s
         JOIN serial_units u ON u.id = s.serial_unit_id WHERE s.session_id = ? ORDER BY s.id`,
      )
      .all(inventoryId);
    const lines: InventoryLine[] = rows.map((row) => {
      const tracked = row.tracking_mode !== 'none';
      const scanned = scans
        .filter((scan) => scan.variant_id === row.variant_id)
        .map((scan) => ({ unitId: scan.unit_id, serialNumber: scan.serial_number }));
      const scannedIds = new Set(scanned.map((unit) => unit.unitId));
      const missing =
        tracked && session.status !== 'validated' && session.status !== 'cancelled'
          ? unitsAt(this.db, row.variant_id, session.location_id)
              .filter((unit) => !scannedIds.has(unit.id))
              .map((unit) => ({
                unitId: unit.id,
                serialNumber: unit.serialNumber,
                status: unit.status,
              }))
          : [];
      return {
        id: row.id,
        variantId: row.variant_id,
        name: row.name,
        variantLabel: variantLabel({
          color: row.color,
          storageGb: row.storage_gb,
          ramGb: row.ram_gb,
          condition: row.condition,
        }),
        sku: row.sku,
        barcode: row.barcode,
        trackingMode: row.tracking_mode,
        expected: row.expected_quantity,
        counted: row.counted_quantity,
        difference: row.difference,
        differenceValue: withCost && row.difference !== null ? row.difference * row.avg_cost : null,
        note: row.note,
        scanned,
        missing,
      };
    });
    return {
      inventory: this.summary(session, withCost),
      lines,
      canValidate:
        session.status === 'review' &&
        actor.permissions.has('inventory.validate') &&
        !this.blockedByDoubleCheck(session, actor),
    };
  }

  /** Quantité comptée d'un article non suivi (les appareils suivis se comptent par leurs numéros). */
  setCount(
    actor: Session,
    inventoryId: number,
    lineId: number,
    counted: number | null,
    note?: string | null,
  ): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    const session = this.session(inventoryId);
    if (session.status !== 'counting')
      throw new AppError('CONFLICT', 'Le comptage de cet inventaire est terminé.');
    const line = this.line(inventoryId, lineId);
    if (line.tracking_mode !== 'none')
      throw new AppError(
        'VALIDATION_ERROR',
        'Article suivi : scannez le numéro de chaque appareil.',
      );
    this.db
      .prepare(
        'UPDATE inventory_lines SET counted_quantity = ?, note = coalesce(?, note) WHERE id = ?',
      )
      .run(counted, note ?? null, lineId);
    return this.detail(actor, inventoryId);
  }

  /**
   * Scan pendant le comptage : un numéro de série ou IMEI compte l'appareil (une seule fois) ; un
   * code-barres ou une référence ajoute un article non suivi.
   */
  scan(
    actor: Session,
    inventoryId: number,
    code: string,
  ): {
    kind: 'item' | 'unit';
    lineId: number;
    name: string;
    counted: number;
    serialNumber: string | null;
  } {
    requirePermission(actor, 'inventory.manage');
    const session = this.session(inventoryId);
    if (session.status !== 'counting')
      throw new AppError('CONFLICT', 'Le comptage de cet inventaire est terminé.');
    const serial = normalizeSerial(code);
    const unit = this.db
      .prepare<[string, string], { id: number; variant_id: number; serial_number: string }>(
        'SELECT id, variant_id, serial_number FROM serial_units WHERE serial_number = ? OR imei2 = ?',
      )
      .get(serial, serial);
    if (unit !== undefined) {
      const line = this.lineForVariant(inventoryId, unit.variant_id);
      const already = this.db
        .prepare<[number, number], number>(
          'SELECT count(*) FROM inventory_unit_scans WHERE session_id = ? AND serial_unit_id = ?',
        )
        .pluck()
        .get(inventoryId, unit.id);
      if ((already ?? 0) > 0)
        throw new AppError('CONFLICT', `L’appareil ${unit.serial_number} est déjà compté.`);
      const counted = this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO inventory_unit_scans (session_id, serial_unit_id, user_id, scanned_at) VALUES (?, ?, ?, ?)',
          )
          .run(inventoryId, unit.id, actor.userId, nowIsoUtc());
        return this.syncTrackedCount(inventoryId, line.id, unit.variant_id);
      })();
      return {
        kind: 'unit',
        lineId: line.id,
        name: line.name,
        counted,
        serialNumber: unit.serial_number,
      };
    }
    const line = this.db
      .prepare<[number, string, string], LineRow>(
        `SELECT l.id, l.variant_id, p.name, v.sku, v.barcode, p.tracking_mode, l.counted_quantity
         FROM inventory_lines l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
         WHERE l.session_id = ? AND (v.barcode = ? OR v.sku = ? COLLATE NOCASE)`,
      )
      .get(inventoryId, code, code);
    if (line === undefined)
      throw new AppError('NOT_FOUND', `« ${code} » n’appartient pas à cet inventaire.`);
    if (line.tracking_mode !== 'none')
      throw new AppError(
        'VALIDATION_ERROR',
        `« ${line.name} » est suivi : scannez le numéro de chaque appareil.`,
      );
    const counted = (line.counted_quantity ?? 0) + 1;
    this.db
      .prepare('UPDATE inventory_lines SET counted_quantity = ? WHERE id = ?')
      .run(counted, line.id);
    return { kind: 'item', lineId: line.id, name: line.name, counted, serialNumber: null };
  }

  removeScan(actor: Session, inventoryId: number, unitId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    const variantId = this.db
      .prepare<[number], number>('SELECT variant_id FROM serial_units WHERE id = ?')
      .pluck()
      .get(unitId);
    if (variantId === undefined) throw new AppError('NOT_FOUND', 'Appareil introuvable.');
    const line = this.lineForVariant(inventoryId, variantId);
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM inventory_unit_scans WHERE session_id = ? AND serial_unit_id = ?')
        .run(inventoryId, unitId);
      this.syncTrackedCount(inventoryId, line.id, variantId);
    })();
    return this.detail(actor, inventoryId);
  }

  /** Lignes non comptées mises à zéro : action explicite, jamais implicite. */
  zeroUncounted(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    if (this.session(inventoryId).status !== 'counting')
      throw new AppError('CONFLICT', 'Le comptage de cet inventaire est terminé.');
    this.db
      .prepare(
        'UPDATE inventory_lines SET counted_quantity = 0 WHERE session_id = ? AND counted_quantity IS NULL',
      )
      .run(inventoryId);
    return this.detail(actor, inventoryId);
  }

  /** Fin du comptage : tous les articles comptés ; les appareils suivis comptent leurs numéros scannés. */
  finishCounting(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    if (this.session(inventoryId).status !== 'counting')
      throw new AppError('CONFLICT', 'Le comptage de cet inventaire est déjà terminé.');
    this.db.transaction(() => {
      const tracked = this.db
        .prepare<[number], { id: number; variant_id: number }>(
          `SELECT l.id, l.variant_id FROM inventory_lines l JOIN product_variants v ON v.id = l.variant_id
           JOIN products p ON p.id = v.product_id WHERE l.session_id = ? AND p.tracking_mode <> 'none'`,
        )
        .all(inventoryId);
      for (const line of tracked) this.syncTrackedCount(inventoryId, line.id, line.variant_id);
      const uncounted =
        this.db
          .prepare<[number], number>(
            'SELECT count(*) FROM inventory_lines WHERE session_id = ? AND counted_quantity IS NULL',
          )
          .pluck()
          .get(inventoryId) ?? 0;
      if (uncounted > 0) {
        throw new AppError(
          'CONFLICT',
          `${String(uncounted)} article(s) ne sont pas comptés : saisissez leur quantité ou mettez-les à zéro.`,
        );
      }
      this.setStatus(inventoryId, 'review');
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'inventory.counted',
        entityType: 'inventory_session',
        entityId: inventoryId,
      });
    })();
    return this.detail(actor, inventoryId);
  }

  resumeCounting(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    if (this.session(inventoryId).status !== 'review')
      throw new AppError('CONFLICT', 'Cet inventaire n’est pas en revue des écarts.');
    this.setStatus(inventoryId, 'counting');
    return this.detail(actor, inventoryId);
  }

  /**
   * Validation (gérant ou administrateur ; autre personne que le créateur si le double contrôle est
   * actif) : un mouvement « inventaire » par écart ; un appareil manquant sort nommément, un appareil
   * retrouvé revient en stock à cet emplacement.
   */
  validate(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.validate');
    const session = this.session(inventoryId);
    if (session.status !== 'review')
      throw new AppError('CONFLICT', 'Terminez le comptage avant de valider.');
    if (this.blockedByDoubleCheck(session, actor)) {
      throw new AppError(
        'FORBIDDEN',
        'Double contrôle : l’inventaire doit être validé par une autre personne que son créateur.',
      );
    }
    const reference = { type: 'inventory_session' as const, id: inventoryId };
    const reason = `Inventaire « ${session.name} »`;
    this.db.transaction(() => {
      const lines = this.db
        .prepare<[number], { variant_id: number; tracking_mode: TrackingMode; difference: number }>(
          `SELECT l.variant_id, p.tracking_mode, l.difference FROM inventory_lines l
           JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.session_id = ?`,
        )
        .all(inventoryId);
      let movements = 0;
      for (const line of lines) {
        const base = {
          variantId: line.variant_id,
          type: 'inventory' as const,
          userId: actor.userId,
          reason,
          reference,
        };
        if (line.tracking_mode === 'none') {
          if (line.difference === 0) continue;
          applyMovement(this.db, {
            ...base,
            locationId: session.location_id,
            quantityDelta: line.difference,
          });
          movements += 1;
          continue;
        }
        movements += this.reconcileUnits(session, line.variant_id, base);
      }
      const now = nowIsoUtc();
      this.db
        .prepare(
          "UPDATE inventory_sessions SET status = 'validated', validated_by = ?, validated_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(actor.userId, now, now, inventoryId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'inventory.validated',
        entityType: 'inventory_session',
        entityId: inventoryId,
        details: { movements, differences: lines.filter((line) => line.difference !== 0).length },
      });
    })();
    return this.detail(actor, inventoryId);
  }

  cancel(actor: Session, inventoryId: number): InventoryDetail {
    requirePermission(actor, 'inventory.manage');
    const session = this.session(inventoryId);
    if (session.status === 'validated' || session.status === 'cancelled')
      throw new AppError('CONFLICT', 'Cet inventaire est déjà terminé.');
    this.db.transaction(() => {
      this.setStatus(inventoryId, 'cancelled');
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'inventory.cancelled',
        entityType: 'inventory_session',
        entityId: inventoryId,
      });
    })();
    return this.detail(actor, inventoryId);
  }

  /** Appareils suivis : manquants sortis (« sorti du stock »), retrouvés remis à l'emplacement. */
  private reconcileUnits(
    session: SessionRow,
    variantId: number,
    base: {
      variantId: number;
      type: 'inventory';
      userId: number;
      reason: string;
      reference: { type: 'inventory_session'; id: number };
    },
  ): number {
    const present = unitsAt(this.db, variantId, session.location_id);
    const scanned = this.db
      .prepare<[number, number], { id: number; status: string }>(
        `SELECT u.id, u.status FROM inventory_unit_scans s JOIN serial_units u ON u.id = s.serial_unit_id
         WHERE s.session_id = ? AND u.variant_id = ?`,
      )
      .all(session.id, variantId);
    const scannedIds = new Set(scanned.map((unit) => unit.id));
    const presentIds = new Set(present.map((unit) => unit.id));
    let movements = 0;
    for (const unit of present) {
      if (scannedIds.has(unit.id)) continue;
      applyMovement(this.db, {
        ...base,
        locationId: session.location_id,
        quantityDelta: -1,
        serialUnitId: unit.id,
      });
      setUnitStatus(this.db, unit.id, 'written_off');
      movements += 1;
    }
    for (const unit of scanned) {
      // Vendu ou rendu au fournisseur depuis le scan : il n'est plus dans le stock de la boutique.
      if (presentIds.has(unit.id) || unit.status === 'sold' || unit.status === 'supplier_returned')
        continue;
      const elsewhere = unitLocation(this.db, unit.id);
      const lastDelta = this.db
        .prepare<[number], number>(
          'SELECT quantity_delta FROM stock_movements WHERE serial_unit_id = ? ORDER BY id DESC LIMIT 1',
        )
        .pluck()
        .get(unit.id);
      if (elsewhere !== null && (lastDelta ?? 0) > 0) {
        // Rangé ailleurs selon le stock : il quitte cet emplacement théorique pour celui de l'inventaire.
        applyMovement(this.db, {
          ...base,
          locationId: elsewhere,
          quantityDelta: -1,
          serialUnitId: unit.id,
        });
      }
      if (unit.status === 'written_off') setUnitStatus(this.db, unit.id, 'in_stock');
      applyMovement(this.db, {
        ...base,
        locationId: session.location_id,
        quantityDelta: 1,
        serialUnitId: unit.id,
      });
      movements += 1;
    }
    return movements;
  }

  private syncTrackedCount(inventoryId: number, lineId: number, variantId: number): number {
    const counted =
      this.db
        .prepare<[number, number], number>(
          `SELECT count(*) FROM inventory_unit_scans s JOIN serial_units u ON u.id = s.serial_unit_id
           WHERE s.session_id = ? AND u.variant_id = ?`,
        )
        .pluck()
        .get(inventoryId, variantId) ?? 0;
    this.db
      .prepare('UPDATE inventory_lines SET counted_quantity = ? WHERE id = ?')
      .run(counted, lineId);
    return counted;
  }

  private blockedByDoubleCheck(session: SessionRow, actor: Session): boolean {
    return (
      session.created_by === actor.userId &&
      getSetting(this.db, 'inventory.double_check', z.boolean())
    );
  }

  private setStatus(inventoryId: number, status: InventoryStatus): void {
    this.db
      .prepare('UPDATE inventory_sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIsoUtc(), inventoryId);
  }

  private session(inventoryId: number): SessionRow {
    const row = this.db
      .prepare<[number], SessionRow>(`${SESSION_SELECT} WHERE s.id = ?`)
      .get(inventoryId);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Inventaire introuvable.');
    return row;
  }

  private line(inventoryId: number, lineId: number): LineRow {
    const row = this.db
      .prepare<[number, number], LineRow>(
        `SELECT l.id, l.variant_id, p.name, p.tracking_mode FROM inventory_lines l
         JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
         WHERE l.session_id = ? AND l.id = ?`,
      )
      .get(inventoryId, lineId);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Ligne d’inventaire introuvable.');
    return row;
  }

  private lineForVariant(inventoryId: number, variantId: number): { id: number; name: string } {
    const row = this.db
      .prepare<[number, number], { id: number; name: string }>(
        `SELECT l.id, p.name FROM inventory_lines l JOIN product_variants v ON v.id = l.variant_id
         JOIN products p ON p.id = v.product_id WHERE l.session_id = ? AND l.variant_id = ?`,
      )
      .get(inventoryId, variantId);
    if (row === undefined)
      throw new AppError(
        'NOT_FOUND',
        'Cet appareil n’appartient pas au périmètre de l’inventaire.',
      );
    return row;
  }

  private summary(row: SessionRow, withCost: boolean): InventorySummary {
    const scope =
      row.scope_type === 'all'
        ? 'Tout le stock'
        : row.scope_type === 'brand'
          ? `Marque : ${listBrands(this.db).find((brand) => brand.id === row.scope_id)?.name ?? ''}`
          : `Catégorie : ${listCategories(this.db).find((category) => category.id === row.scope_id)?.name ?? ''}`;
    return {
      id: row.id,
      name: row.name,
      scopeLabel: scope,
      locationName: row.location_name,
      status: row.status,
      createdAt: row.created_at,
      createdBy: row.creator,
      validatedAt: row.validated_at,
      validatedBy: row.validator,
      lineCount: row.line_count,
      countedCount: row.counted_count,
      differenceCount: row.difference_count,
      differenceValue: withCost ? row.difference_value : null,
    };
  }
}
