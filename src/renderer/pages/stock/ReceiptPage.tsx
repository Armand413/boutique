import { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatMoney } from '@shared/format/money';
import type { ProductRow } from '@shared/schemas/catalog';
import type { PaymentMethod } from '@shared/schemas/stock';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { FormError, SelectField, TextAreaField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { useRouter } from '../../stores/router';
import { moneyText, parseOptionalMoney } from '../products/catalog-ui';
import {
  parseQuantity,
  parseSerialLines,
  paymentOptions,
  rowName,
  today,
  VariantPicker,
} from './stock-ui';

interface Line {
  row: ProductRow;
  quantity: string;
  unitCost: string;
  serials: string;
}

const NONE = 'none';

/** Entrée de marchandise (4.3) : bon de réception saisi au scanner, validé en une seule fois. */
export function ReceiptPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const presetSupplier = useRouter((state) => state.params.supplierId);
  const loader = useCallback(
    async () => ({
      suppliers: await invoke('suppliers:list'),
      locations: await invoke('locations:list'),
    }),
    [],
  );
  const { state, reload } = useRemote(loader);
  const { error, submit } = useSubmit();
  const [supplierId, setSupplierId] = useState(
    presetSupplier === undefined ? NONE : String(presetSupplier),
  );
  const [locationId, setLocationId] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState(today());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [saving, setSaving] = useState(false);

  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('receipt.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  const suppliers = state.data.suppliers.filter((supplier) => supplier.isActive);
  const locations = state.data.locations.filter((location) => location.isActive);
  const location =
    locationId ??
    String(locations.find((candidate) => candidate.isDefault)?.id ?? locations[0]?.id ?? '');
  const total = lines.reduce((sum, line) => {
    const quantity = parseQuantity(line.quantity) ?? 0;
    const cost = parseOptionalMoney(line.unitCost) ?? 0;
    return sum + quantity * cost;
  }, 0);

  const add = (row: ProductRow): void =>
    setLines((current) =>
      current.some((line) => line.row.variantId === row.variantId)
        ? current.map((line) =>
            line.row.variantId === row.variantId && row.trackingMode === 'none'
              ? { ...line, quantity: String((parseQuantity(line.quantity) ?? 0) + 1) }
              : line,
          )
        : [
            ...current,
            { row, quantity: '1', unitCost: moneyText(row.costPrice ?? 0), serials: '' },
          ],
    );
  const update = (variantId: number, patch: Partial<Line>): void =>
    setLines((current) =>
      current.map((line) => (line.row.variantId === variantId ? { ...line, ...patch } : line)),
    );

  const save = async (): Promise<void> => {
    const prepared = lines.map((line) => ({
      variantId: line.row.variantId,
      quantity: parseQuantity(line.quantity),
      unitCost: parseOptionalMoney(line.unitCost),
      ...(line.row.trackingMode === 'none' ? {} : { serials: parseSerialLines(line.serials) }),
    }));
    const invalid = prepared.find(
      (line) => line.quantity === null || line.unitCost === null || line.unitCost === undefined,
    );
    if (invalid !== undefined) {
      toast.error(t('form.invalidQuantity'));
      return;
    }
    const amount = parseOptionalMoney(paymentAmount);
    if (amount === undefined) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    setSaving(true);
    const result = await submit(() =>
      invoke('receipts:create', {
        supplierId: Number(supplierId),
        locationId: Number(location),
        receivedOn,
        notes,
        lines: prepared.map((line) => ({
          ...line,
          quantity: line.quantity ?? 0,
          unitCost: line.unitCost ?? 0,
        })),
        payment:
          amount === null || amount === 0
            ? null
            : { amount, method: paymentMethod, reference: paymentReference },
      }),
    );
    setSaving(false);
    if (result !== null) {
      toast.success(t('receipt.saved', { number: result.value.receipt.number }));
      navigate('suppliers.detail', { supplierId: result.value.receipt.supplierId });
    }
  };

  return (
    <>
      <PageHeader title={t('receipt.title')} description={t('receipt.description')} />
      {suppliers.length === 0 && (
        <p
          role="alert"
          className="bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 text-sm font-medium"
        >
          {t('receipt.noSupplier')}
        </p>
      )}
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6">
          <SelectField
            label={t('receipt.supplier')}
            value={supplierId}
            options={[
              { value: NONE, label: '—' },
              ...suppliers.map((supplier) => ({
                value: String(supplier.id),
                label: supplier.name,
              })),
            ]}
            onValueChange={setSupplierId}
          />
          <SelectField
            label={t('receipt.location')}
            value={location}
            options={locations.map((candidate) => ({
              value: String(candidate.id),
              label: candidate.name,
            }))}
            onValueChange={setLocationId}
          />
          <TextField
            label={t('receipt.date')}
            type="date"
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('receipt.lines')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <VariantPicker autoFocus onPick={add} />
          {lines.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('receipt.noLines')}</p>
          )}
          <ul className="flex flex-col gap-4">
            {lines.map((line) => {
              const name = rowName(line.row);
              const serialCount = parseSerialLines(line.serials).length;
              return (
                <li
                  key={line.row.variantId}
                  className="border-border flex flex-col gap-3 rounded-md border p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {name}{' '}
                      <span className="text-muted-foreground font-mono text-sm">
                        {line.row.sku}
                      </span>
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('receipt.remove', { name })}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((other) => other.row.variantId !== line.row.variantId),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <TextField
                      label={t('receipt.quantity', { name })}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) =>
                        update(line.row.variantId, { quantity: event.target.value })
                      }
                    />
                    <TextField
                      label={t('receipt.unitCost', { name })}
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) =>
                        update(line.row.variantId, { unitCost: event.target.value })
                      }
                    />
                  </div>
                  {line.row.trackingMode !== 'none' && (
                    <TextAreaField
                      label={t('receipt.serials', { name })}
                      hint={t('receipt.serialsCount', {
                        count: serialCount,
                        quantity: line.quantity,
                      })}
                      rows={Math.min(8, Math.max(2, (parseQuantity(line.quantity) ?? 1) + 1))}
                      className="font-mono"
                      value={line.serials}
                      onChange={(event) =>
                        update(line.row.variantId, { serials: event.target.value })
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="tabular text-right text-xl font-semibold">
            {t('receipt.total', { total: formatMoney(total) })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('receipt.payment')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <TextField
            label={t('receipt.paymentAmount')}
            inputMode="decimal"
            value={paymentAmount}
            onChange={(event) => setPaymentAmount(event.target.value)}
          />
          <SelectField
            label={t('receipt.paymentMethod')}
            value={paymentMethod}
            options={paymentOptions(t)}
            onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
          />
          <TextField
            label={t('receipt.paymentReference')}
            maxLength={64}
            value={paymentReference}
            onChange={(event) => setPaymentReference(event.target.value)}
          />
        </CardContent>
      </Card>
      <TextAreaField
        label={t('receipt.notes')}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate('stock')}>
          {t('common.cancel')}
        </Button>
        <Button
          size="lg"
          onClick={() => void save()}
          disabled={saving || lines.length === 0 || supplierId === NONE || location === ''}
        >
          {t('receipt.save')}
        </Button>
      </div>
    </>
  );
}
