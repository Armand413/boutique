import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type { DeliveryRow, InstallmentRow } from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';

type DeliveryStatus = DeliveryRow['status'];

/** Échéancier clients et livraisons (4.12, A.4). */
export class FollowupService {
  constructor(private readonly db: Db) {}

  /** Échéances non soldées : en retard, à venir (30 jours) ou toutes. */
  installments(
    actor: Session,
    scope: 'overdue' | 'upcoming' | 'all',
    limit: number,
  ): InstallmentRow[] {
    requirePermission(actor, 'customer.manage');
    const filter =
      scope === 'overdue'
        ? "AND i.due_date < date('now', 'localtime')"
        : scope === 'upcoming'
          ? "AND i.due_date BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+30 days')"
          : '';
    return this.db
      .prepare<
        [number],
        {
          id: number;
          sale_id: number;
          invoice_number: string;
          customer_id: number | null;
          full_name: string | null;
          phone: string | null;
          due_date: string;
          amount: number;
          paid_amount: number;
          days_overdue: number;
        }
      >(
        `SELECT i.id, i.sale_id, s.invoice_number, s.customer_id, c.full_name, c.phone, i.due_date, i.amount, i.paid_amount,
                CAST(julianday(date('now', 'localtime')) - julianday(i.due_date) AS INTEGER) AS days_overdue
         FROM sale_installments i
         JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
         LEFT JOIN customers c ON c.id = s.customer_id
         WHERE i.paid_amount < i.amount ${filter}
         ORDER BY i.due_date, i.id LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        id: row.id,
        saleId: row.sale_id,
        invoiceNumber: row.invoice_number,
        customerId: row.customer_id,
        customerName: row.full_name,
        phone: row.phone,
        dueDate: row.due_date,
        amount: row.amount,
        paidAmount: row.paid_amount,
        remaining: row.amount - row.paid_amount,
        daysOverdue: row.days_overdue,
      }));
  }

  deliveries(actor: Session, status: DeliveryStatus | 'all', limit: number): DeliveryRow[] {
    requirePermission(actor, 'delivery.manage');
    return this.db
      .prepare<
        Record<string, unknown>,
        {
          id: number;
          sale_id: number;
          invoice_number: string;
          full_name: string | null;
          phone: string | null;
          address: string;
          status: DeliveryStatus;
          scheduled_at: string | null;
          delivered_at: string | null;
          notes: string | null;
        }
      >(
        `SELECT d.id, d.sale_id, s.invoice_number, c.full_name, c.phone, d.address, d.status, d.scheduled_at, d.delivered_at, d.notes
         FROM deliveries d JOIN sales s ON s.id = d.sale_id LEFT JOIN customers c ON c.id = s.customer_id
         ${status === 'all' ? '' : 'WHERE d.status = @status'}
         ORDER BY d.status = 'to_deliver' DESC, coalesce(d.scheduled_at, d.created_at), d.id LIMIT @limit`,
      )
      .all({ status, limit })
      .map((row) => ({
        id: row.id,
        saleId: row.sale_id,
        invoiceNumber: row.invoice_number,
        customerName: row.full_name,
        phone: row.phone,
        address: row.address,
        status: row.status,
        scheduledAt: row.scheduled_at,
        deliveredAt: row.delivered_at,
        notes: row.notes,
      }));
  }

  /** Livraison faite ou annulée (définitif, la base le garantit). */
  updateDelivery(actor: Session, deliveryId: number, status: 'delivered' | 'cancelled'): void {
    requirePermission(actor, 'delivery.manage');
    const current = this.db
      .prepare<[number], DeliveryStatus>('SELECT status FROM deliveries WHERE id = ?')
      .pluck()
      .get(deliveryId);
    if (current === undefined) throw new AppError('NOT_FOUND', 'Livraison introuvable.');
    if (current !== 'to_deliver')
      throw new AppError('CONFLICT', 'Cette livraison est déjà terminée.');
    this.db.transaction(() => {
      const now = nowIsoUtc();
      this.db
        .prepare(
          'UPDATE deliveries SET status = ?, delivered_at = ?, delivered_by = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          status,
          status === 'delivered' ? now : null,
          status === 'delivered' ? actor.userId : null,
          now,
          deliveryId,
        );
      appendAudit(this.db, {
        userId: actor.userId,
        action: `delivery.${status}`,
        entityType: 'delivery',
        entityId: deliveryId,
      });
    })();
  }
}
