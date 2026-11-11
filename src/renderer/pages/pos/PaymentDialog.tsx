import { useState } from 'react';
import { FileText, Printer, ShieldCheck, Truck } from 'lucide-react';
import { formatMoney } from '@shared/format/money';
import type { DOCUMENT_KINDS, PaymentInput, SaleDetail } from '@shared/schemas/sales';
import { useSubmit } from '../../auth/use-submit';
import { Separator } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { CheckboxField, FormError, SelectField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useStockEvents } from '../../stores/stock-events';
import { cartLines, usePos } from '../../stores/pos';
import { parseOptionalMoney } from '../products/catalog-ui';
import { CustomerDialog } from './PosDialogs';
import { today } from '../stock/stock-ui';

type NonCash = 'card' | 'mobile_money' | 'transfer' | 'cheque';
const NON_CASH: readonly NonCash[] = ['card', 'mobile_money', 'transfer', 'cheque'];

/** Échéances mensuelles égales (la dernière absorbe l'arrondi), à partir d'une première date. */
export function schedule(
  remaining: number,
  count: number,
  firstDue: string,
): { dueDate: string; amount: number }[] {
  const base = Math.floor(remaining / count);
  const [year = 2000, month = 1, day = 1] = firstDue.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, day));
    if (date.getUTCDate() !== day) date.setUTCDate(0);
    return {
      dueDate: date.toISOString().slice(0, 10),
      amount: index === count - 1 ? remaining - base * (count - 1) : base,
    };
  });
}

function nextMonth(): string {
  const [year = 2000, month = 1, day = 1] = today().split('-').map(Number);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function DocumentButtons({ sale, onPrinted }: { sale: SaleDetail; onPrinted?: () => void }) {
  const t = useT();
  const print = async (): Promise<void> => {
    try {
      const result = await invoke('documents:printTicket', { saleId: sale.id });
      if (result.simulated) toast.info(t('pay.simulated'));
      else toast.success(t('pay.printed'));
      onPrinted?.();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const save = async (kind: (typeof DOCUMENT_KINDS)[number]): Promise<void> => {
    try {
      if ((await invoke('documents:saveSale', { saleId: sale.id, kind })).saved)
        toast.success(t('pay.saved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const hasWarranty = sale.lines.some((line) => line.warrantyEnd !== null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void print()}>
        <Printer aria-hidden="true" />
        {t('pay.printTicket')}
      </Button>
      <Button variant="secondary" onClick={() => void save('invoice')}>
        <FileText aria-hidden="true" />
        {t('pay.invoice')}
      </Button>
      {hasWarranty && (
        <Button variant="secondary" onClick={() => void save('warranty')}>
          <ShieldCheck aria-hidden="true" />
          {t('pay.warranty')}
        </Button>
      )}
      {sale.delivery !== null && (
        <Button variant="secondary" onClick={() => void save('delivery_note')}>
          <Truck aria-hidden="true" />
          {t('pay.deliveryNote')}
        </Button>
      )}
    </div>
  );
}

export { DocumentButtons };

/** Encaissement (F4) : paiements mixtes, monnaie, crédit avec échéances, livraison. */
export function PaymentDialog({
  total,
  onOpenChange,
  onFinished,
}: {
  total: number;
  onOpenChange: (open: boolean) => void;
  onFinished: () => void;
}) {
  const t = useT();
  const pos = usePos();
  const stockChanged = useStockEvents((state) => state.changed);
  const { error, submit } = useSubmit();
  const [cash, setCash] = useState(String(total));
  const [others, setOthers] = useState<Record<NonCash, string>>({
    card: '',
    mobile_money: '',
    transfer: '',
    cheque: '',
  });
  const [reference, setReference] = useState('');
  const [installments, setInstallments] = useState('1');
  const [firstDue, setFirstDue] = useState(nextMonth());
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState(pos.customer?.address ?? '');
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ sale: SaleDetail; change: number } | null>(null);
  // Le choix du client s'ouvre par-dessus : les montants saisis sont conservés.
  const [choosingCustomer, setChoosingCustomer] = useState(false);

  const otherAmounts = NON_CASH.map((method) => ({
    method,
    amount: parseOptionalMoney(others[method]) ?? 0,
  }));
  const otherTotal = otherAmounts.reduce((sum, item) => sum + item.amount, 0);
  const cashReceived = parseOptionalMoney(cash) ?? 0;
  const cashApplied = Math.max(0, Math.min(cashReceived, total - otherTotal));
  const paid = Math.min(total, otherTotal + cashApplied);
  const change = cashReceived - cashApplied;
  const remaining = total - paid;
  const count = Math.max(1, Math.min(24, Number(installments) || 1));
  const plan = remaining > 0 ? schedule(remaining, count, firstDue) : [];

  const validate = async (): Promise<void> => {
    if (otherTotal > total) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    const payments: PaymentInput[] = [
      ...(cashApplied > 0
        ? [{ method: 'cash' as const, amount: cashApplied, reference: null }]
        : []),
      ...otherAmounts
        .filter((item) => item.amount > 0)
        .map((item) => ({
          method: item.method,
          amount: item.amount,
          reference: reference.trim() === '' ? null : reference.trim(),
        })),
    ];
    setSaving(true);
    const result = await submit(() =>
      invoke('sales:checkout', {
        ...(pos.heldSaleId === null ? {} : { heldSaleId: pos.heldSaleId }),
        ...(pos.quote === null ? {} : { quoteId: pos.quote.id }),
        customerId: pos.customer?.id ?? null,
        lines: cartLines(pos.lines),
        globalDiscount: pos.globalDiscount,
        payments,
        installments: remaining > 0 ? plan : null,
        delivery: delivery ? { address, scheduledOn: deliveryDate, notes: null } : null,
      }),
    );
    setSaving(false);
    if (result !== null) {
      stockChanged();
      setDone({ sale: result.value, change });
    }
  };

  if (done !== null) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onFinished();
        }}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>
              {t('pay.done.title', { invoice: done.sale.invoiceNumber ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('pay.dialog.description', { amount: formatMoney(done.sale.total) })}
            </DialogDescription>
          </DialogHeader>
          {done.change > 0 && (
            <p
              role="status"
              className="bg-success-soft text-success-soft-foreground rounded-md px-4 py-3 text-2xl font-semibold"
            >
              {t('pay.done.change', { amount: formatMoney(done.change) })}
            </p>
          )}
          {done.sale.remaining > 0 && (
            <p className="text-base font-medium">
              {t('pay.done.remaining', { amount: formatMoney(done.sale.remaining) })}
            </p>
          )}
          <DocumentButtons sale={done.sale} />
          <DialogFooter>
            <Button size="lg" onClick={onFinished} autoFocus>
              {t('pos.newSale')} (F2)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('pay.dialog.title')}</DialogTitle>
          <DialogDescription className="text-foreground text-2xl font-semibold">
            {t('pay.dialog.description', { amount: formatMoney(total) })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void validate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('pay.cashReceived')}
              inputMode="decimal"
              autoFocus
              value={cash}
              onChange={(event) => setCash(event.target.value)}
            />
            <TextField
              label={t('pay.mobileMoney')}
              inputMode="decimal"
              value={others.mobile_money}
              onChange={(event) =>
                setOthers((current) => ({ ...current, mobile_money: event.target.value }))
              }
            />
            <TextField
              label={t('pay.card')}
              inputMode="decimal"
              value={others.card}
              onChange={(event) =>
                setOthers((current) => ({ ...current, card: event.target.value }))
              }
            />
            <TextField
              label={t('pay.transfer')}
              inputMode="decimal"
              value={others.transfer}
              onChange={(event) =>
                setOthers((current) => ({ ...current, transfer: event.target.value }))
              }
            />
            <TextField
              label={t('pay.cheque')}
              inputMode="decimal"
              value={others.cheque}
              onChange={(event) =>
                setOthers((current) => ({ ...current, cheque: event.target.value }))
              }
            />
            <TextField
              label={t('pay.reference')}
              maxLength={64}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <div role="status" className="flex flex-col gap-1 text-base">
            <span className="tabular">{t('pay.paid', { amount: formatMoney(paid) })}</span>
            {change > 0 && (
              <span className="tabular text-success font-semibold">
                {t('pay.change', { amount: formatMoney(change) })}
              </span>
            )}
            {remaining > 0 && (
              <span className="tabular font-semibold">
                {t('pay.remaining', { amount: formatMoney(remaining) })}
              </span>
            )}
          </div>
          {remaining > 0 && (
            <fieldset className="border-border flex flex-col gap-3 rounded-md border p-4">
              <legend className="px-1 text-sm font-semibold">{t('pay.credit')}</legend>
              {pos.customer === null ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm">{t('pay.creditCustomer')}</p>
                  <Button size="sm" variant="secondary" onClick={() => setChoosingCustomer(true)}>
                    {t('pos.chooseCustomer')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-medium">{pos.customer.fullName}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label={t('pay.installments')}
                  value={String(count)}
                  options={Array.from({ length: 12 }, (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1),
                  }))}
                  onValueChange={setInstallments}
                />
                <TextField
                  label={t('pay.firstDue')}
                  type="date"
                  value={firstDue}
                  onChange={(event) => setFirstDue(event.target.value)}
                />
              </div>
              <ul className="text-sm">
                {plan.map((item, index) => (
                  <li key={item.dueDate} className="tabular">
                    {t('pay.schedule', {
                      index: index + 1,
                      date: item.dueDate,
                      amount: formatMoney(item.amount),
                    })}
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <Separator />
          <CheckboxField
            label={t('pay.delivery')}
            checked={delivery}
            onChange={(event) => setDelivery(event.target.checked)}
          />
          {delivery && (
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              <TextField
                label={t('pay.deliveryAddress')}
                maxLength={300}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <TextField
                label={t('pay.deliveryDate')}
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
              />
            </div>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="lg" variant="success" disabled={saving}>
              {t('pay.validate')}
            </Button>
          </DialogFooter>
        </form>
        {choosingCustomer && (
          <CustomerDialog
            onOpenChange={() => setChoosingCustomer(false)}
            onChoose={(customer) => {
              pos.setCustomer(customer);
              if (address === '') setAddress(customer.address ?? '');
              setChoosingCustomer(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
