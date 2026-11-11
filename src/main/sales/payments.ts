import { nowIsoUtc } from '@shared/format/date';
import type { PaymentMethod } from '@shared/schemas/stock';
import type { Db } from '../db/types';

export function openSessionId(db: Db): number | null {
  return (
    db.prepare<[], number>("SELECT id FROM cash_sessions WHERE status = 'open'").pluck().get() ??
    null
  );
}

/**
 * Enregistre un paiement sur une vente et l'impute aux échéances non soldées, dans l'ordre des dates
 * (un paiement par échéance touchée). Les espèces sont rattachées à la session de caisse ouverte.
 */
export function recordPayment(
  db: Db,
  input: {
    saleId: number;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    sessionId: number | null;
    userId: number;
  },
): void {
  const insert = db.prepare(
    `INSERT INTO payments (sale_id, installment_id, method, amount, reference, cash_session_id, user_id, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIsoUtc();
  const installments = db
    .prepare<[number], { id: number; amount: number; paid_amount: number }>(
      `SELECT id, amount, paid_amount FROM sale_installments
       WHERE sale_id = ? AND paid_amount < amount ORDER BY due_date, id`,
    )
    .all(input.saleId);
  let remaining = input.amount;
  for (const installment of installments) {
    if (remaining === 0) break;
    const share = Math.min(remaining, installment.amount - installment.paid_amount);
    insert.run(
      input.saleId,
      installment.id,
      input.method,
      share,
      input.reference,
      input.sessionId,
      input.userId,
      now,
    );
    const paid = installment.paid_amount + share;
    db.prepare(
      'UPDATE sale_installments SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(paid, paid === installment.amount ? 'paid' : 'partial', now, installment.id);
    remaining -= share;
  }
  if (remaining > 0) {
    insert.run(
      input.saleId,
      null,
      input.method,
      remaining,
      input.reference,
      input.sessionId,
      input.userId,
      now,
    );
  }
}
