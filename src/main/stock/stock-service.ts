import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import { descendantIds, variantLabel } from '@shared/catalog/tree';
import type { Condition, TrackingMode } from '@shared/catalog/constants';
import type {
  AvailableUnit,
  Location,
  Movement,
  MovementListInput,
  MovementType,
  SaveLocationInput,
  StockExitInput,
  StockOverviewInput,
  StockRow,
  TransferInput,
  Valuation,
} from '@shared/schemas/stock';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import { ftsQuery } from '../catalog/product-search';
import { listCategories } from '../catalog/reference-repository';
import type { Db } from '../db/types';
import { applyMovement } from './movements';
import {
  insertUnit,
  normalizedSerials,
  requireUnitsAt,
  setUnitStatus,
  stockedVariant,
  unitsAt,
} from './units';

interface LocationRow {
  id: number;
  name: string;
  is_default: number;
  is_active: number;
  units: number;
}

/** Stock multi-emplacements (4.3, 4.12) : consultation, sorties, transferts, valorisation. */
export class StockService {
  constructor(private readonly db: Db) {}

  locations(actor: Session): Location[] {
    requirePermission(actor, 'stock.view');
    return this.db
      .prepare<[], LocationRow>(
        `SELECT l.id, l.name, l.is_default, l.is_active,
                coalesce((SELECT sum(s.quantity) FROM stock_levels s WHERE s.location_id = l.id), 0) AS units
         FROM stock_locations l ORDER BY l.is_default DESC, l.name`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        isDefault: row.is_default === 1,
        isActive: row.is_active === 1,
        units: row.units,
      }));
  }

  /** Emplacements : réservés à l'administrateur ; un emplacement non vide reste actif. */
  saveLocation(actor: Session, input: SaveLocationInput): Location {
    requirePermission(actor, 'settings.manage');
    const existing = this.locations(actor);
    const current =
      input.id === undefined ? null : existing.find((location) => location.id === input.id);
    if (current === undefined) throw new AppError('NOT_FOUND', 'Emplacement introuvable.');
    if (input.isDefault && !input.isActive) {
      throw new AppError('VALIDATION_ERROR', 'L’emplacement par défaut doit rester actif.');
    }
    if (current !== null && !input.isActive && current.units > 0) {
      throw new AppError(
        'CONFLICT',
        'Cet emplacement contient du stock : transférez-le avant de le désactiver.',
      );
    }
    if (current?.isDefault === true && !input.isDefault) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Choisissez un autre emplacement par défaut plutôt que de retirer celui-ci.',
      );
    }
    const now = nowIsoUtc();
    const id = this.db.transaction(() => {
      if (input.isDefault) {
        this.db
          .prepare('UPDATE stock_locations SET is_default = 0, updated_at = ? WHERE is_default = 1')
          .run(now);
      }
      let locationId: number;
      if (current === null) {
        locationId = Number(
          this.db
            .prepare(
              `INSERT INTO stock_locations (name, is_default, is_active, created_at, updated_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.name,
              input.isDefault ? 1 : 0,
              input.isActive ? 1 : 0,
              now,
              now,
              actor.userId,
            ).lastInsertRowid,
        );
      } else {
        locationId = current.id;
        this.db
          .prepare(
            'UPDATE stock_locations SET name = ?, is_default = ?, is_active = ?, updated_at = ? WHERE id = ?',
          )
          .run(input.name, input.isDefault ? 1 : 0, input.isActive ? 1 : 0, now, current.id);
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: current === null ? 'stock.location_created' : 'stock.location_updated',
        entityType: 'stock_location',
        entityId: locationId,
        details: { ...input },
      });
      return locationId;
    })();
    const saved = this.locations(actor).find((location) => location.id === id);
    if (saved === undefined) throw new AppError('NOT_FOUND', 'Emplacement introuvable.');
    return saved;
  }

  /** État du stock par variante et par emplacement, paginé côté base. */
  overview(actor: Session, input: StockOverviewInput): { total: number; rows: StockRow[] } {
    requirePermission(actor, 'stock.view');
    const fts = input.query === undefined ? null : ftsQuery(input.query);
    const conditions = ['p.is_stocked = 1', 'p.is_active = 1', 'v.is_active = 1'];
    const params: Record<string, unknown> = {};
    if (fts !== null) params.fts = fts;
    if (input.categoryId !== undefined) {
      conditions.push('p.category_id IN (SELECT value FROM json_each(@categories))');
      params.categories = JSON.stringify(descendantIds(listCategories(this.db), input.categoryId));
    }
    if (input.locationId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM stock_levels s WHERE s.variant_id = v.id AND s.location_id = @location AND s.quantity > 0)',
      );
      params.location = input.locationId;
    }
    if (input.lowStock === true) {
      conditions.push(
        'p.reorder_level > 0 AND coalesce((SELECT sum(s.quantity) FROM stock_levels s WHERE s.variant_id = v.id), 0) <= p.reorder_level',
      );
    }
    const from =
      (fts === null
        ? 'FROM product_variants v'
        : `FROM (SELECT rowid AS id FROM products_fts WHERE products_fts MATCH @fts) hits
           CROSS JOIN product_variants v ON v.id = hits.id`) +
      ` JOIN products p ON p.id = v.product_id WHERE ${conditions.join(' AND ')}`;
    const total =
      this.db
        .prepare<Record<string, unknown>, number>(`SELECT count(*) ${from}`)
        .pluck()
        .get(params) ?? 0;
    const ids = this.db
      .prepare<Record<string, unknown>, number>(
        `SELECT v.id ${from} ORDER BY p.name COLLATE NOCASE, v.id LIMIT @limit OFFSET @offset`,
      )
      .pluck()
      .all({ ...params, limit: input.limit, offset: input.offset });
    return { total, rows: this.stockRows(ids, actor.permissions.has('cost.view')) };
  }

  private stockRows(ids: readonly number[], withCost: boolean): StockRow[] {
    if (ids.length === 0) return [];
    const json = JSON.stringify(ids);
    const rows = this.db
      .prepare<
        [string],
        {
          variant_id: number;
          product_id: number;
          name: string;
          sku: string;
          color: string | null;
          storage_gb: number | null;
          ram_gb: number | null;
          condition: Condition;
          family_name: string;
          tracking_mode: TrackingMode;
          reorder_level: number;
          sale_price: number;
          avg_cost: number;
        }
      >(
        `SELECT v.id AS variant_id, p.id AS product_id, p.name, v.sku, v.color, v.storage_gb, v.ram_gb,
                v.condition, f.family_name, p.tracking_mode, p.reorder_level, v.sale_price, v.avg_cost
         FROM json_each(?) page
         JOIN product_variants v ON v.id = page.value
         JOIN products p ON p.id = v.product_id
         JOIN v_category_families f ON f.category_id = p.category_id
         ORDER BY page.key`,
      )
      .all(json);
    const levels = this.db
      .prepare<[string], { variant_id: number; location_id: number; quantity: number }>(
        `SELECT variant_id, location_id, quantity FROM stock_levels
         WHERE variant_id IN (SELECT value FROM json_each(?)) AND quantity > 0 ORDER BY location_id`,
      )
      .all(json);
    return rows.map((row) => {
      const quantities = levels
        .filter((level) => level.variant_id === row.variant_id)
        .map((level) => ({ locationId: level.location_id, quantity: level.quantity }));
      return {
        variantId: row.variant_id,
        productId: row.product_id,
        name: row.name,
        variantLabel: variantLabel({
          color: row.color,
          storageGb: row.storage_gb,
          ramGb: row.ram_gb,
          condition: row.condition,
        }),
        sku: row.sku,
        familyName: row.family_name,
        trackingMode: row.tracking_mode,
        quantities,
        total: quantities.reduce((sum, level) => sum + level.quantity, 0),
        reorderLevel: row.reorder_level,
        salePrice: row.sale_price,
        avgCost: withCost ? row.avg_cost : null,
      };
    });
  }

  /** Valorisation (4.3) : au coût moyen (avec cost.view) et au prix de vente. */
  valuation(actor: Session): Valuation {
    requirePermission(actor, 'stock.view');
    const withCost = actor.permissions.has('cost.view');
    const sums = `sum(s.quantity) AS units, sum(s.quantity * v.avg_cost) AS cost, sum(s.quantity * v.sale_price) AS sale`;
    const byLocation = this.db
      .prepare<
        [],
        { id: number; name: string; units: number | null; cost: number | null; sale: number | null }
      >(
        `SELECT l.id, l.name, ${sums}
         FROM stock_locations l
         LEFT JOIN stock_levels s ON s.location_id = l.id
         LEFT JOIN product_variants v ON v.id = s.variant_id
         GROUP BY l.id ORDER BY l.is_default DESC, l.name`,
      )
      .all();
    const byFamily = this.db
      .prepare<[], { id: number; name: string; units: number; cost: number; sale: number }>(
        `SELECT f.family_id AS id, f.family_name AS name, ${sums}
         FROM stock_levels s
         JOIN product_variants v ON v.id = s.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN v_category_families f ON f.category_id = p.category_id
         WHERE s.quantity > 0
         GROUP BY f.family_id ORDER BY f.family_name`,
      )
      .all();
    const units = byLocation.reduce((sum, row) => sum + (row.units ?? 0), 0);
    const cost = byLocation.reduce((sum, row) => sum + (row.cost ?? 0), 0);
    const sale = byLocation.reduce((sum, row) => sum + (row.sale ?? 0), 0);
    return {
      totalCost: withCost ? cost : null,
      totalSale: sale,
      units,
      byLocation: byLocation.map((row) => ({
        locationId: row.id,
        name: row.name,
        units: row.units ?? 0,
        cost: withCost ? (row.cost ?? 0) : null,
        sale: row.sale ?? 0,
      })),
      byFamily: byFamily.map((row) => ({
        familyId: row.id,
        name: row.name,
        units: row.units,
        cost: withCost ? row.cost : null,
        sale: row.sale,
      })),
    };
  }

  /** Nombre d'articles sous le seuil d'alerte (indicateur permanent, A.3). */
  alerts(actor: Session): { lowStock: number } {
    requirePermission(actor, 'stock.view');
    return {
      lowStock: this.db.prepare<[], number>('SELECT count(*) FROM v_low_stock').pluck().get() ?? 0,
    };
  }

  /** Historique des mouvements (4.3), du plus récent au plus ancien. */
  movements(actor: Session, input: MovementListInput): Movement[] {
    requirePermission(actor, 'stock.view');
    const withCost = actor.permissions.has('cost.view');
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit: input.limit };
    if (input.variantId !== undefined) {
      conditions.push('m.variant_id = @variant');
      params.variant = input.variantId;
    }
    if (input.locationId !== undefined) {
      conditions.push('m.location_id = @location');
      params.location = input.locationId;
    }
    if (input.type !== undefined) {
      conditions.push('m.movement_type = @type');
      params.type = input.type;
    }
    if (input.beforeId !== undefined) {
      conditions.push('m.id < @before');
      params.before = input.beforeId;
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    return this.db
      .prepare<
        Record<string, unknown>,
        {
          id: number;
          created_at: string;
          variant_id: number;
          product_name: string;
          sku: string;
          color: string | null;
          storage_gb: number | null;
          ram_gb: number | null;
          condition: Condition;
          location_name: string;
          movement_type: MovementType;
          quantity_delta: number;
          quantity_after: number;
          unit_cost: number;
          serial_number: string | null;
          reason: string | null;
          reference_type: string | null;
          reference_id: number | null;
          receipt_number: string | null;
          user_name: string;
        }
      >(
        `SELECT m.id, m.created_at, m.variant_id, p.name AS product_name, v.sku, v.color, v.storage_gb,
                v.ram_gb, v.condition, l.name AS location_name, m.movement_type, m.quantity_delta,
                m.quantity_after, m.unit_cost, su.serial_number, m.reason, m.reference_type,
                m.reference_id, r.number AS receipt_number, u.full_name AS user_name
         FROM stock_movements m
         JOIN product_variants v ON v.id = m.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN stock_locations l ON l.id = m.location_id
         JOIN users u ON u.id = m.user_id
         LEFT JOIN serial_units su ON su.id = m.serial_unit_id
         LEFT JOIN goods_receipts r ON m.reference_type = 'goods_receipt' AND r.id = m.reference_id
         ${where}
         ORDER BY m.id DESC LIMIT @limit`,
      )
      .all(params)
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        variantId: row.variant_id,
        productName: row.product_name,
        variantLabel: variantLabel({
          color: row.color,
          storageGb: row.storage_gb,
          ramGb: row.ram_gb,
          condition: row.condition,
        }),
        sku: row.sku,
        locationName: row.location_name,
        type: row.movement_type,
        quantityDelta: row.quantity_delta,
        quantityAfter: row.quantity_after,
        unitCost: withCost ? row.unit_cost : null,
        serialNumber: row.serial_number,
        reason: row.reason,
        reference:
          row.receipt_number ??
          (row.reference_type === 'transfer'
            ? `Transfert ${String(row.reference_id ?? '')}`
            : null),
        userName: row.user_name,
      }));
  }

  availableUnits(actor: Session, variantId: number, locationId: number): AvailableUnit[] {
    requirePermission(actor, 'stock.view');
    return unitsAt(this.db, variantId, locationId);
  }

  /**
   * Sortie (perte, casse, vol, usage interne) ou ajustement avec motif (4.3). Un article suivi sort
   * unité par unité et passe à « sorti du stock » ; un ajustement positif crée les unités saisies
   * ou réintègre une unité sortie retrouvée.
   */
  exit(actor: Session, input: StockExitInput): { movements: number } {
    requirePermission(actor, 'stock.adjust');
    const variant = stockedVariant(this.db, input.variantId);
    this.activeLocation(input.locationId);
    const sign = input.direction === 'in' ? 1 : -1;
    const movements = this.db.transaction(() => {
      const base = {
        variantId: input.variantId,
        locationId: input.locationId,
        type: input.type,
        userId: actor.userId,
        reason: input.reason,
      };
      let count = 0;
      if (variant.trackingMode === 'none') {
        applyMovement(this.db, { ...base, quantityDelta: sign * input.quantity });
        count = 1;
      } else if (sign < 0) {
        const units = requireUnitsAt(
          this.db,
          input.variantId,
          input.locationId,
          input.serialUnitIds ?? [],
          input.quantity,
          {
            inStockOnly: false,
          },
        );
        for (const unit of units) {
          applyMovement(this.db, { ...base, quantityDelta: -1, serialUnitId: unit.id });
          setUnitStatus(this.db, unit.id, 'written_off');
          count += 1;
        }
      } else {
        for (const entry of this.serialsFor(input.serials ?? [], input.quantity)) {
          const unitId =
            this.unitToReintegrate(input.variantId, entry.serialNumber) ??
            insertUnit(this.db, input.variantId, entry, {
              receiptLineId: null,
              userId: actor.userId,
            });
          applyMovement(this.db, { ...base, quantityDelta: 1, serialUnitId: unitId });
          count += 1;
        }
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: input.direction === 'in' ? 'stock.adjusted_in' : 'stock.exit',
        entityType: 'product',
        entityId: variant.productId,
        details: {
          variantId: input.variantId,
          locationId: input.locationId,
          type: input.type,
          quantity: input.quantity,
          reason: input.reason,
        },
      });
      return count;
    })();
    return { movements };
  }

  /** Transfert entre emplacements : une sortie et une entrée liées par le même numéro. */
  transfer(actor: Session, input: TransferInput): { transferId: number } {
    requirePermission(actor, 'stock.adjust');
    const variant = stockedVariant(this.db, input.variantId);
    this.activeLocation(input.fromLocationId);
    this.activeLocation(input.toLocationId);
    const transferId = this.db.transaction(() => {
      const id =
        this.db
          .prepare<[], number>('SELECT coalesce(max(id), 0) + 1 FROM stock_movements')
          .pluck()
          .get() ?? 1;
      const reference = { type: 'transfer' as const, id };
      const move = (quantity: number, serialUnitId: number | null): void => {
        const common = {
          variantId: input.variantId,
          userId: actor.userId,
          reason: input.reason,
          reference,
          serialUnitId,
        };
        applyMovement(this.db, {
          ...common,
          locationId: input.fromLocationId,
          type: 'transfer_out',
          quantityDelta: -quantity,
        });
        applyMovement(this.db, {
          ...common,
          locationId: input.toLocationId,
          type: 'transfer_in',
          quantityDelta: quantity,
        });
      };
      if (variant.trackingMode === 'none') move(input.quantity, null);
      else {
        const units = requireUnitsAt(
          this.db,
          input.variantId,
          input.fromLocationId,
          input.serialUnitIds ?? [],
          input.quantity,
          {
            inStockOnly: false,
          },
        );
        for (const unit of units) move(1, unit.id);
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'stock.transferred',
        entityType: 'product',
        entityId: variant.productId,
        details: { transferId: id, ...input },
      });
      return id;
    })();
    return { transferId };
  }

  private serialsFor(
    serials: readonly { serialNumber: string; imei2: string | null }[],
    quantity: number,
  ) {
    const entries = normalizedSerials(serials);
    if (entries.length !== quantity) {
      throw new AppError('VALIDATION_ERROR', 'Article suivi : saisissez un numéro par article.');
    }
    return entries;
  }

  /** Unité « sortie du stock » retrouvée : elle revient en stock au lieu d'être recréée. */
  private unitToReintegrate(variantId: number, serialNumber: string): number | null {
    const unit = this.db
      .prepare<[string], { id: number; variant_id: number; status: string }>(
        'SELECT id, variant_id, status FROM serial_units WHERE serial_number = ?',
      )
      .get(serialNumber);
    if (unit === undefined) return null;
    if (unit.variant_id !== variantId || unit.status !== 'written_off') {
      throw new AppError('CONFLICT', `Le numéro ${serialNumber} est déjà enregistré.`);
    }
    setUnitStatus(this.db, unit.id, 'in_stock');
    return unit.id;
  }

  private activeLocation(id: number): void {
    const active = this.db
      .prepare<[number], number>('SELECT is_active FROM stock_locations WHERE id = ?')
      .pluck()
      .get(id);
    if (active === undefined) throw new AppError('NOT_FOUND', 'Emplacement introuvable.');
    if (active !== 1) throw new AppError('VALIDATION_ERROR', 'Cet emplacement est désactivé.');
  }
}
