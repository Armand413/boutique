import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import { normalizeSerial } from '@shared/catalog/imei';
import { variantLabel } from '@shared/catalog/tree';
import type { Condition, SerialStatus } from '@shared/catalog/constants';
import type {
  Claim,
  ClaimStatus,
  Expiring,
  UpdateClaimInput,
  WarrantyLookup,
} from '@shared/schemas/inventory';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';

/** Étapes permises d'une réclamation ; « refusée » et « clôturée » sont définitives (la base le garantit). */
const NEXT: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  received: ['sent_to_supplier', 'repaired', 'replaced', 'rejected', 'closed'],
  sent_to_supplier: ['repaired', 'replaced', 'rejected', 'closed'],
  repaired: ['closed'],
  replaced: ['closed'],
  rejected: [],
  closed: [],
};

interface ClaimRow {
  id: number;
  serial_unit_id: number;
  serial_number: string;
  product_name: string;
  customer_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  issue: string;
  status: ClaimStatus;
  resolution: string | null;
  warranty_expired: number;
  opened_at: string;
  closed_at: string | null;
  user_name: string;
}

const CLAIM_SELECT = `
  SELECT w.id, w.serial_unit_id, u.serial_number, p.name AS product_name, c.full_name AS customer_name,
         w.supplier_id, sp.name AS supplier_name, w.issue, w.status, w.resolution, w.warranty_expired, w.opened_at, w.closed_at,
         us.full_name AS user_name
  FROM warranty_claims w
  JOIN serial_units u ON u.id = w.serial_unit_id
  JOIN product_variants v ON v.id = u.variant_id
  JOIN products p ON p.id = v.product_id
  LEFT JOIN customers c ON c.id = w.customer_id
  LEFT JOIN suppliers sp ON sp.id = w.supplier_id
  JOIN users us ON us.id = w.user_id`;

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    serialUnitId: row.serial_unit_id,
    serialNumber: row.serial_number,
    productName: row.product_name,
    customerName: row.customer_name,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    issue: row.issue,
    status: row.status,
    resolution: row.resolution,
    warrantyExpired: row.warranty_expired === 1,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    userName: row.user_name,
  };
}

/** Jours entre aujourd'hui (UTC) et une date AAAA-MM-JJ. */
function daysUntil(date: string, now: number): number {
  const today = new Date(new Date(now).toISOString().slice(0, 10)).getTime();
  return Math.round((new Date(date).getTime() - today) / 86_400_000);
}

/**
 * Garantie et SAV simplifié (4.12) : recherche par numéro de série ou IMEI, réclamations suivies
 * jusqu'à leur clôture, alerte si la garantie est dépassée. Aucun mouvement de stock automatique (D62).
 */
export class WarrantyService {
  constructor(
    private readonly db: Db,
    private readonly clock: () => number = Date.now,
  ) {}

  lookup(actor: Session, serial: string): WarrantyLookup {
    requirePermission(actor, 'warranty.manage');
    const code = normalizeSerial(serial);
    const row = this.db
      .prepare<
        [string, string],
        {
          id: number;
          serial_number: string;
          imei2: string | null;
          name: string;
          color: string | null;
          storage_gb: number | null;
          ram_gb: number | null;
          condition: Condition;
          status: SerialStatus;
          sale_id: number | null;
          invoice_number: string | null;
          sold_at: string | null;
          customer_id: number | null;
          full_name: string | null;
          phone: string | null;
          warranty_end: string | null;
        }
      >(
        `SELECT u.id, u.serial_number, u.imei2, p.name, v.color, v.storage_gb, v.ram_gb, v.condition, u.status,
                s.id AS sale_id, s.invoice_number, u.sold_at, c.id AS customer_id, c.full_name, c.phone, u.warranty_end
         FROM serial_units u
         JOIN product_variants v ON v.id = u.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN sale_lines l ON l.id = u.sale_line_id
         LEFT JOIN sales s ON s.id = l.sale_id AND s.status = 'completed'
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE u.serial_number = ? OR u.imei2 = ?`,
      )
      .get(code, code);
    if (row === undefined)
      throw new AppError('NOT_FOUND', `Aucun appareil enregistré avec le numéro ${code}.`);
    return {
      unitId: row.id,
      serialNumber: row.serial_number,
      imei2: row.imei2,
      productName: row.name,
      variantLabel: variantLabel({
        color: row.color,
        storageGb: row.storage_gb,
        ramGb: row.ram_gb,
        condition: row.condition,
      }),
      status: row.status,
      saleId: row.sale_id,
      invoiceNumber: row.invoice_number,
      soldAt: row.sold_at,
      customerId: row.customer_id,
      customerName: row.full_name,
      customerPhone: row.phone,
      warrantyEnd: row.warranty_end,
      daysLeft: row.warranty_end === null ? null : daysUntil(row.warranty_end, this.clock()),
      claims: this.db
        .prepare<[number], ClaimRow>(
          `${CLAIM_SELECT} WHERE w.serial_unit_id = ? ORDER BY w.id DESC`,
        )
        .all(row.id)
        .map(toClaim),
    };
  }

  /** Ouverture d'une réclamation sur un appareil vendu ; une garantie dépassée est signalée, pas bloquante. */
  open(actor: Session, serialUnitId: number, issue: string, supplierId: number | null): Claim {
    requirePermission(actor, 'warranty.manage');
    const unit = this.db
      .prepare<
        [number],
        {
          status: SerialStatus;
          warranty_end: string | null;
          sale_id: number | null;
          customer_id: number | null;
        }
      >(
        `SELECT u.status, u.warranty_end, l.sale_id, s.customer_id FROM serial_units u
         LEFT JOIN sale_lines l ON l.id = u.sale_line_id LEFT JOIN sales s ON s.id = l.sale_id WHERE u.id = ?`,
      )
      .get(serialUnitId);
    if (unit === undefined) throw new AppError('NOT_FOUND', 'Appareil introuvable.');
    if (unit.status !== 'sold')
      throw new AppError('CONFLICT', 'Une réclamation porte sur un appareil vendu.');
    const open = this.db
      .prepare<[number], number>(
        "SELECT count(*) FROM warranty_claims WHERE serial_unit_id = ? AND status NOT IN ('rejected', 'closed')",
      )
      .pluck()
      .get(serialUnitId);
    if ((open ?? 0) > 0)
      throw new AppError('CONFLICT', 'Une réclamation est déjà en cours pour cet appareil.');
    const openedAt = new Date(this.clock()).toISOString();
    const expired = unit.warranty_end === null || unit.warranty_end < openedAt.slice(0, 10);
    const id = this.db.transaction(() => {
      const claimId = Number(
        this.db
          .prepare(
            `INSERT INTO warranty_claims (serial_unit_id, sale_id, customer_id, supplier_id, issue, warranty_expired, opened_at, user_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            serialUnitId,
            unit.sale_id,
            unit.customer_id,
            supplierId,
            issue,
            expired ? 1 : 0,
            openedAt,
            actor.userId,
            openedAt,
          ).lastInsertRowid,
      );
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'warranty.claim_opened',
        entityType: 'warranty_claim',
        entityId: claimId,
        details: { serialUnitId, warrantyExpired: expired },
      });
      return claimId;
    })();
    return this.claim(id);
  }

  update(actor: Session, input: UpdateClaimInput): Claim {
    requirePermission(actor, 'warranty.manage');
    const current = this.claim(input.claimId);
    if (input.status !== current.status && !NEXT[current.status].includes(input.status)) {
      throw new AppError('CONFLICT', 'Étape impossible pour cette réclamation.');
    }
    if (
      (input.status === 'rejected' || input.status === 'closed') &&
      input.resolution === null &&
      current.resolution === null
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Indiquez la solution ou le motif du refus avant de clôturer.',
      );
    }
    const now = nowIsoUtc();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE warranty_claims SET status = ?, resolution = coalesce(?, resolution), supplier_id = ?, closed_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.status,
          input.resolution,
          input.supplierId,
          input.status === 'rejected' || input.status === 'closed' ? now : null,
          now,
          input.claimId,
        );
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'warranty.claim_updated',
        entityType: 'warranty_claim',
        entityId: input.claimId,
        details: { from: current.status, to: input.status },
      });
    })();
    return this.claim(input.claimId);
  }

  list(actor: Session, scope: 'open' | 'all', limit: number): Claim[] {
    requirePermission(actor, 'warranty.manage');
    const where = scope === 'open' ? "WHERE w.status NOT IN ('rejected', 'closed')" : '';
    return this.db
      .prepare<[number], ClaimRow>(`${CLAIM_SELECT} ${where} ORDER BY w.id DESC LIMIT ?`)
      .all(limit)
      .map(toClaim);
  }

  /** Garanties qui se terminent dans les 30 jours (vue v_warranty_expiring). */
  expiring(actor: Session): Expiring[] {
    requirePermission(actor, 'warranty.manage');
    return this.db
      .prepare<
        [],
        {
          serial_unit_id: number;
          serial_number: string;
          product_name: string;
          invoice_number: string | null;
          full_name: string | null;
          phone: string | null;
          warranty_end: string;
          days_left: number;
        }
      >(
        'SELECT serial_unit_id, serial_number, product_name, invoice_number, full_name, phone, warranty_end, days_left FROM v_warranty_expiring ORDER BY warranty_end',
      )
      .all()
      .map((row) => ({
        unitId: row.serial_unit_id,
        serialNumber: row.serial_number,
        productName: row.product_name,
        invoiceNumber: row.invoice_number,
        customerName: row.full_name,
        phone: row.phone,
        warrantyEnd: row.warranty_end,
        daysLeft: row.days_left,
      }));
  }

  private claim(id: number): Claim {
    const row = this.db.prepare<[number], ClaimRow>(`${CLAIM_SELECT} WHERE w.id = ?`).get(id);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Réclamation introuvable.');
    return toClaim(row);
  }
}
