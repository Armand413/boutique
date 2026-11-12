import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banknote, Contact, Pencil, UserPlus, UserX } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { Customer, SaleSummary } from '@shared/schemas/sales';
import type { PaymentMethod } from '@shared/schemas/stock';
import { useSubmit } from '../../auth/use-submit';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, CardHeader, CardTitle, Input, Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  CheckboxField,
  FormError,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { moneyText, parseOptionalMoney, useCan } from '../products/catalog-ui';
import { paymentOptions } from '../stock/stock-ui';

export function CustomerFormDialog({
  customer,
  onOpenChange,
  onDone,
}: {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onDone: (customer: Customer) => void;
}) {
  const t = useT();
  const canSetLimit = useCan('sale.cancel');
  const { error, submit } = useSubmit();
  const { register, handleSubmit, formState, setError } = useForm({
    defaultValues: {
      fullName: customer?.fullName ?? '',
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
      creditLimit: moneyText(customer?.creditLimit ?? 0),
      isActive: customer?.isActive ?? true,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    const creditLimit = parseOptionalMoney(values.creditLimit);
    if (creditLimit === undefined) {
      setError('creditLimit', { message: t('product.form.invalidMoney') });
      return;
    }
    const saved = await submit(() =>
      invoke('customers:save', {
        ...(customer === null ? {} : { id: customer.id }),
        ...values,
        creditLimit: creditLimit ?? 0,
      }),
    );
    if (saved !== null) {
      toast.success(t('customer.saved'));
      onDone(saved.value);
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {customer === null
              ? t('customer.form.createTitle')
              : t('customer.form.editTitle', { name: customer.fullName })}
          </DialogTitle>
          <DialogDescription>{t('product.form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('customer.form.name')}
            autoFocus
            maxLength={120}
            error={formState.errors.fullName?.message}
            {...register('fullName', {
              validate: (value) => value.trim() !== '' || t('form.required'),
            })}
          />
          <TextField
            label={t('customer.form.phone')}
            type="tel"
            maxLength={32}
            {...register('phone')}
          />
          <TextField label={t('customer.form.address')} maxLength={300} {...register('address')} />
          <TextAreaField label={t('customer.form.notes')} maxLength={1000} {...register('notes')} />
          <TextField
            label={t('customer.form.creditLimit')}
            hint={t('customer.form.creditLimitHint')}
            inputMode="decimal"
            disabled={!canSetLimit}
            error={formState.errors.creditLimit?.message}
            {...register('creditLimit')}
          />
          <CheckboxField label={t('customer.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {customer === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Clients (4.6) : recherche, dettes. */
export function CustomersPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [query, setQuery] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('customers:search', { query, withDebtOnly: debtOnly, limit: 200 }).then(
        (found) => {
          if (!active) return;
          setRows(found);
          setError(null);
        },
        (failure: unknown) => {
          if (active) setError(errorMessage(failure));
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, debtOnly, attempt]);
  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <UserPlus aria-hidden="true" />
      {t('customers.new')}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t('customers.title')}
        description={t('customers.description')}
        actions={newButton}
      />
      <div className="grid grid-cols-[2fr_1fr] items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="customers-search">{t('customers.search')}</Label>
          <Input
            id="customers-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <CheckboxField
          label={t('customers.debtOnly')}
          className="h-10"
          checked={debtOnly}
          onChange={(event) => setDebtOnly(event.target.checked)}
        />
      </div>
      {error !== null && (
        <ErrorState
          title={t('customers.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => setAttempt((v) => v + 1)}
        />
      )}
      {error === null && rows === null && <LoadingState label={t('state.loading')} rows={4} />}
      {rows !== null && rows.length === 0 && query === '' && !debtOnly && (
        <EmptyState
          icon={Contact}
          title={t('customers.empty.title')}
          description={t('customers.empty.description')}
          action={newButton}
        />
      )}
      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('customers.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('customers.col.phone')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('customers.col.limit')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('customers.col.balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-base font-medium hover:underline"
                      aria-label={t('customers.open', { name: customer.fullName })}
                      onClick={() => navigate('customers.detail', { customerId: customer.id })}
                    >
                      {customer.fullName}
                    </button>
                  </td>
                  <td className="px-4 py-3">{customer.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={customer.creditLimit} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {customer.balance === 0 ? (
                      '—'
                    ) : (
                      <Money amount={customer.balance} className="font-semibold" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && (
        <CustomerFormDialog
          customer={null}
          onOpenChange={() => setCreating(false)}
          onDone={(customer) => {
            setCreating(false);
            navigate('customers.detail', { customerId: customer.id });
          }}
        />
      )}
    </>
  );
}

function PayDebtDialog({
  customer,
  onOpenChange,
  onDone,
}: {
  customer: Customer;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [amount, setAmount] = useState(moneyText(customer.balance));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const pay = async (): Promise<void> => {
    const value = parseOptionalMoney(amount);
    if (value === null || value === undefined || value === 0) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    const done = await submit(() =>
      invoke('customers:payDebt', { customerId: customer.id, amount: value, method, reference }),
    );
    if (done !== null) {
      toast.success(t('customer.payDebt.done'));
      onDone();
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('customer.payDebt.title', { name: customer.fullName })}</DialogTitle>
          <DialogDescription>
            {t('customer.payDebt.description', { amount: formatMoney(customer.balance) })}
          </DialogDescription>
        </DialogHeader>
        <TextField
          label={t('customer.payDebt.amount')}
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <SelectField
          label={t('customer.payDebt.method')}
          value={method}
          options={paymentOptions(t)}
          onValueChange={(value) => setMethod(value as PaymentMethod)}
        />
        <TextField
          label={t('pay.reference')}
          maxLength={64}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void pay()}>{t('customer.payDebt')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fiche client : coordonnées, dette, achats et remboursement. */
export function CustomerDetailPage() {
  const t = useT();
  const customerId = useRouter((state) => state.params.customerId);
  const navigate = useRouter((state) => state.navigate);
  const canPay = useCan('pos.use');
  const canSeeSales = useCan('sale.view');
  const canAnonymize = useCan('user.manage');
  const loader = useCallback(async () => {
    if (customerId === undefined) throw new Error(t('customer.error'));
    const customer = await invoke('customers:get', { customerId });
    const sales: SaleSummary[] = canSeeSales
      ? await invoke('sales:list', { customerId, status: 'all', limit: 100 })
      : [];
    return { customer, sales };
  }, [customerId, canSeeSales, t]);
  const { state, reload } = useRemote(loader);
  const [dialog, setDialog] = useState<'edit' | 'pay' | 'anonymize' | null>(null);
  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={5} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('customer.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  const { customer, sales } = state.data;
  const done = (): void => {
    setDialog(null);
    reload();
  };
  const anonymize = async (): Promise<void> => {
    try {
      await invoke('customers:anonymize', { customerId: customer.id });
      toast.success(t('customer.anonymize.done'));
      done();
    } catch (failure) {
      setDialog(null);
      toast.error(errorMessage(failure));
    }
  };
  return (
    <>
      <PageHeader
        title={customer.fullName}
        description={t('customer.balanceDue', { amount: formatMoney(customer.balance) })}
        actions={
          <div className="flex gap-2">
            {canPay && customer.balance > 0 && (
              <Button onClick={() => setDialog('pay')}>
                <Banknote aria-hidden="true" />
                {t('customer.payDebt')}
              </Button>
            )}
            {!customer.anonymized && (
              <Button variant="secondary" onClick={() => setDialog('edit')}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Button>
            )}
            {canAnonymize && !customer.anonymized && (
              <Button variant="secondary" onClick={() => setDialog('anonymize')}>
                <UserX aria-hidden="true" />
                {t('customer.anonymize')}
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6 text-sm">
          <p>
            <span className="text-muted-foreground block">{t('customer.form.phone')}</span>
            {customer.phone ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('customer.form.address')}</span>
            {customer.address ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground block">{t('customer.form.creditLimit')}</span>
            <span className="tabular">{formatMoney(customer.creditLimit)}</span>
          </p>
        </CardContent>
      </Card>
      {canSeeSales && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t('customer.history')}</CardTitle>
          </CardHeader>
          {sales.length === 0 ? (
            <CardContent>
              <p className="text-muted-foreground text-sm">{t('customer.noSales')}</p>
            </CardContent>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('sales.col.invoice')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('sales.col.date')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('sales.col.total')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('sales.col.remaining')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="border-border border-t">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="font-mono font-medium hover:underline"
                        aria-label={t('sales.open', { invoice: sale.invoiceNumber })}
                        onClick={() => navigate('sales.detail', { saleId: sale.id })}
                      >
                        {sale.invoiceNumber}
                      </button>
                    </td>
                    <td className="tabular px-4 py-3">{formatDateTime(sale.completedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Money amount={sale.total} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {sale.remaining > 0 ? (
                        <Money amount={sale.remaining} className="font-semibold" />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {dialog === 'edit' && (
        <CustomerFormDialog
          customer={customer}
          onOpenChange={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === 'pay' && (
        <PayDebtDialog customer={customer} onOpenChange={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'anonymize' && (
        <ConfirmDialog
          open
          title={t('customer.anonymize.title', { name: customer.fullName })}
          description={t('customer.anonymize.description')}
          confirmLabel={t('customer.anonymize')}
          cancelLabel={t('common.cancel')}
          onOpenChange={(open) => !open && setDialog(null)}
          onConfirm={() => void anonymize()}
        />
      )}
    </>
  );
}
