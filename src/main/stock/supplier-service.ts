import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import { variantLabel } from '@shared/catalog/tree';
import type { Condition } from '@shared/catalog/constants';
import type {
  CreateReceiptInput,
  PaymentMethod,
  ReceiptDetail,
  ReceiptSummary,
  SaveSupplierInput,
  Supplier,
  SupplierDetail,
  SupplierPaymentInput,
  SupplierReturnInput,
} from '@shared/schemas/stock';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { applyMovement } from './movements';
import {
  insertUnit,
  normalizedSerials,
  requireUnitsAt,
  setUnitStatus,
  stockedVariant,
} from './units';

interface SupplierRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: number;
  balance: number;
  receipt_count: number;
}

const SUPPLIER_SELECT = `
  SELECT s.id, s.name, s.phone, s.email, s.address, s.notes, s.is_active, b.balance,
         (SELECT count(*) FROM goods_receipts r WHERE r.supplier_id = s.id AND r.status = 'validated') AS receipt_count
  FROM suppliers s JOIN v_supplier_balances b ON b.supplier_id = s.id`;

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active === 1,
    balance: row.balance,
    receiptCount: row.receipt_count,
  };
}

const RECEIPT_SELECT = `
  SELECT r.id, r.number, r.supplier_id, s.name AS supplier_name, l.name AS location_name,
         r.received_at, r.total_cost, r.status, u.full_name AS user_name, r.notes,
         coalesce((SELECT sum(p.amount) FROM supplier_payments p WHERE p.receipt_id = r.id), 0) AS paid,
         (SELECT count(*) FROM goods_receipt_lines gl WHERE gl.receipt_id = r.id) AS line_count
  FROM goods_receipts r
  JOIN suppliers s ON s.id = r.supplier_id
  JOIN stock_locations l ON l.id = r.location_id
  JOIN users u ON u.id = r.user_id`;

interface ReceiptRow {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name: string;
  location_name: string;
  received_at: string;
  total_cost: number;
  status: ReceiptSummary['status'];
  user_name: string;
  notes: string | null;
  paid: number;
  line_count: number;
}

function toReceipt(row: ReceiptRow): ReceiptSummary {
  return {
    id: row.id,
    number: row.number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    locationName: row.location_name,
    receivedAt: row.received_at,
    totalCost: row.total_cost,
    paid: row.paid,
    lineCount: row.line_count,
    status: row.status,
    userName: row.user_name,
  };
}

/** Date choisie (AAAA-MM-JJ) → instant UTC à midi, sans décalage de jour selon le fuseau. */
function dayToIso(day: string): string {
  const instant = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) throw new AppError('VALIDATION_ERROR', 'Date invalide.');
  return instant.toISOString();
}

/**
 * Fournisseurs et achats (4.7) : fiches, bons de réception (entrées de stock), paiements, soldes dus,
 * retours fournisseur. Les montants d'achat exigent cost.view.
 */
export class SupplierService {
  constructor(private readonly db: Db) {}

  list(actor: Session): Supplier[] {
    requirePermission(actor, 'supplier.manage');
    return this.db
      .prepare<[], SupplierRow>(`${SUPPLIER_SELECT} ORDER BY s.name COLLATE NOCASE`)
      .all()
      .map(toSupplier);
  }

  detail(actor: Session, supplierId: number): SupplierDetail {
    requirePermission(actor, 'supplier.manage');
    requirePermission(actor, 'cost.view');
    const supplier = this.existing(supplierId);
    return {
      supplier,
      receipts: this.db
        .prepare<[number], ReceiptRow>(
          `${RECEIPT_SELECT} WHERE r.supplier_id = ? ORDER BY r.received_at DESC, r.id DESC`,
        )
        .all(supplierId)
        .map(toReceipt),
      payments: this.db
        .prepare<
          [number],
          {
            id: number;
            number: string | null;
            amount: number;
            method: PaymentMethod;
            reference: string | null;
            paid_at: string;
            user_name: string;
          }
        >(
          `SELECT p.id, r.number, p.amount, p.method, p.reference, p.paid_at, u.full_name AS user_name
           FROM supplier_payments p
           LEFT JOIN goods_receipts r ON r.id = p.receipt_id
           JOIN users u ON u.id = p.user_id
           WHERE p.supplier_id = ? ORDER BY p.paid_at DESC, p.id DESC`,
        )
        .all(supplierId)
        .map((row) => ({
          id: row.id,
          receiptNumber: row.number,
          amount: row.amount,
          method: row.method,
          reference: row.reference,
          paidAt: row.paid_at,
          userName: row.user_name,
        })),
    };
  }

  save(actor: Session, input: SaveSupplierInput): Supplier {
    requirePermission(actor, 'supplier.manage');
    const homonym = this.db
      .prepare<[string], number>('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE')
      .pluck()
      .get(input.name);
    if (homonym !== undefined && homonym !== input.id) {
      throw new AppError('CONFLICT', 'Un fournisseur porte déjà ce nom.');
    }
    if (input.id !== undefined) this.existing(input.id);
    const now = nowIsoUtc();
    const id = this.db.transaction(() => {
      const values = [
        input.name,
        input.phone,
        input.email,
        input.address,
        input.notes,
        input.isActive ? 1 : 0,
      ];
      let supplierId: number;
      if (input.id === undefined) {
        supplierId = Number(
          this.db
            .prepare(
              `INSERT INTO suppliers (name, phone, email, address, notes, is_active, created_at, updated_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(...values, now, now, actor.userId).lastInsertRowid,
        );
      } else {
        supplierId = input.id;
        this.db
          .prepare(
            'UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?',
          )
          .run(...values, now, input.id);
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: input.id === undefined ? 'supplier.created' : 'supplier.updated',
        entityType: 'supplier',
        entityId: supplierId,
        details: { name: input.name, isActive: input.isActive },
      });
      return supplierId;
    })();
    return this.existing(id);
  }

  /** Paiement d'un fournisseur ; jamais au-delà du solde dû (ni de celui de l'entrée visée). */
  pay(actor: Session, input: SupplierPaymentInput): Supplier {
    requirePermission(actor, 'supplier.manage');
    const supplier = this.existing(input.supplierId);
    if (input.amount > supplier.balance) {
      throw new AppError('CONFLICT', 'Le paiement dépasse le solde dû à ce fournisseur.');
    }
    if (input.receiptId !== null) {
      const receipt = this.db
        .prepare<[number], ReceiptRow>(`${RECEIPT_SELECT} WHERE r.id = ?`)
        .get(input.receiptId);
      if (receipt?.supplier_id !== input.supplierId || receipt.status !== 'validated') {
        throw new AppError('NOT_FOUND', 'Entrée de marchandise introuvable pour ce fournisseur.');
      }
      if (input.amount > receipt.total_cost - receipt.paid) {
        throw new AppError('CONFLICT', `Le paiement dépasse le reste dû sur ${receipt.number}.`);
      }
    }
    this.db.transaction(() => {
      this.insertPayment(actor, input.supplierId, input.receiptId, input, dayToIso(input.paidOn));
    })();
    return this.existing(input.supplierId);
  }

  receipts(actor: Session, limit: number): ReceiptSummary[] {
    requirePermission(actor, 'stock.adjust');
    requirePermission(actor, 'cost.view');
    return this.db
      .prepare<[number], ReceiptRow>(`${RECEIPT_SELECT} ORDER BY r.id DESC LIMIT ?`)
      .all(limit)
      .map(toReceipt);
  }

  receipt(actor: Session, receiptId: number): ReceiptDetail {
    requirePermission(actor, 'stock.adjust');
    requirePermission(actor, 'cost.view');
    const row = this.db
      .prepare<[number], ReceiptRow>(`${RECEIPT_SELECT} WHERE r.id = ?`)
      .get(receiptId);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Entrée de marchandise introuvable.');
    const lines = this.db
      .prepare<
        [number],
        {
          id: number;
          variant_id: number;
          name: string;
          sku: string;
          color: string | null;
          storage_gb: number | null;
          ram_gb: number | null;
          condition: Condition;
          quantity: number;
          unit_cost: number;
        }
      >(
        `SELECT gl.id, gl.variant_id, p.name, v.sku, v.color, v.storage_gb, v.ram_gb, v.condition,
                gl.quantity, gl.unit_cost
         FROM goods_receipt_lines gl
         JOIN product_variants v ON v.id = gl.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE gl.receipt_id = ? ORDER BY gl.id`,
      )
      .all(receiptId);
    const serials = this.db.prepare<[number], string>(
      'SELECT serial_number FROM serial_units WHERE receipt_line_id = ? ORDER BY id',
    );
    return {
      receipt: toReceipt(row),
      notes: row.notes,
      lines: lines.map((line) => ({
        variantId: line.variant_id,
        productName: line.name,
        variantLabel: variantLabel({
          color: line.color,
          storageGb: line.storage_gb,
          ramGb: line.ram_gb,
          condition: line.condition,
        }),
        sku: line.sku,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        serials: serials.pluck().all(line.id),
      })),
    };
  }

  /**
   * Entrée de marchandise (4.3) en une transaction : bon numéroté, lignes, unités suivies (un
   * numéro par article), mouvements d'achat et coût moyen pondéré, validation, paiement éventuel.
   */
  receive(actor: Session, input: CreateReceiptInput): ReceiptDetail {
    requirePermission(actor, 'stock.adjust');
    requirePermission(actor, 'supplier.manage');
    requirePermission(actor, 'cost.view');
    const supplier = this.existing(input.supplierId);
    if (!supplier.isActive) throw new AppError('VALIDATION_ERROR', 'Ce fournisseur est archivé.');
    const location = this.db
      .prepare<[number], number>('SELECT is_active FROM stock_locations WHERE id = ?')
      .pluck()
      .get(input.locationId);
    if (location !== 1)
      throw new AppError('VALIDATION_ERROR', 'Emplacement introuvable ou désactivé.');
    const lines = input.lines.map((line) => {
      const variant = stockedVariant(this.db, line.variantId);
      if (variant.trackingMode === 'none') {
        if ((line.serials ?? []).length > 0) {
          throw new AppError('VALIDATION_ERROR', `« ${variant.name} » n’est pas suivi par numéro.`);
        }
        return { ...line, variant, serials: [] };
      }
      const serials = normalizedSerials(line.serials ?? []);
      if (serials.length !== line.quantity) {
        throw new AppError(
          'VALIDATION_ERROR',
          `« ${variant.name} » : ${String(line.quantity)} article(s) reçus, ${String(serials.length)} numéro(s) saisis.`,
        );
      }
      return { ...line, variant, serials };
    });
    normalizedSerials(lines.flatMap((line) => line.serials));
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
    if (input.payment !== null && input.payment.amount > total) {
      throw new AppError('VALIDATION_ERROR', 'Le paiement dépasse le total de l’entrée.');
    }
    const receivedAt = dayToIso(input.receivedOn);
    const receiptId = this.db.transaction(() => {
      const now = nowIsoUtc();
      const number = this.nextNumber(input.receivedOn.slice(0, 4));
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO goods_receipts (number, supplier_id, location_id, received_at, total_cost, status,
                                         notes, user_id, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?)`,
          )
          .run(
            number,
            input.supplierId,
            input.locationId,
            receivedAt,
            input.notes,
            actor.userId,
            now,
            now,
            actor.userId,
          ).lastInsertRowid,
      );
      const reference = { type: 'goods_receipt' as const, id };
      const insertLine = this.db.prepare(
        'INSERT INTO goods_receipt_lines (receipt_id, variant_id, quantity, unit_cost) VALUES (?, ?, ?, ?)',
      );
      for (const line of lines) {
        const lineId = Number(
          insertLine.run(id, line.variantId, line.quantity, line.unitCost).lastInsertRowid,
        );
        const base = {
          variantId: line.variantId,
          locationId: input.locationId,
          type: 'purchase' as const,
          userId: actor.userId,
          unitCost: line.unitCost,
          reference,
        };
        if (line.serials.length === 0) {
          applyMovement(this.db, { ...base, quantityDelta: line.quantity });
          continue;
        }
        line.serials.forEach((entry, index) => {
          const unitId = insertUnit(this.db, line.variantId, entry, {
            receiptLineId: lineId,
            userId: actor.userId,
          });
          applyMovement(this.db, {
            ...base,
            quantityDelta: 1,
            serialUnitId: unitId,
            averageQuantity: index === 0 ? line.quantity : 0,
          });
        });
      }
      this.db
        .prepare(
          "UPDATE goods_receipts SET total_cost = ?, status = 'validated', validated_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(total, now, now, id);
      if (input.payment !== null) {
        this.insertPayment(actor, input.supplierId, id, input.payment, receivedAt);
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'stock.goods_received',
        entityType: 'goods_receipt',
        entityId: id,
        details: { number, supplierId: input.supplierId, lines: lines.length, total },
      });
      return id;
    })();
    return this.receipt(actor, receiptId);
  }

  /** Retour au fournisseur (4.3) : sortie « purchase_return » ; une unité suivie passe à « rendu ». */
  returnToSupplier(actor: Session, input: SupplierReturnInput): { movements: number } {
    requirePermission(actor, 'stock.adjust');
    requirePermission(actor, 'supplier.manage');
    const supplier = this.existing(input.supplierId);
    const variant = stockedVariant(this.db, input.variantId);
    const movements = this.db.transaction(() => {
      const base = {
        variantId: input.variantId,
        locationId: input.locationId,
        type: 'purchase_return' as const,
        userId: actor.userId,
        reason: `${supplier.name} : ${input.reason}`,
      };
      let count = 0;
      if (variant.trackingMode === 'none') {
        applyMovement(this.db, { ...base, quantityDelta: -input.quantity });
        count = 1;
      } else {
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
          setUnitStatus(this.db, unit.id, 'supplier_returned');
          count += 1;
        }
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'stock.supplier_return',
        entityType: 'supplier',
        entityId: supplier.id,
        details: { variantId: input.variantId, quantity: input.quantity, reason: input.reason },
      });
      return count;
    })();
    return { movements };
  }

  private insertPayment(
    actor: Session,
    supplierId: number,
    receiptId: number | null,
    payment: { amount: number; method: PaymentMethod; reference: string | null },
    paidAt: string,
  ): void {
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO supplier_payments (supplier_id, receipt_id, amount, method, reference, paid_at, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          supplierId,
          receiptId,
          payment.amount,
          payment.method,
          payment.reference,
          paidAt,
          actor.userId,
          nowIsoUtc(),
        ).lastInsertRowid,
    );
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'supplier.paid',
      entityType: 'supplier_payment',
      entityId: id,
      details: { supplierId, receiptId, amount: payment.amount, method: payment.method },
    });
  }

  /** Numéro de bon de réception : BR-2026-00001, sans trou dans l'année. */
  private nextNumber(year: string): string {
    const last = this.db
      .prepare<[string], string>(
        'SELECT number FROM goods_receipts WHERE number LIKE ? ORDER BY number DESC LIMIT 1',
      )
      .pluck()
      .get(`BR-${year}-%`);
    const sequence = last === undefined ? 1 : Number(last.slice(-5)) + 1;
    return `BR-${year}-${String(sequence).padStart(5, '0')}`;
  }

  private existing(id: number): Supplier {
    const row = this.db.prepare<[number], SupplierRow>(`${SUPPLIER_SELECT} WHERE s.id = ?`).get(id);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Fournisseur introuvable.');
    return toSupplier(row);
  }
}
