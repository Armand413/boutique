import { AppError } from '@shared/ipc/errors';
import { nowIsoUtc } from '@shared/format/date';
import type { CashSession } from '@shared/schemas/sales';
import type { PaymentMethod } from '@shared/schemas/stock';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { openSessionId } from './payments';

interface SummaryRow {
  cash_session_id: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  cash_in: number;
  card_in: number;
  mobile_money_in: number;
  transfer_in: number;
  cheque_in: number;
  cash_movements_in: number;
  cash_movements_out: number;
  cash_refunds: number;
  opened_by: string;
  closed_by: string | null;
  counted_amount: number | null;
  difference: number | null;
  sales_count: number;
  sales_total: number;
}

const SELECT = `
  SELECT v.*, o.full_name AS opened_by, cl.full_name AS closed_by, s.counted_amount, s.difference,
         (SELECT count(*) FROM sales x WHERE x.cash_session_id = s.id AND x.status = 'completed') AS sales_count,
         (SELECT coalesce(sum(x.total), 0) FROM sales x WHERE x.cash_session_id = s.id AND x.status = 'completed') AS sales_total
  FROM v_cash_session_summary v
  JOIN cash_sessions s ON s.id = v.cash_session_id
  JOIN users o ON o.id = s.opened_by
  LEFT JOIN users cl ON cl.id = s.closed_by`;

/** Espèces attendues : fond + espèces encaissées + entrées − sorties − remboursements en espèces. */
export function expectedCash(
  row: Pick<
    SummaryRow,
    'opening_float' | 'cash_in' | 'cash_movements_in' | 'cash_movements_out' | 'cash_refunds'
  >,
): number {
  return (
    row.opening_float +
    row.cash_in +
    row.cash_movements_in -
    row.cash_movements_out -
    row.cash_refunds
  );
}

function toSession(row: SummaryRow): CashSession {
  const byMethod: Record<PaymentMethod, number> = {
    cash: row.cash_in,
    card: row.card_in,
    mobile_money: row.mobile_money_in,
    transfer: row.transfer_in,
    cheque: row.cheque_in,
  };
  return {
    id: row.cash_session_id,
    status: row.status,
    openedAt: row.opened_at,
    openedBy: row.opened_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    openingFloat: row.opening_float,
    byMethod,
    cashMovementsIn: row.cash_movements_in,
    cashMovementsOut: row.cash_movements_out,
    cashRefunds: row.cash_refunds,
    expectedCash: expectedCash(row),
    countedCash: row.counted_amount,
    difference: row.difference,
    salesCount: row.sales_count,
    salesTotal: row.sales_total,
  };
}

/** Sessions de caisse (4.5) : ouverture avec fond, entrées et sorties d'espèces, clôture avec écart. */
export class CashSessionService {
  constructor(private readonly db: Db) {}

  current(actor: Session): CashSession | null {
    requirePermission(actor, 'pos.use');
    const id = openSessionId(this.db);
    return id === null ? null : this.byId(id);
  }

  list(actor: Session, limit: number): CashSession[] {
    requirePermission(actor, 'sale.view');
    return this.db
      .prepare<[number], SummaryRow>(`${SELECT} ORDER BY s.id DESC LIMIT ?`)
      .all(limit)
      .map(toSession);
  }

  open(actor: Session, openingFloat: number): CashSession {
    requirePermission(actor, 'pos.use');
    if (openSessionId(this.db) !== null)
      throw new AppError('CONFLICT', 'La caisse est déjà ouverte.');
    const id = this.db.transaction(() => {
      const sessionId = Number(
        this.db
          .prepare(
            "INSERT INTO cash_sessions (opened_by, opened_at, opening_float, status) VALUES (?, ?, ?, 'open')",
          )
          .run(actor.userId, nowIsoUtc(), openingFloat).lastInsertRowid,
      );
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'cash.opened',
        entityType: 'cash_session',
        entityId: sessionId,
        details: { openingFloat },
      });
      return sessionId;
    })();
    return this.byId(id);
  }

  /** Entrée ou sortie d'espèces hors vente (fond complémentaire, dépense) ; motif obligatoire et journalisé. */
  move(actor: Session, direction: 'in' | 'out', amount: number, reason: string): CashSession {
    requirePermission(actor, 'pos.use');
    const id = this.requireOpen();
    if (direction === 'out' && amount > expectedCash(this.summary(id))) {
      throw new AppError('CONFLICT', 'La sortie dépasse les espèces attendues en caisse.');
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO cash_movements (cash_session_id, direction, amount, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, direction, amount, reason, actor.userId, nowIsoUtc());
      appendAudit(this.db, {
        userId: actor.userId,
        action: direction === 'in' ? 'cash.money_in' : 'cash.money_out',
        entityType: 'cash_session',
        entityId: id,
        details: { amount, reason },
      });
    })();
    return this.byId(id);
  }

  /** Clôture : espèces comptées comparées aux espèces attendues ; l'écart est conservé et journalisé. */
  close(actor: Session, countedCash: number, notes: string | null): CashSession {
    requirePermission(actor, 'pos.use');
    const id = this.requireOpen();
    const held = this.db
      .prepare<[], number>(
        "SELECT count(*) FROM sales s WHERE s.status = 'held' AND EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id = s.id)",
      )
      .pluck()
      .get();
    if ((held ?? 0) > 0) {
      throw new AppError(
        'CONFLICT',
        'Des paniers sont en attente : terminez-les ou abandonnez-les avant la clôture.',
      );
    }
    this.db.transaction(() => {
      const expected = expectedCash(this.summary(id));
      this.db
        .prepare(
          `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?, expected_amount = ?, counted_amount = ?, difference = ?
           WHERE id = ?`,
        )
        .run(actor.userId, nowIsoUtc(), expected, countedCash, countedCash - expected, id);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'cash.closed',
        entityType: 'cash_session',
        entityId: id,
        details: { expected, counted: countedCash, difference: countedCash - expected, notes },
      });
    })();
    return this.byId(id);
  }

  requireOpen(): number {
    const id = openSessionId(this.db);
    if (id === null)
      throw new AppError('CONFLICT', 'La caisse est fermée : ouvrez une session de caisse.');
    return id;
  }

  private summary(id: number): SummaryRow {
    const row = this.db.prepare<[number], SummaryRow>(`${SELECT} WHERE s.id = ?`).get(id);
    if (row === undefined) throw new AppError('NOT_FOUND', 'Session de caisse introuvable.');
    return row;
  }

  private byId(id: number): CashSession {
    return toSession(this.summary(id));
  }
}
