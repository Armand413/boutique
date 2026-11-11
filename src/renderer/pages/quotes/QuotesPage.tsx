import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  FileText,
  Send,
  ShoppingCart,
  Trash2,
  UserRound,
} from 'lucide-react';
import { formatMoney } from '@shared/format/money';
import type {
  Customer,
  Discount,
  QuoteDetail,
  QuoteSummary,
  CartPreview,
} from '@shared/schemas/sales';
import type { ProductRow } from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
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
import { PageHeader } from '../../layout/AppShell';
import { usePos } from '../../stores/pos';
import { useRouter } from '../../stores/router';
import { useCan } from '../products/catalog-ui';
import { CustomerDialog, UnitDialog } from '../pos/PosDialogs';
import { posLinesFrom } from '../pos/pos-ui';
import { VariantPicker } from '../stock/stock-ui';

type Filter = QuoteSummary['status'] | 'open' | 'all';

function statusTone(
  status: QuoteSummary['status'],
): 'neutral' | 'info' | 'success' | 'warning' | 'primary' {
  if (status === 'sent') return 'info';
  if (status === 'accepted') return 'success';
  if (status === 'expired') return 'warning';
  if (status === 'converted') return 'primary';
  return 'neutral';
}

/** Devis (A.4) : liste par état. */
export function QuotesPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    invoke('quotes:list', { status: filter, limit: 200 }).then(
      (found) => {
        if (!active) return;
        setRows(found);
        setError(null);
      },
      (failure: unknown) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [filter, attempt]);
  const newButton = (
    <Button onClick={() => navigate('quotes.edit', {})}>
      <FilePlus2 aria-hidden="true" />
      {t('quotes.new')}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t('quotes.title')}
        description={t('quotes.description')}
        actions={newButton}
      />
      <div className="w-64">
        <SelectField
          label={t('quotes.filter')}
          value={filter}
          options={[
            { value: 'open', label: t('quotes.filter.open') },
            ...(['draft', 'sent', 'accepted', 'expired', 'converted'] as const).map((value) => ({
              value,
              label: t(`quotes.status.${value}`),
            })),
            { value: 'all', label: t('common.all') },
          ]}
          onValueChange={(value) => setFilter(value as Filter)}
        />
      </div>
      {error !== null && (
        <ErrorState
          title={t('quotes.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => setAttempt((v) => v + 1)}
        />
      )}
      {error === null && rows === null && <LoadingState label={t('state.loading')} rows={4} />}
      {rows !== null && rows.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title={t('quotes.empty.title')}
          description={t('quotes.empty.description')}
          action={newButton}
        />
      )}
      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('quotes.col.number')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('quotes.col.customer')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('quotes.col.validUntil')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('quotes.col.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('quotes.col.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((quote) => (
                <tr key={quote.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-mono font-medium hover:underline"
                      aria-label={t('quotes.open', { number: quote.number })}
                      onClick={() => navigate('quotes.edit', { quoteId: quote.id })}
                    >
                      {quote.number}
                    </button>
                  </td>
                  <td className="px-4 py-3">{quote.customerName ?? '—'}</td>
                  <td className="tabular px-4 py-3">{quote.validUntil}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(quote.status)}>
                      {t(`quotes.status.${quote.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={quote.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

interface QuoteLine {
  key: string;
  variantId: number;
  name: string;
  trackingMode: ProductRow['trackingMode'];
  productType: ProductRow['productType'];
  quantity: number;
  discount: Discount | null;
  serialUnitIds: number[];
  serialNumbers: string[];
}

let counter = 0;
const nextKey = (): string => {
  counter += 1;
  return `devis-${String(counter)}`;
};

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Préparation, envoi, acceptation et conversion d'un devis (4.12). */
export function QuoteEditorPage() {
  const t = useT();
  const quoteId = useRouter((state) => state.params.quoteId);
  const navigate = useRouter((state) => state.navigate);
  const canSell = useCan('pos.use');
  const pos = usePos();
  const { error, submit } = useSubmit();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(quoteId !== undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [validUntil, setValidUntil] = useState(inDays(15));
  const [reserve, setReserve] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [computed, setPreview] = useState<CartPreview | null>(null);
  const preview = lines.length === 0 ? null : computed;
  const [dialog, setDialog] = useState<
    { kind: 'customer' } | { kind: 'units'; line: QuoteLine } | null
  >(null);

  const apply = useCallback(async (quote: QuoteDetail) => {
    setDetail(quote);
    setValidUntil(quote.quote.validUntil);
    setReserve(quote.quote.reserveStock);
    setNotes(quote.notes ?? '');
    setCustomer(
      quote.customerId === null
        ? null
        : await invoke('customers:get', { customerId: quote.customerId }),
    );
    const grouped = new Map<number, QuoteLine>();
    for (const line of quote.lines) {
      const existing = grouped.get(line.variantId);
      if (existing !== undefined && line.serialUnitId !== null) {
        existing.quantity += 1;
        existing.serialUnitIds.push(line.serialUnitId);
        existing.serialNumbers.push(line.serialNumber ?? '');
        existing.discount = {
          type: 'amount',
          value:
            (existing.discount?.type === 'amount' ? existing.discount.value : 0) + line.discount,
        };
        continue;
      }
      grouped.set(line.variantId, {
        key: nextKey(),
        variantId: line.variantId,
        name: line.description,
        trackingMode: line.serialUnitId === null ? 'none' : 'serial',
        productType: 'accessory',
        quantity: line.quantity,
        discount: line.discount === 0 ? null : { type: 'amount', value: line.discount },
        serialUnitIds: line.serialUnitId === null ? [] : [line.serialUnitId],
        serialNumbers: line.serialNumber === null ? [] : [line.serialNumber],
      });
    }
    setLines([...grouped.values()]);
  }, []);

  useEffect(() => {
    if (quoteId === undefined) return;
    let active = true;
    invoke('quotes:get', { quoteId }).then(
      (quote) => {
        if (active) void apply(quote).finally(() => setLoading(false));
      },
      (failure: unknown) => {
        if (!active) return;
        setLoadError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [quoteId, apply]);

  useEffect(() => {
    if (lines.length === 0 || !canSell) return;
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('sales:preview', {
        lines: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          discount: line.discount,
        })),
        globalDiscount: null,
        quoteId: null,
      }).then(
        (result) => {
          if (active) setPreview(result);
        },
        () => {
          if (active) setPreview(null);
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [lines, canSell]);

  if (loading) return <LoadingState label={t('state.loading')} rows={5} />;
  if (loadError !== null) {
    return (
      <ErrorState
        title={t('quotes.error')}
        message={loadError}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={() => navigate('quotes')}
      />
    );
  }
  const status = detail?.quote.status ?? 'draft';
  const editable = status === 'draft' || status === 'sent';
  const convertible = detail !== null && ['draft', 'sent', 'accepted'].includes(status);

  const add = (row: ProductRow): void =>
    setLines((current) =>
      current.some((line) => line.variantId === row.variantId)
        ? current.map((line) =>
            line.variantId === row.variantId ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...current,
            {
              key: nextKey(),
              variantId: row.variantId,
              name: row.variantLabel === '' ? row.name : `${row.name} (${row.variantLabel})`,
              trackingMode: row.trackingMode,
              productType: row.productType,
              quantity: 1,
              discount: null,
              serialUnitIds: [],
              serialNumbers: [],
            },
          ],
    );
  const update = (key: string, patch: Partial<QuoteLine>): void =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const save = async (): Promise<void> => {
    const saved = await submit(() =>
      invoke('quotes:save', {
        ...(detail === null ? {} : { id: detail.quote.id }),
        customerId: customer?.id ?? null,
        validUntil,
        reserveStock: reserve,
        notes,
        lines: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          discount: line.discount,
          ...(reserve && line.serialUnitIds.length > 0
            ? { serialUnitIds: line.serialUnitIds }
            : {}),
        })),
        globalDiscount: null,
      }),
    );
    if (saved !== null) {
      toast.success(t('quote.saved'));
      await apply(saved.value);
      if (quoteId === undefined) navigate('quotes.edit', { quoteId: saved.value.quote.id });
    }
  };
  const setStatus = async (next: 'sent' | 'accepted'): Promise<void> => {
    if (detail === null) return;
    const saved = await submit(() =>
      invoke('quotes:setStatus', { quoteId: detail.quote.id, status: next }),
    );
    if (saved !== null) {
      toast.success(t('quote.statusSaved'));
      await apply(saved.value);
    }
  };
  const pdf = async (): Promise<void> => {
    if (detail === null) return;
    try {
      if ((await invoke('documents:saveQuote', { quoteId: detail.quote.id })).saved)
        toast.success(t('pay.saved'));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  const convert = async (): Promise<void> => {
    if (detail === null) return;
    try {
      const cart = await invoke('quotes:toCart', { quoteId: detail.quote.id });
      pos.load({
        lines: posLinesFrom(cart.lines, cart.display),
        customer,
        heldSaleId: null,
        quote: { id: detail.quote.id, number: detail.quote.number },
      });
      navigate('pos');
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  return (
    <>
      <PageHeader
        title={
          detail === null
            ? t('quote.newTitle')
            : t('quote.editTitle', { number: detail.quote.number })
        }
        description={t('quote.description')}
        actions={
          detail === null ? undefined : (
            <div className="flex flex-wrap justify-end gap-2">
              <Badge tone={statusTone(status)}>{t(`quotes.status.${status}`)}</Badge>
              <Button variant="secondary" onClick={() => void pdf()}>
                <FileText aria-hidden="true" />
                {t('quote.pdf')}
              </Button>
              {status === 'draft' && (
                <Button variant="secondary" onClick={() => void setStatus('sent')}>
                  <Send aria-hidden="true" />
                  {t('quote.markSent')}
                </Button>
              )}
              {editable && (
                <Button variant="secondary" onClick={() => void setStatus('accepted')}>
                  <CheckCircle2 aria-hidden="true" />
                  {t('quote.markAccepted')}
                </Button>
              )}
              {convertible && canSell && (
                <Button onClick={() => void convert()}>
                  <ShoppingCart aria-hidden="true" />
                  {t('quote.convert')}
                </Button>
              )}
            </div>
          )
        }
      />
      {!editable && (
        <p className="text-muted-foreground text-sm">
          {t('quote.readOnly', { status: t(`quotes.status.${status}`) })}
        </p>
      )}
      {typeof detail?.quote.convertedInvoice === 'string' && (
        <p className="text-sm font-medium">
          {t('quote.convertedTo', { invoice: detail.quote.convertedInvoice })}
        </p>
      )}
      <Card>
        <CardContent className="grid grid-cols-3 items-end gap-4 pt-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('pos.customer')}</span>
            <Button
              variant="secondary"
              disabled={!editable}
              onClick={() => setDialog({ kind: 'customer' })}
            >
              <UserRound aria-hidden="true" />
              {customer?.fullName ?? t('pos.chooseCustomer')}
            </Button>
          </div>
          <TextField
            label={t('quote.validUntil')}
            type="date"
            disabled={!editable}
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <CheckboxField
            label={t('quote.reserve')}
            disabled={!editable}
            checked={reserve}
            onChange={(event) => setReserve(event.target.checked)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('quote.lines')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <VariantPicker includeAll onPick={add} />}
          <ul className="flex flex-col">
            {lines.map((line, index) => {
              const tracked =
                line.trackingMode !== 'none' &&
                line.productType !== 'kit' &&
                line.productType !== 'service';
              return (
                <li
                  key={line.key}
                  className="border-border flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{line.name}</span>
                    {line.serialNumbers.length > 0 && (
                      <span className="block font-mono text-xs">
                        {t('pos.units', { serials: line.serialNumbers.join(', ') })}
                      </span>
                    )}
                  </span>
                  <Input
                    className="tabular w-20 text-center"
                    inputMode="numeric"
                    disabled={!editable}
                    aria-label={t('pos.quantity', { name: line.name })}
                    value={String(line.quantity)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value) && value > 0)
                        update(line.key, {
                          quantity: value,
                          serialUnitIds: line.serialUnitIds.slice(0, value),
                          serialNumbers: line.serialNumbers.slice(0, value),
                        });
                    }}
                  />
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    disabled={!editable}
                    aria-label={t('pos.lineDiscount', { name: line.name })}
                    placeholder={t('pos.discountAmount')}
                    value={
                      line.discount === null
                        ? ''
                        : line.discount.type === 'amount'
                          ? String(line.discount.value)
                          : ''
                    }
                    onChange={(event) => {
                      const value = Number(event.target.value.replace(/\s/g, ''));
                      update(line.key, {
                        discount:
                          event.target.value.trim() === '' || !Number.isFinite(value)
                            ? null
                            : { type: 'amount', value: Math.max(0, Math.round(value)) },
                      });
                    }}
                  />
                  {tracked && reserve && editable && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog({ kind: 'units', line })}
                    >
                      {t('pos.chooseUnits', { count: line.quantity })}
                    </Button>
                  )}
                  <span className="tabular w-28 text-right font-semibold">
                    {preview?.lines[index] === undefined
                      ? ''
                      : formatMoney(preview.lines[index].lineTotal)}
                  </span>
                  {editable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('pos.remove', { name: line.name })}
                      onClick={() =>
                        setLines((current) => current.filter((other) => other.key !== line.key))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {preview !== null && (
            <p className="tabular text-right text-xl font-semibold">{formatMoney(preview.total)}</p>
          )}
        </CardContent>
      </Card>
      <TextAreaField
        label={t('quote.notes')}
        disabled={!editable}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <FormError message={error} />
      {editable && (
        <div className="flex justify-end">
          <Button size="lg" disabled={lines.length === 0} onClick={() => void save()}>
            {t('quote.save')}
          </Button>
        </div>
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog
          onOpenChange={() => setDialog(null)}
          onChoose={(chosen) => {
            setCustomer(chosen);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'units' && (
        <UnitDialog
          variantId={dialog.line.variantId}
          name={dialog.line.name}
          count={dialog.line.quantity}
          selected={dialog.line.serialUnitIds}
          onOpenChange={() => setDialog(null)}
          onDone={(ids, serials) => {
            update(dialog.line.key, {
              serialUnitIds: ids,
              serialNumbers: serials,
              quantity: Math.max(ids.length, 1),
            });
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
