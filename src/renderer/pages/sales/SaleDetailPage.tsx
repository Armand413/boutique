import { useCallback, useState } from 'react';
import { Ban, Undo2 } from 'lucide-react';
import { formatDate, formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { REFUND_METHODS, SaleDetail } from '@shared/schemas/sales';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextAreaField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { useStockEvents } from '../../stores/stock-events';
import { useCan } from '../products/catalog-ui';
import { DocumentButtons } from '../pos/PaymentDialog';

function CancelDialog({
  sale,
  onOpenChange,
  onDone,
}: {
  sale: SaleDetail;
  onOpenChange: (open: boolean) => void;
  onDone: (sale: SaleDetail) => void;
}) {
  const t = useT();
  const stockChanged = useStockEvents((state) => state.changed);
  const { error, submit } = useSubmit();
  const [reason, setReason] = useState('');
  const confirm = async (): Promise<void> => {
    const done = await submit(() => invoke('sales:cancel', { saleId: sale.id, reason }));
    if (done !== null) {
      stockChanged();
      toast.success(t('sale.cancel.done'));
      onDone(done.value);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('sale.cancel.title', { invoice: sale.invoiceNumber ?? '' })}</DialogTitle>
          <DialogDescription>{t('sale.cancel.description')}</DialogDescription>
        </DialogHeader>
        <TextAreaField
          label={t('sale.cancel.reason')}
          autoFocus
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            onClick={() => void confirm()}
          >
            {t('sale.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({
  sale,
  onOpenChange,
  onDone,
}: {
  sale: SaleDetail;
  onOpenChange: (open: boolean) => void;
  onDone: (sale: SaleDetail) => void;
}) {
  const t = useT();
  const stockChanged = useStockEvents((state) => state.changed);
  const { error, submit } = useSubmit();
  const returnable = sale.lines.filter(
    (line) => line.lineType !== 'kit_component' && line.quantity > line.returnedQuantity,
  );
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(returnable.map((line) => [line.id, true])),
  );
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<string>(sale.customer === null ? 'cash' : 'credit_note');
  const lines = returnable.flatMap((line) => {
    const quantity = Number(quantities[line.id] ?? '0');
    return Number.isInteger(quantity) && quantity > 0 ? [{ line, quantity }] : [];
  });
  const amount = lines.reduce(
    (sum, item) => sum + Math.round((item.line.lineTotal * item.quantity) / item.line.quantity),
    0,
  );
  const confirm = async (): Promise<void> => {
    if (lines.length === 0) {
      toast.warning(t('sale.return.nothing'));
      return;
    }
    const done = await submit(() =>
      invoke('sales:return', {
        saleId: sale.id,
        reason,
        lines: lines.map((item) => ({
          saleLineId: item.line.id,
          quantity: item.quantity,
          restock: restock[item.line.id] ?? true,
        })),
        refundMethod: amount === 0 ? null : (method as (typeof REFUND_METHODS)[number]),
      }),
    );
    if (done !== null) {
      stockChanged();
      toast.success(t('sale.return.done'));
      onDone(done.value);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('sale.return.title', { invoice: sale.invoiceNumber ?? '' })}</DialogTitle>
          <DialogDescription>{t('sale.return.description')}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {returnable.map((line) => {
            const name = [line.name, line.variantLabel, line.serialNumber]
              .filter((part) => part !== null && part !== '')
              .join(' · ');
            return (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {name}{' '}
                  <span className="text-muted-foreground">
                    ({line.quantity - line.returnedQuantity})
                  </span>
                </span>
                <Input
                  className="tabular w-20 text-center"
                  inputMode="numeric"
                  aria-label={t('sale.return.quantity', { name })}
                  value={quantities[line.id] ?? ''}
                  onChange={(event) =>
                    setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                />
                {line.lineType !== 'service' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary size-5"
                      checked={restock[line.id] ?? true}
                      onChange={(event) =>
                        setRestock((current) => ({ ...current, [line.id]: event.target.checked }))
                      }
                      aria-label={t('sale.return.restock', { name })}
                    />
                    {t('nav.stock')}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <TextAreaField
          label={t('sale.return.reason')}
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <SelectField
          label={t('sale.return.refund')}
          value={method}
          options={[
            ...(sale.customer === null
              ? []
              : [{ value: 'credit_note', label: t('sale.return.creditNote') }]),
            ...(['cash', 'mobile_money', 'card', 'transfer', 'cheque'] as const).map((value) => ({
              value,
              label: t(`payment.${value}`),
            })),
          ]}
          onValueChange={setMethod}
        />
        <p className="tabular text-base font-semibold" role="status">
          {t('sale.return.amount', { amount: formatMoney(amount) })}
        </p>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < 3 || lines.length === 0}
            onClick={() => void confirm()}
          >
            {t('sale.return.validate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Détail d'une vente : lignes, numéros, garanties, paiements, échéances, retours ; actions selon le rôle. */
export function SaleDetailPage() {
  const t = useT();
  const saleId = useRouter((state) => state.params.saleId);
  const navigate = useRouter((state) => state.navigate);
  const canCancel = useCan('sale.cancel');
  const canReturn = useCan('sale.return');
  const loader = useCallback(
    () =>
      saleId === undefined
        ? Promise.reject(new Error(t('sale.error')))
        : invoke('sales:get', { saleId }),
    [saleId, t],
  );
  const { state, reload } = useRemote(loader);
  const [override, setOverride] = useState<SaleDetail | null>(null);
  const [dialog, setDialog] = useState<'cancel' | 'return' | null>(null);
  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('sale.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  const sale = override !== null && override.id === saleId ? override : state.data;
  const done = (next: SaleDetail): void => {
    setOverride(next);
    setDialog(null);
  };
  const returnable =
    sale.status === 'completed' &&
    sale.lines.some(
      (line) => line.lineType !== 'kit_component' && line.quantity > line.returnedQuantity,
    );
  return (
    <>
      <PageHeader
        title={sale.invoiceNumber ?? t('nav.sales.detail')}
        description={sale.completedAt === null ? '' : formatDateTime(sale.completedAt)}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {canReturn && returnable && (
              <Button variant="secondary" onClick={() => setDialog('return')}>
                <Undo2 aria-hidden="true" />
                {t('sale.return')}
              </Button>
            )}
            {canCancel && sale.cancellable && (
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                <Ban aria-hidden="true" />
                {t('sale.cancel')}
              </Button>
            )}
          </div>
        }
      />
      {sale.status === 'cancelled' && (
        <p
          role="alert"
          className="bg-danger-soft text-danger-soft-foreground rounded-md px-4 py-3 text-sm font-medium"
        >
          {t('sale.cancelled', { reason: sale.cancelReason ?? '' })}
        </p>
      )}
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6 text-sm">
          <p>
            <span className="text-muted-foreground block">{t('sale.customer')}</span>
            {sale.customer === null ? (
              t('pos.noCustomer')
            ) : (
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => navigate('customers.detail', { customerId: sale.customer?.id ?? 0 })}
              >
                {sale.customer.fullName}
              </button>
            )}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('sale.seller')}</span>
            {sale.userName}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('sales.col.remaining')}</span>
            <span className="tabular font-semibold">{formatMoney(sale.remaining)}</span>
          </p>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{t('sale.lines')}</CardTitle>
        </CardHeader>
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('sale.col.item')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('sale.col.quantity')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('sale.col.price')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('sale.col.discount')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('sale.col.total')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('sale.col.returned')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => {
              const component = line.lineType === 'kit_component';
              return (
                <tr key={line.id} className="border-border border-t">
                  <td className={component ? 'px-4 py-2 pl-10' : 'px-4 py-3'}>
                    <span className={component ? 'block' : 'block font-medium'}>
                      {line.name} {line.variantLabel}
                    </span>
                    {line.serialNumber !== null && (
                      <span className="block font-mono text-xs">
                        {t('sale.serial', { serial: line.serialNumber })}
                      </span>
                    )}
                    {line.warrantyEnd !== null && (
                      <span className="text-muted-foreground block text-xs">
                        {t('sale.warrantyUntil', { date: line.warrantyEnd })}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{line.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {component ? '' : <Money amount={line.unitPrice} />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {line.discount === 0 ? '' : <Money amount={line.discount} />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {component ? '' : <Money amount={line.lineTotal} />}
                  </td>
                  <td className="tabular px-4 py-3 text-right">
                    {line.returnedQuantity === 0 ? '' : line.returnedQuantity}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <CardContent className="flex flex-col items-end gap-1 pt-4 text-sm">
          <span className="tabular">
            {t('pos.subtotal')} : {formatMoney(sale.subtotal)}
          </span>
          {sale.discountTotal > 0 && (
            <span className="tabular">
              {t('pos.discounts')} : -{formatMoney(sale.discountTotal)}
            </span>
          )}
          <span className="tabular text-xl font-semibold">{formatMoney(sale.total)}</span>
          {sale.taxIncluded > 0 && (
            <span className="text-muted-foreground">
              {t('pos.taxIncluded', { amount: formatMoney(sale.taxIncluded) })}
            </span>
          )}
          {sale.margin !== null && (
            <span className="text-muted-foreground">
              {t('sale.margin', { amount: formatMoney(sale.margin) })}
            </span>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sale.payments')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {sale.payments.map((payment) => (
                <li key={payment.id} className="flex justify-between">
                  <span>
                    {t(`payment.${payment.method}`)} · {formatDate(payment.paidAt)}
                    {payment.reference === null ? '' : ` · ${payment.reference}`}
                  </span>
                  <Money amount={payment.amount} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {sale.installments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('sale.installments')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {sale.installments.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="tabular">{item.dueDate}</span>
                    <Badge
                      tone={
                        item.status === 'paid'
                          ? 'success'
                          : item.status === 'overdue'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {t(`sale.installment.status.${item.status}`)}
                    </Badge>
                    <span className="tabular">
                      {formatMoney(item.paidAmount)} / {formatMoney(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {sale.returns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('sale.returns')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {sale.returns.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      <span className="font-mono">{item.number}</span> · {item.reason}
                    </span>
                    <Money amount={item.refundAmount} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      {sale.status === 'completed' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('sale.documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentButtons sale={sale} />
          </CardContent>
        </Card>
      )}
      {dialog === 'cancel' && (
        <CancelDialog sale={sale} onOpenChange={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'return' && (
        <ReturnDialog sale={sale} onOpenChange={() => setDialog(null)} onDone={done} />
      )}
    </>
  );
}
