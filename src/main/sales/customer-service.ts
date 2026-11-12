import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type { Customer, DebtPaymentInput, SaveCustomerInput } from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { openSessionId, recordPayment } from './payments';

interface CustomerRow {
  id: number;
  full_name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number;
  is_active: number;
  anonymized_at: string | null;
  balance: number;
}

const SELECT = `
  SELECT c.id, c.full_name, c.phone, c.address, c.notes, c.credit_limit, c.is_active, c.anonymized_at, b.balance
  FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id`;

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    creditLimit: row.credit_limit,
    isActive: row.is_active === 1,
    anonymized: row.anonymized_at !== null,
    balance: row.balance,
  };
}

/** Téléphone normalisé : chiffres et « + » seulement (recherche et unicité). */
export function normalizePhone(phone: string | null): string | null {
  if (phone === null) return null;
  const compact = phone.replace(/[^\d+]/g, '');
  return compact === '' ? null : compact;
}

/** Clients (4.6) : fiche, recherche depuis la caisse, création à la volée, dettes et remboursements. */
export class CustomerService {
  constructor(private readonly db: Db) {}

  search(actor: Session, query: string, limit: number, withDebtOnly = false): Customer[] {
    requirePermission(actor, 'customer.manage');
    const text = query.trim();
    const phone = normalizePhone(text);
    const conditions = ['c.anonymized_at IS NULL'];
    const params: Record<string, unknown> = { limit };
    if (text !== '') {
      conditions.push("(c.full_name LIKE @name ESCAPE '\\' OR c.phone LIKE @phone ESCAPE '\\')");
      params.name = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      params.phone = phone === null ? '' : `%${phone.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    }
    if (withDebtOnly) conditions.push('b.balance > 0');
    return this.db
      .prepare<Record<string, unknown>, CustomerRow>(
        `${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY c.is_active DESC, c.full_name COLLATE NOCASE LIMIT @limit`,
      )
      .all(params)
      .map(toCustomer);
  }

  get(actor: Session, id: number): Customer {
    requirePermission(actor, 'customer.manage');
    return this.existing(id);
  }

  /**
   * Anonymisation sur demande du client (B.3), réservée à l'administrateur, définitive : nom remplacé,
   * téléphone, adresse et notes effacés ; ventes, paiements et garanties restent (montants, numéros).
   * Refusée tant qu'un solde, une livraison à faire ou un devis en cours le concerne.
   */
  anonymize(actor: Session, id: number): Customer {
    requirePermission(actor, 'customer.manage');
    requirePermission(actor, 'user.manage');
    const customer = this.existing(id);
    if (customer.anonymized) throw new AppError('CONFLICT', 'Ce client est déjà anonymisé.');
    if (customer.balance !== 0) {
      throw new AppError(
        'CONFLICT',
        'Ce client a un solde en cours (dette ou avoir) : réglez-le avant d’effacer ses données.',
      );
    }
    const pending = this.db
      .prepare<[number, number], number>(
        `SELECT (SELECT count(*) FROM deliveries d JOIN sales s ON s.id = d.sale_id
                 WHERE s.customer_id = ? AND d.status = 'to_deliver')
              + (SELECT count(*) FROM quotes q WHERE q.customer_id = ? AND q.status IN ('draft', 'sent', 'accepted'))`,
      )
      .pluck()
      .get(id, id);
    if ((pending ?? 0) > 0) {
      throw new AppError(
        'CONFLICT',
        'Une livraison à faire ou un devis en cours concerne ce client : terminez-les d’abord.',
      );
    }
    const now = nowIsoUtc();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE customers SET full_name = ?, phone = NULL, address = NULL, notes = NULL, credit_limit = 0,
             is_active = 0, anonymized_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(`Client anonymisé n° ${String(id)}`, now, now, id);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'customer.anonymized',
        entityType: 'customer',
        entityId: id,
      });
    })();
    return this.existing(id);
  }

  /** Le plafond de crédit est fixé par le gérant (permission sale.cancel) : 0 par défaut (D22). */
  save(actor: Session, input: SaveCustomerInput): Customer {
    requirePermission(actor, 'customer.manage');
    const current = input.id === undefined ? null : this.existing(input.id);
    if (current?.anonymized === true) {
      throw new AppError('CONFLICT', 'Ce client a été anonymisé : sa fiche ne se modifie plus.');
    }
    if (input.creditLimit !== (current?.creditLimit ?? 0)) requirePermission(actor, 'sale.cancel');
    const phone = normalizePhone(input.phone);
    if (phone !== null) {
      const owner = this.db
        .prepare<[string], number>('SELECT id FROM customers WHERE phone = ?')
        .pluck()
        .get(phone);
      if (owner !== undefined && owner !== input.id) {
        throw new AppError('CONFLICT', 'Un client a déjà ce numéro de téléphone.');
      }
    }
    const now = nowIsoUtc();
    const id = this.db.transaction(() => {
      let customerId: number;
      if (current === null) {
        customerId = Number(
          this.db
            .prepare(
              `INSERT INTO customers (full_name, phone, address, notes, credit_limit, is_active, created_at, updated_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.fullName,
              phone,
              input.address,
              input.notes,
              input.creditLimit,
              input.isActive ? 1 : 0,
              now,
              now,
              actor.userId,
            ).lastInsertRowid,
        );
      } else {
        customerId = current.id;
        this.db
          .prepare(
            `UPDATE customers SET full_name = ?, phone = ?, address = ?, notes = ?, credit_limit = ?, is_active = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.fullName,
            phone,
            input.address,
            input.notes,
            input.creditLimit,
            input.isActive ? 1 : 0,
            now,
            current.id,
          );
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: current === null ? 'customer.created' : 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        details: {
          creditLimit: input.creditLimit,
          ...(current === null ? {} : { previousCreditLimit: current.creditLimit }),
        },
      });
      return customerId;
    })();
    return this.existing(id);
  }

  /**
   * Remboursement d'une dette (4.6) : réparti sur les ventes à crédit les plus anciennes, et sur
   * leurs échéances dans l'ordre des dates. Jamais au-delà du reste dû.
   */
  payDebt(actor: Session, input: DebtPaymentInput): Customer {
    requirePermission(actor, 'pos.use');
    requirePermission(actor, 'customer.manage');
    const customer = this.existing(input.customerId);
    if (input.amount > customer.balance) {
      throw new AppError('CONFLICT', 'Le montant dépasse le reste dû par ce client.');
    }
    const sessionId = openSessionId(this.db);
    if (input.method === 'cash' && sessionId === null) {
      throw new AppError('CONFLICT', 'Ouvrez la caisse pour encaisser des espèces.');
    }
    this.db.transaction(() => {
      let remaining = input.amount;
      const sales = this.db
        .prepare<[number], { id: number; due: number }>(
          `SELECT s.id, s.total - coalesce((SELECT sum(p.amount) FROM payments p WHERE p.sale_id = s.id), 0) AS due
           FROM sales s WHERE s.customer_id = ? AND s.status = 'completed'
           ORDER BY s.completed_at, s.id`,
        )
        .all(input.customerId)
        .filter((sale) => sale.due > 0);
      for (const sale of sales) {
        if (remaining === 0) break;
        const amount = Math.min(remaining, sale.due);
        recordPayment(this.db, {
          saleId: sale.id,
          amount,
          method: input.method,
          reference: input.reference,
          sessionId,
          userId: actor.userId,
        });
        remaining -= amount;
      }
      if (remaining > 0) {
        throw new AppError(
          'CONFLICT',
          'Le montant dépasse le reste dû sur les ventes de ce client.',
        );
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'customer.debt_paid',
        entityType: 'customer',
        entityId: customer.id,
        details: { amount: input.amount, method: input.method },
      });
    })();
    return this.existing(customer.id);
  }

  private existing(id: number): Customer {
    const row = this.db.prepare<[number], CustomerRow>(`${SELECT} WHERE c.id = ?`).get(id);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Client introuvable.');
    return toCustomer(row);
  }
}
