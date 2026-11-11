import { useCallback, useState } from 'react';
import { Banknote, PackagePlus, Pencil, Undo2 } from 'lucide-react';
import { formatDate } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { PaymentMethod, ReceiptDetail, SupplierDetail } from '@shared/schemas/stock';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { useRouter } from '../../stores/router';
import { parseOptionalMoney, useCan } from '../products/catalog-ui';
import { MovementDialog } from '../stock/MovementDialog';
import { paymentOptions, today, useLocations } from '../stock/stock-ui';
import { SupplierDialog } from './SuppliersPage';

const NONE = 'none';

function PaymentDialog({
  detail,
  onOpenChange,
  onDone,
}: {
  detail: SupplierDetail;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [receiptId, setReceiptId] = useState(NONE);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const open = detail.receipts.filter(
    (receipt) => receipt.status === 'validated' && receipt.paid < receipt.totalCost,
  );
  const save = async (): Promise<void> => {
    const value = parseOptionalMoney(amount);
    if (value === undefined || value === null || value === 0) {
      setAmountError(t('product.form.invalidMoney'));
      return;
    }
    setAmountError(undefined);
    const saved = await submit(() =>
      invoke('suppliers:pay', {
        supplierId: detail.supplier.id,
        receiptId: receiptId === NONE ? null : Number(receiptId),
        amount: value,
        method,
        reference,
        paidOn,
      }),
    );
    if (saved !== null) {
      toast.success(t('pay.saved'));
      onDone();
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pay.title', { name: detail.supplier.name })}</DialogTitle>
          <DialogDescription>
            {t('pay.description', { amount: formatMoney(detail.supplier.balance) })}
          </DialogDescription>
        </DialogHeader>
        <SelectField
          label={t('pay.receipt')}
          value={receiptId}
          options={[
            { value: NONE, label: t('pay.noReceipt') },
            ...open.map((receipt) => ({
              value: String(receipt.id),
              label: `${receipt.number} · ${formatMoney(receipt.totalCost - receipt.paid)}`,
            })),
          ]}
          onValueChange={setReceiptId}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('pay.amount')}
            inputMode="decimal"
            autoFocus
            value={amount}
            error={amountError}
            onChange={(event) => setAmount(event.target.value)}
          />
          <SelectField
            label={t('receipt.paymentMethod')}
            value={method}
            options={paymentOptions(t)}
            onValueChange={(value) => setMethod(value as PaymentMethod)}
          />
          <TextField
            label={t('pay.date')}
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
          <TextField
            label={t('receipt.paymentReference')}
            maxLength={64}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()}>{t('supplier.pay')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({
  receiptId,
  onOpenChange,
}: {
  receiptId: number;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const loader = useCallback(() => invoke('receipts:get', { receiptId }), [receiptId]);
  const { state } = useRemote<ReceiptDetail>(loader);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state.status === 'ready'
              ? t('receipt.detail', { number: state.data.receipt.number })
              : t('receipt.title')}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'ready'
              ? `${state.data.receipt.supplierName} · ${formatDate(state.data.receipt.receivedAt)} · ${state.data.receipt.locationName}`
              : t('state.loading')}
          </DialogDescription>
        </DialogHeader>
        {state.status === 'error' && <FormError message={state.message} />}
        {state.status === 'ready' && (
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('stock.col.product')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('stock.col.quantity')}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t('stock.col.unitCost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.lines.map((line) => (
                <tr key={line.variantId} className="border-border border-t">
                  <td className="px-3 py-2">
                    <span className="block font-medium">
                      {[line.productName, line.variantLabel]
                        .filter((part) => part !== '')
                        .join(' · ')}
                    </span>
                    {line.serials.length > 0 && (
                      <span className="text-muted-foreground block font-mono">
                        {line.serials.join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{line.quantity}</td>
                  <td className="px-3 py-2 text-right">
                    <Money amount={line.unitCost} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {state.status === 'ready' && (
          <p className="tabular text-right font-semibold">
            {t('receipt.total', { total: formatMoney(state.data.receipt.totalCost) })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type DialogState =
  { kind: 'edit' | 'pay' | 'return' } | { kind: 'receipt'; receiptId: number } | null;

/** Fiche fournisseur (A.4) : historique des achats, paiements et reste dû. */
export function SupplierDetailPage() {
  const t = useT();
  const supplierId = useRouter((state) => state.params.supplierId);
  const navigate = useRouter((state) => state.navigate);
  const canAdjust = useCan('stock.adjust');
  const loader = useCallback(
    () =>
      supplierId === undefined
        ? Promise.reject(new Error(t('supplier.error')))
        : invoke('suppliers:get', { supplierId }),
    [supplierId, t],
  );
  const { state, reload } = useRemote(loader);
  const locations = useLocations();
  const [dialog, setDialog] = useState<DialogState>(null);
  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('supplier.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  const detail = state.data;
  const { supplier } = detail;
  const close = (): void => setDialog(null);
  const done = (): void => {
    setDialog(null);
    reload();
  };
  return (
    <>
      <PageHeader
        title={supplier.name}
        description={t('supplier.balance', { amount: formatMoney(supplier.balance) })}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {canAdjust && (
              <Button onClick={() => navigate('stock.receipt', { supplierId: supplier.id })}>
                <PackagePlus aria-hidden="true" />
                {t('supplier.newReceipt')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setDialog({ kind: 'pay' })}
              disabled={supplier.balance <= 0}
            >
              <Banknote aria-hidden="true" />
              {t('supplier.pay')}
            </Button>
            {canAdjust && (
              <Button
                variant="secondary"
                onClick={() => setDialog({ kind: 'return' })}
                disabled={locations.state.status !== 'ready'}
              >
                <Undo2 aria-hidden="true" />
                {t('supplier.return')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDialog({ kind: 'edit' })}>
              <Pencil aria-hidden="true" />
              {t('common.edit')}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6 text-sm">
          <p>
            <span className="text-muted-foreground block">{t('supplier.form.phone')}</span>
            {supplier.phone ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('supplier.form.email')}</span>
            {supplier.email ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('supplier.form.address')}</span>
            {supplier.address ?? '—'}
          </p>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{t('supplier.receipts')}</CardTitle>
        </CardHeader>
        {detail.receipts.length === 0 ? (
          <CardContent>
            <p className="text-muted-foreground text-sm">{t('supplier.noReceipts')}</p>
          </CardContent>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('receipt.col.number')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('receipt.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('receipt.col.location')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('receipt.col.total')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('receipt.col.paid')}
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.receipts.map((receipt) => (
                <tr key={receipt.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-mono font-medium hover:underline"
                      aria-label={t('receipt.open', { number: receipt.number })}
                      onClick={() => setDialog({ kind: 'receipt', receiptId: receipt.id })}
                    >
                      {receipt.number}
                    </button>
                  </td>
                  <td className="tabular px-4 py-3">{formatDate(receipt.receivedAt)}</td>
                  <td className="px-4 py-3">{receipt.locationName}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={receipt.totalCost} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={receipt.paid} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{t('supplier.payments')}</CardTitle>
        </CardHeader>
        {detail.payments.length === 0 ? (
          <CardContent>
            <p className="text-muted-foreground text-sm">{t('supplier.noPayments')}</p>
          </CardContent>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('receipt.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('receipt.col.number')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('supplier.col.method')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('supplier.col.reference')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('supplier.col.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((payment) => (
                <tr key={payment.id} className="border-border border-t">
                  <td className="tabular px-4 py-3">{formatDate(payment.paidAt)}</td>
                  <td className="px-4 py-3 font-mono">{payment.receiptNumber ?? '—'}</td>
                  <td className="px-4 py-3">{t(`payment.${payment.method}`)}</td>
                  <td className="px-4 py-3">{payment.reference ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={payment.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {dialog?.kind === 'edit' && (
        <SupplierDialog supplier={supplier} onOpenChange={close} onDone={done} />
      )}
      {dialog?.kind === 'pay' && (
        <PaymentDialog detail={detail} onOpenChange={close} onDone={done} />
      )}
      {dialog?.kind === 'receipt' && (
        <ReceiptDialog receiptId={dialog.receiptId} onOpenChange={close} />
      )}
      {dialog?.kind === 'return' && locations.state.status === 'ready' && (
        <MovementDialog
          mode={{ kind: 'return', supplierId: supplier.id, supplierName: supplier.name }}
          locations={locations.state.data}
          onOpenChange={close}
          onDone={done}
        />
      )}
    </>
  );
}
