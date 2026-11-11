import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type { QuoteCart, QuoteDetail, QuoteSummary, SaveQuoteInput } from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { setUnitStatus } from '../stock/units';
import { defaultLocation, priceCart } from './cart';
import { distribute, includedTax } from './pricing';

type QuoteStatus = QuoteSummary['status'];

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Unités réservées par un devis revenues en stock. */
function releaseReservations(db: Db, quoteId: number): void {
  const units = db
    .prepare<[number], number>(
      `SELECT u.id FROM quote_lines l JOIN serial_units u ON u.id = l.serial_unit_id
       WHERE l.quote_id = ? AND u.status = 'reserved'`,
    )
    .pluck()
    .all(quoteId);
  for (const unitId of units) setUnitStatus(db, unitId, 'in_stock');
}

/** Devis échus (date de validité passée) : expirés, et leurs unités réservées libérées (E.4). */
export function expireQuotes(db: Db): number {
  const expired = db
    .prepare<[string], number>(
      "SELECT id FROM quotes WHERE status IN ('draft', 'sent', 'accepted') AND valid_until < ?",
    )
    .pluck()
    .all(today());
  if (expired.length === 0) return 0;
  db.transaction(() => {
    for (const id of expired) {
      releaseReservations(db, id);
      db.prepare("UPDATE quotes SET status = 'expired', updated_at = ? WHERE id = ?").run(
        nowIsoUtc(),
        id,
      );
    }
  })();
  return expired.length;
}

/** Dans la transaction de la vente : le devis devient « converti » et ses réservations non vendues sont libérées. */
export function finishQuoteConversion(db: Db, quoteId: number, saleId: number): void {
  const status = db
    .prepare<[number], QuoteStatus>('SELECT status FROM quotes WHERE id = ?')
    .pluck()
    .get(quoteId);
  if (status === undefined || !['draft', 'sent', 'accepted'].includes(status)) {
    throw new AppError('CONFLICT', 'Ce devis n’est plus convertible (expiré ou déjà converti).');
  }
  releaseReservations(db, quoteId);
  db.prepare(
    "UPDATE quotes SET status = 'converted', converted_sale_id = ?, updated_at = ? WHERE id = ?",
  ).run(saleId, nowIsoUtc(), quoteId);
}

interface QuoteRow {
  id: number;
  number: string;
  status: QuoteStatus;
  customer_id: number | null;
  customer_name: string | null;
  valid_until: string;
  subtotal: number;
  discount_total: number;
  total: number;
  reserve_stock: number;
  notes: string | null;
  invoice_number: string | null;
}

const SELECT = `
  SELECT q.id, q.number, q.status, q.customer_id, c.full_name AS customer_name, q.valid_until, q.subtotal,
         q.discount_total, q.total, q.reserve_stock, q.notes, s.invoice_number
  FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id LEFT JOIN sales s ON s.id = q.converted_sale_id`;

function toSummary(row: QuoteRow): QuoteSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    customerName: row.customer_name,
    validUntil: row.valid_until,
    total: row.total,
    reserveStock: row.reserve_stock === 1,
    convertedInvoice: row.invoice_number,
  };
}

/** Devis et proformas (4.12) : validité, réservation facultative du stock, conversion en vente. */
export class QuoteService {
  constructor(private readonly db: Db) {}

  list(actor: Session, status: QuoteStatus | 'open' | 'all', limit: number): QuoteSummary[] {
    requirePermission(actor, 'quote.manage');
    expireQuotes(this.db);
    const where =
      status === 'all'
        ? ''
        : status === 'open'
          ? "WHERE q.status IN ('draft', 'sent', 'accepted')"
          : 'WHERE q.status = @status';
    return this.db
      .prepare<Record<string, unknown>, QuoteRow>(
        `${SELECT} ${where} ORDER BY q.id DESC LIMIT @limit`,
      )
      .all({ status, limit })
      .map(toSummary);
  }

  get(actor: Session, quoteId: number): QuoteDetail {
    requirePermission(actor, 'quote.manage');
    expireQuotes(this.db);
    const row = this.row(quoteId);
    const lines = this.db
      .prepare<
        [number],
        {
          id: number;
          variant_id: number;
          description: string;
          serial_unit_id: number | null;
          serial_number: string | null;
          quantity: number;
          unit_price: number;
          discount: number;
          line_total: number;
          tax_rate: number;
        }
      >(
        `SELECT l.id, l.variant_id, l.description, l.serial_unit_id, u.serial_number, l.quantity, l.unit_price, l.discount,
                l.line_total, l.tax_rate
         FROM quote_lines l LEFT JOIN serial_units u ON u.id = l.serial_unit_id WHERE l.quote_id = ? ORDER BY l.id`,
      )
      .all(quoteId);
    return {
      quote: toSummary(row),
      customerId: row.customer_id,
      notes: row.notes,
      subtotal: row.subtotal,
      discountTotal: row.discount_total,
      taxIncluded: lines.reduce(
        (sum, line) => sum + includedTax(line.line_total, line.tax_rate),
        0,
      ),
      lines: lines.map((line) => ({
        id: line.id,
        variantId: line.variant_id,
        description: line.description,
        serialUnitId: line.serial_unit_id,
        serialNumber: line.serial_number,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        discount: line.discount,
        lineTotal: line.line_total,
      })),
    };
  }

  /** Création ou modification (devis en préparation ou envoyé) ; la réservation bloque les unités choisies. */
  save(actor: Session, input: SaveQuoteInput): QuoteDetail {
    requirePermission(actor, 'quote.manage');
    expireQuotes(this.db);
    if (input.validUntil < today())
      throw new AppError('VALIDATION_ERROR', 'La date de validité est déjà passée.');
    const current = input.id === undefined ? null : this.row(input.id);
    if (current !== null && !['draft', 'sent'].includes(current.status)) {
      throw new AppError('CONFLICT', 'Seul un devis en préparation ou envoyé se modifie.');
    }
    const lines = input.lines.map((line) => ({
      ...line,
      serialUnitIds: input.reserveStock ? line.serialUnitIds : [],
    }));
    const cart = this.db.transaction(() => {
      // Les réservations actuelles sont libérées avant le contrôle, pour se réévaluer elles-mêmes.
      if (current !== null) releaseReservations(this.db, current.id);
      const priced = priceCart(this.db, actor, lines, input.globalDiscount, {
        quoteId: current?.id ?? null,
        locationId: defaultLocation(this.db),
      });
      const blocking = input.reserveStock ? priced.issues : priced.pricingIssues;
      if (blocking.length > 0) throw new AppError('CONFLICT', [...new Set(blocking)].join(' '));
      return priced;
    });
    const id = this.db.transaction(() => {
      const priced = cart();
      const now = nowIsoUtc();
      let quoteId: number;
      if (current === null) {
        quoteId = Number(
          this.db
            .prepare(
              `INSERT INTO quotes (number, customer_id, user_id, status, valid_until, subtotal, discount_total, tax_total, total,
                                   reserve_stock, notes, created_at, updated_at, created_by)
               VALUES (?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              this.nextNumber(),
              input.customerId,
              actor.userId,
              input.validUntil,
              priced.subtotal,
              priced.discountTotal,
              priced.total,
              input.reserveStock ? 1 : 0,
              input.notes,
              now,
              now,
              actor.userId,
            ).lastInsertRowid,
        );
      } else {
        quoteId = current.id;
        this.db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(quoteId);
        this.db
          .prepare(
            `UPDATE quotes SET customer_id = ?, valid_until = ?, subtotal = ?, discount_total = ?, total = ?, reserve_stock = ?,
               notes = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.customerId,
            input.validUntil,
            priced.subtotal,
            priced.discountTotal,
            priced.total,
            input.reserveStock ? 1 : 0,
            input.notes,
            now,
            quoteId,
          );
      }
      const insert = this.db.prepare(
        `INSERT INTO quote_lines (quote_id, variant_id, serial_unit_id, description, quantity, unit_price, discount, tax_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of priced.lines) {
        const description =
          line.info.label === '' ? line.info.name : `${line.info.name} (${line.info.label})`;
        if (line.serialUnitIds.length > 0) {
          const discounts = distribute(
            line.discount,
            line.serialUnitIds.map(() => 1),
          );
          line.serialUnitIds.forEach((unitId, index) => {
            const discount = discounts[index] ?? 0;
            insert.run(
              quoteId,
              line.info.variantId,
              unitId,
              description,
              1,
              line.unitPrice,
              discount,
              line.info.taxRate,
              line.unitPrice - discount,
            );
            setUnitStatus(this.db, unitId, 'reserved');
          });
          continue;
        }
        insert.run(
          quoteId,
          line.info.variantId,
          null,
          description,
          line.quantity,
          line.unitPrice,
          line.discount,
          line.info.taxRate,
          line.lineTotal,
        );
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: current === null ? 'quote.created' : 'quote.updated',
        entityType: 'quote',
        entityId: quoteId,
        details: { total: priced.total, reserve: input.reserveStock },
      });
      return quoteId;
    })();
    return this.get(actor, id);
  }

  setStatus(actor: Session, quoteId: number, status: 'sent' | 'accepted'): QuoteDetail {
    requirePermission(actor, 'quote.manage');
    expireQuotes(this.db);
    const current = this.row(quoteId);
    const allowed = status === 'sent' ? ['draft'] : ['draft', 'sent'];
    if (!allowed.includes(current.status))
      throw new AppError('CONFLICT', 'Changement d’état impossible pour ce devis.');
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, nowIsoUtc(), quoteId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: `quote.${status}`,
        entityType: 'quote',
        entityId: quoteId,
      });
    })();
    return this.get(actor, quoteId);
  }

  /** Panier de caisse repris d'un devis (prix et remises du devis, unités réservées). */
  toCart(actor: Session, quoteId: number): QuoteCart {
    requirePermission(actor, 'pos.use');
    const detail = this.get(actor, quoteId);
    if (!['draft', 'sent', 'accepted'].includes(detail.quote.status)) {
      throw new AppError('CONFLICT', 'Ce devis n’est plus convertible (expiré ou déjà converti).');
    }
    return {
      quoteId,
      customerId: detail.customerId,
      lines: detail.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        discount: null,
        quoteLineId: line.id,
        ...(line.serialUnitId === null ? {} : { serialUnitIds: [line.serialUnitId] }),
      })),
    };
  }

  private nextNumber(): string {
    const year = String(new Date().getFullYear());
    const last = this.db
      .prepare<[string], string>(
        'SELECT number FROM quotes WHERE number LIKE ? ORDER BY number DESC LIMIT 1',
      )
      .pluck()
      .get(`DEV-${year}-%`);
    return `DEV-${year}-${String(last === undefined ? 1 : Number(last.slice(-5)) + 1).padStart(5, '0')}`;
  }

  private row(quoteId: number): QuoteRow {
    const row = this.db.prepare<[number], QuoteRow>(`${SELECT} WHERE q.id = ?`).get(quoteId);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Devis introuvable.');
    return row;
  }
}
