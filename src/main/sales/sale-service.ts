import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type {
  CartPreview,
  CheckoutInput,
  Discount,
  HeldCart,
  HeldSale,
  HoldInput,
  ReturnInput,
  SaleDetail,
  SaleListInput,
  SaleSummary,
  CartLine,
} from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { applyMovement } from '../stock/movements';
import { setUnitStatus } from '../stock/units';
import { defaultLocation, priceCart, toPreview, type PricedCart } from './cart';
import { openSessionId, recordPayment } from './payments';
import { finishQuoteConversion, expireQuotes } from './quote-service';
import { readSaleDetail, listSales } from './sale-queries';
import { applySaleStock, cartFromLines, insertSaleLines, releaseUnit } from './sale-lines';

/** Numéro suivant d'une séquence annuelle sans trou (factures). */
function nextInvoiceNumber(db: Db, year: number): string {
  db.prepare(
    'INSERT INTO invoice_sequences (year, last_number) VALUES (?, 0) ON CONFLICT (year) DO NOTHING',
  ).run(year);
  const last =
    db
      .prepare<[number], number>('SELECT last_number FROM invoice_sequences WHERE year = ?')
      .pluck()
      .get(year) ?? 0;
  db.prepare('UPDATE invoice_sequences SET last_number = ? WHERE year = ?').run(last + 1, year);
  return `FAC-${String(year)}-${String(last + 1).padStart(6, '0')}`;
}

function nextReturnNumber(db: Db, year: number): string {
  const last = db
    .prepare<[string], string>(
      'SELECT number FROM sale_returns WHERE number LIKE ? ORDER BY number DESC LIMIT 1',
    )
    .pluck()
    .get(`RET-${String(year)}-%`);
  return `RET-${String(year)}-${String(last === undefined ? 1 : Number(last.slice(-5)) + 1).padStart(5, '0')}`;
}

function issuesError(issues: readonly string[]): AppError {
  return new AppError('CONFLICT', [...new Set(issues)].join(' '));
}

/**
 * Ventes (4.5) : une vente = panier + paiements + mouvements de stock en UNE transaction (tout ou rien).
 */
export class SaleService {
  constructor(private readonly db: Db) {}

  preview(
    actor: Session,
    lines: readonly CartLine[],
    globalDiscount: Discount | null,
    quoteId: number | null,
  ): CartPreview {
    requirePermission(actor, 'pos.use');
    return toPreview(this.price(actor, lines, globalDiscount, quoteId));
  }

  checkout(actor: Session, input: CheckoutInput): SaleDetail {
    requirePermission(actor, 'pos.use');
    expireQuotes(this.db);
    const sessionId = openSessionId(this.db);
    if (sessionId === null)
      throw new AppError('CONFLICT', 'La caisse est fermée : ouvrez une session de caisse.');
    const cart = this.price(actor, input.lines, input.globalDiscount, input.quoteId ?? null);
    if (cart.issues.length > 0) throw issuesError(cart.issues);
    const paid = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid > cart.total)
      throw new AppError(
        'VALIDATION_ERROR',
        'Les paiements dépassent le total : saisissez le montant appliqué (la monnaie est rendue à part).',
      );
    const remaining = cart.total - paid;
    const installments = input.installments ?? [];
    if (remaining > 0) {
      if (input.customerId === null)
        throw new AppError('VALIDATION_ERROR', 'Vente à crédit : choisissez le client.');
      if (installments.reduce((sum, item) => sum + item.amount, 0) !== remaining) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Vente à crédit : la somme des échéances doit égaler le reste à payer.',
        );
      }
    } else if (installments.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Aucune échéance pour une vente entièrement payée.');
    }
    if (input.delivery !== null && input.customerId === null) {
      throw new AppError('VALIDATION_ERROR', 'Livraison : choisissez le client à livrer.');
    }
    const locationId = defaultLocation(this.db);
    const saleId = this.db.transaction(() => {
      const now = nowIsoUtc();
      const id = this.prepareHeld(
        actor,
        input.heldSaleId ?? null,
        input.customerId,
        input.quoteId ?? null,
      );
      const stocked = insertSaleLines(this.db, id, cart);
      const dueDate =
        installments
          .map((item) => item.dueDate)
          .sort()
          .at(-1) ?? null;
      this.db
        .prepare(
          `UPDATE sales SET customer_id = ?, user_id = ?, cash_session_id = ?, subtotal = ?, discount_total = ?, tax_total = 0,
             total = ?, amount_paid = ?, due_date = ?, delivery_required = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.customerId,
          actor.userId,
          sessionId,
          cart.subtotal,
          cart.discountTotal,
          cart.total,
          paid,
          dueDate,
          input.delivery === null ? 0 : 1,
          now,
          id,
        );
      for (const payment of input.payments) {
        recordPayment(this.db, { saleId: id, ...payment, sessionId, userId: actor.userId });
      }
      const invoice = nextInvoiceNumber(this.db, new Date().getFullYear());
      this.db
        .prepare(
          "UPDATE sales SET status = 'completed', invoice_number = ?, completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(invoice, now, now, id);
      const insertInstallment = this.db.prepare(
        'INSERT INTO sale_installments (sale_id, due_date, amount, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const item of [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
        insertInstallment.run(id, item.dueDate, item.amount, now, now, actor.userId);
      }
      applySaleStock(this.db, id, stocked, { locationId, userId: actor.userId, soldAt: now });
      if (input.delivery !== null) {
        this.db
          .prepare(
            'INSERT INTO deliveries (sale_id, address, scheduled_at, notes, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            input.delivery.address,
            input.delivery.scheduledOn === null
              ? null
              : `${input.delivery.scheduledOn}T12:00:00.000Z`,
            input.delivery.notes,
            now,
            now,
            actor.userId,
          );
      }
      if (input.quoteId !== undefined) finishQuoteConversion(this.db, input.quoteId, id);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'sale.completed',
        entityType: 'sale',
        entityId: id,
        details: {
          invoice,
          total: cart.total,
          paid,
          discount: cart.discountTotal,
          lines: cart.lines.length,
        },
      });
      return id;
    })();
    return this.detail(actor, saleId, { allowPos: true });
  }

  /** Mise en attente (F8) : le panier est enregistré sans paiement ni mouvement de stock. */
  hold(actor: Session, input: HoldInput): { heldSaleId: number } {
    requirePermission(actor, 'pos.use');
    const cart = this.price(actor, input.lines, input.globalDiscount, null);
    const heldSaleId = this.db.transaction(() => {
      const id = this.prepareHeld(actor, input.heldSaleId ?? null, input.customerId, null);
      insertSaleLines(this.db, id, cart);
      this.db
        .prepare(
          'UPDATE sales SET customer_id = ?, user_id = ?, subtotal = ?, discount_total = ?, total = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          input.customerId,
          actor.userId,
          cart.subtotal,
          cart.discountTotal,
          cart.total,
          nowIsoUtc(),
          id,
        );
      return id;
    })();
    return { heldSaleId };
  }

  heldSales(actor: Session): HeldSale[] {
    requirePermission(actor, 'pos.use');
    return this.db
      .prepare<
        [],
        {
          id: number;
          customer_name: string | null;
          item_count: number;
          subtotal: number;
          updated_at: string;
          user_name: string;
        }
      >(
        `SELECT s.id, c.full_name AS customer_name, s.subtotal, s.updated_at, u.full_name AS user_name,
                (SELECT coalesce(sum(l.quantity), 0) FROM sale_lines l WHERE l.sale_id = s.id AND l.line_type <> 'kit_component') AS item_count
         FROM sales s JOIN users u ON u.id = s.user_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.status = 'held' AND EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = s.id)
         ORDER BY s.updated_at`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        customerName: row.customer_name,
        itemCount: row.item_count,
        subtotal: row.subtotal,
        updatedAt: row.updated_at,
        userName: row.user_name,
      }));
  }

  resume(actor: Session, saleId: number): HeldCart {
    requirePermission(actor, 'pos.use');
    const sale = this.heldRow(saleId);
    return {
      heldSaleId: saleId,
      customerId: sale.customer_id,
      lines: cartFromLines(this.db, saleId),
    };
  }

  /** Abandon d'un panier en attente : ses lignes sont retirées, la ligne de vente vide sera réutilisée. */
  discard(actor: Session, saleId: number): void {
    requirePermission(actor, 'pos.use');
    this.heldRow(saleId);
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM sale_lines WHERE sale_id = ? AND parent_line_id IS NOT NULL')
        .run(saleId);
      this.db.prepare('DELETE FROM sale_lines WHERE sale_id = ?').run(saleId);
      this.db
        .prepare(
          'UPDATE sales SET customer_id = NULL, subtotal = 0, discount_total = 0, total = 0, updated_at = ? WHERE id = ?',
        )
        .run(nowIsoUtc(), saleId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'sale.held_discarded',
        entityType: 'sale',
        entityId: saleId,
      });
    })();
  }

  list(actor: Session, input: SaleListInput): SaleSummary[] {
    requirePermission(actor, 'sale.view');
    return listSales(this.db, input);
  }

  detail(actor: Session, saleId: number, options: { allowPos?: boolean } = {}): SaleDetail {
    if (options.allowPos !== true) requirePermission(actor, 'sale.view');
    return readSaleDetail(this.db, saleId, actor.permissions.has('cost.view'));
  }

  /**
   * Annulation (gérant, motif obligatoire) tant que la caisse de la vente est ouverte (la base le
   * vérifie) : chaque sortie de stock est inversée, les unités reviennent en stock, les espèces
   * reçues sortent de la caisse.
   */
  cancel(actor: Session, saleId: number, reason: string): SaleDetail {
    requirePermission(actor, 'sale.cancel');
    const sale = this.db
      .prepare<
        [number],
        { status: string; invoice_number: string | null; cash_session_id: number | null }
      >('SELECT status, invoice_number, cash_session_id FROM sales WHERE id = ?')
      .get(saleId);
    if (sale?.status !== 'completed')
      throw new AppError('CONFLICT', 'Seule une vente terminée peut être annulée.');
    this.db.transaction(() => {
      const now = nowIsoUtc();
      this.db
        .prepare(
          "UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
        )
        .run(now, actor.userId, reason, saleId);
      this.reverseSaleMovements(actor, saleId);
      const cash =
        this.db
          .prepare<[number], number>(
            "SELECT coalesce(sum(amount), 0) FROM payments WHERE sale_id = ? AND method = 'cash'",
          )
          .pluck()
          .get(saleId) ?? 0;
      if (cash > 0 && sale.cash_session_id !== null) {
        this.db
          .prepare(
            "INSERT INTO cash_movements (cash_session_id, direction, amount, reason, user_id, created_at) VALUES (?, 'out', ?, ?, ?, ?)",
          )
          .run(
            sale.cash_session_id,
            cash,
            `Annulation ${sale.invoice_number ?? ''} : ${reason}`,
            actor.userId,
            now,
          );
      }
      this.db
        .prepare(
          "UPDATE deliveries SET status = 'cancelled', updated_at = ? WHERE sale_id = ? AND status = 'to_deliver'",
        )
        .run(now, saleId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'sale.cancelled',
        entityType: 'sale',
        entityId: saleId,
        details: { invoice: sale.invoice_number, reason, cashRefunded: cash },
      });
    })();
    return this.detail(actor, saleId);
  }

  /**
   * Retour (4.5) article par article : remise en stock ou mise au rebut, remboursement (ou avoir
   * qui réduit la dette du client). Jamais plus que la quantité vendue (la base le vérifie).
   */
  returnItems(actor: Session, input: ReturnInput): SaleDetail {
    requirePermission(actor, 'sale.return');
    const detail = readSaleDetail(this.db, input.saleId, false);
    if (detail.status !== 'completed')
      throw new AppError('CONFLICT', 'Seule une vente terminée accepte un retour.');
    const lines = input.lines.map((item) => {
      const line = detail.lines.find((candidate) => candidate.id === item.saleLineId);
      if (line === undefined || line.lineType === 'kit_component') {
        throw new AppError('VALIDATION_ERROR', 'Ligne de vente introuvable pour ce retour.');
      }
      if (item.quantity > line.quantity - line.returnedQuantity) {
        throw new AppError(
          'CONFLICT',
          `« ${line.name} » : quantité retournée supérieure à la quantité vendue.`,
        );
      }
      const amount = Math.round((line.lineTotal * item.quantity) / line.quantity);
      return { ...item, line, amount };
    });
    const refund = lines.reduce((sum, item) => sum + item.amount, 0);
    if (refund > 0 && input.refundMethod === null)
      throw new AppError('VALIDATION_ERROR', 'Choisissez le mode de remboursement.');
    const alreadyRefunded = detail.returns.reduce((sum, item) => sum + item.refundAmount, 0);
    if (
      input.refundMethod !== null &&
      input.refundMethod !== 'credit_note' &&
      refund > detail.paidToDate - alreadyRefunded
    ) {
      throw new AppError(
        'CONFLICT',
        'Le remboursement dépasse ce que le client a payé : proposez un avoir.',
      );
    }
    if (input.refundMethod === 'credit_note' && detail.customer === null) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Un avoir est rattaché à un client : la vente n’en a pas.',
      );
    }
    const sessionId = openSessionId(this.db);
    if (input.refundMethod === 'cash' && refund > 0 && sessionId === null) {
      throw new AppError('CONFLICT', 'Ouvrez la caisse pour rembourser en espèces.');
    }
    this.db.transaction(() => {
      const now = nowIsoUtc();
      const number = nextReturnNumber(this.db, new Date().getFullYear());
      const returnId = Number(
        this.db
          .prepare(
            `INSERT INTO sale_returns (number, sale_id, reason, refund_amount, refund_method, cash_session_id, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            number,
            input.saleId,
            input.reason,
            refund,
            refund === 0 ? null : input.refundMethod,
            input.refundMethod === 'cash' ? sessionId : null,
            actor.userId,
            now,
          ).lastInsertRowid,
      );
      const insertLine = this.db.prepare(
        'INSERT INTO sale_return_lines (return_id, sale_line_id, quantity, restock, amount) VALUES (?, ?, ?, ?, ?)',
      );
      for (const item of lines) {
        insertLine.run(returnId, item.saleLineId, item.quantity, item.restock ? 1 : 0, item.amount);
        this.returnStock(
          actor,
          input.saleId,
          returnId,
          item.line,
          item.quantity,
          item.restock,
          detail.lines,
        );
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'sale.returned',
        entityType: 'sale',
        entityId: input.saleId,
        details: { number, refund, method: input.refundMethod, reason: input.reason },
      });
    })();
    return this.detail(actor, input.saleId);
  }

  private returnStock(
    actor: Session,
    saleId: number,
    returnId: number,
    line: SaleDetail['lines'][number],
    quantity: number,
    restock: boolean,
    all: SaleDetail['lines'],
  ): void {
    const targets =
      line.lineType === 'kit'
        ? all.filter((component) => component.parentLineId === line.id)
        : [line];
    for (const target of targets) {
      const share =
        line.lineType === 'kit' ? (target.quantity * quantity) / line.quantity : quantity;
      if (!Number.isInteger(share))
        throw new AppError(
          'VALIDATION_ERROR',
          'Retour partiel de kit impossible pour cette quantité.',
        );
      if (target.serialNumber !== null && line.lineType === 'kit' && quantity !== line.quantity) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Un kit contenant des articles suivis se retourne en entier.',
        );
      }
      this.reverseLine(actor, saleId, returnId, target.id, share, restock);
    }
  }

  /** Inverse la sortie de stock d'une ligne (même emplacement, même unité), ou met l'unité au rebut. */
  private reverseLine(
    actor: Session,
    saleId: number,
    returnId: number,
    lineId: number,
    quantity: number,
    restock: boolean,
  ): void {
    const movement = this.db
      .prepare<
        [number, number],
        { variant_id: number; location_id: number; serial_unit_id: number | null }
      >(
        `SELECT m.variant_id, m.location_id, m.serial_unit_id FROM stock_movements m
         JOIN sale_lines l ON l.variant_id = m.variant_id AND (l.serial_unit_id IS m.serial_unit_id)
         WHERE m.reference_type = 'sale' AND m.reference_id = ? AND l.id = ? AND m.movement_type = 'sale' LIMIT 1`,
      )
      .get(saleId, lineId);
    if (movement === undefined) return;
    if (restock) {
      applyMovement(this.db, {
        variantId: movement.variant_id,
        locationId: movement.location_id,
        type: 'sale_return',
        quantityDelta: quantity,
        serialUnitId: movement.serial_unit_id,
        userId: actor.userId,
        reference: { type: 'sale_return', id: returnId },
      });
      if (movement.serial_unit_id !== null) releaseUnit(this.db, movement.serial_unit_id);
    } else if (movement.serial_unit_id !== null) {
      setUnitStatus(this.db, movement.serial_unit_id, 'returned');
      setUnitStatus(this.db, movement.serial_unit_id, 'written_off');
    }
  }

  private reverseSaleMovements(actor: Session, saleId: number): void {
    const movements = this.db
      .prepare<
        [number],
        {
          variant_id: number;
          location_id: number;
          serial_unit_id: number | null;
          quantity_delta: number;
        }
      >(
        "SELECT variant_id, location_id, serial_unit_id, quantity_delta FROM stock_movements WHERE reference_type = 'sale' AND reference_id = ? AND movement_type = 'sale'",
      )
      .all(saleId);
    for (const movement of movements) {
      applyMovement(this.db, {
        variantId: movement.variant_id,
        locationId: movement.location_id,
        type: 'sale_return',
        quantityDelta: -movement.quantity_delta,
        serialUnitId: movement.serial_unit_id,
        userId: actor.userId,
        reason: 'Annulation de la vente',
        reference: { type: 'sale', id: saleId },
      });
      if (movement.serial_unit_id !== null) releaseUnit(this.db, movement.serial_unit_id);
    }
  }

  private price(
    actor: Session,
    lines: readonly CartLine[],
    globalDiscount: Discount | null,
    quoteId: number | null,
  ): PricedCart {
    return priceCart(this.db, actor, lines, globalDiscount, {
      quoteId,
      locationId: defaultLocation(this.db),
    });
  }

  /** Vente en attente à remplir : celle indiquée (vidée), une ligne vide réutilisée, ou une nouvelle. */
  private prepareHeld(
    actor: Session,
    heldSaleId: number | null,
    customerId: number | null,
    quoteId: number | null,
  ): number {
    const now = nowIsoUtc();
    if (heldSaleId !== null) {
      this.heldRow(heldSaleId);
      this.db
        .prepare('DELETE FROM sale_lines WHERE sale_id = ? AND parent_line_id IS NOT NULL')
        .run(heldSaleId);
      this.db.prepare('DELETE FROM sale_lines WHERE sale_id = ?').run(heldSaleId);
      if (quoteId !== null)
        this.db.prepare('UPDATE sales SET quote_id = ? WHERE id = ?').run(quoteId, heldSaleId);
      return heldSaleId;
    }
    const empty = this.db
      .prepare<[], number>(
        "SELECT s.id FROM sales s WHERE s.status = 'held' AND NOT EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = s.id) LIMIT 1",
      )
      .pluck()
      .get();
    if (empty !== undefined) {
      this.db
        .prepare(
          'UPDATE sales SET quote_id = ?, user_id = ?, customer_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(quoteId, actor.userId, customerId, now, empty);
      return empty;
    }
    return Number(
      this.db
        .prepare(
          "INSERT INTO sales (status, customer_id, user_id, quote_id, created_at, updated_at) VALUES ('held', ?, ?, ?, ?, ?)",
        )
        .run(customerId, actor.userId, quoteId, now, now).lastInsertRowid,
    );
  }

  private heldRow(saleId: number): { customer_id: number | null } {
    const row = this.db
      .prepare<[number], { status: string; customer_id: number | null }>(
        'SELECT status, customer_id FROM sales WHERE id = ?',
      )
      .get(saleId);
    if (row?.status !== 'held') throw new AppError('NOT_FOUND', 'Panier en attente introuvable.');
    return row;
  }
}
