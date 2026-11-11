import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  Minus,
  Pause,
  Plus,
  ShoppingCart,
  Trash2,
  UserRound,
} from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { ProductRow } from '@shared/schemas/catalog';
import type { CartPreview, CashSession, Customer, Discount } from '@shared/schemas/sales';
import { useSubmit } from '../../auth/use-submit';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, Input, Kbd, Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { FormError, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useHotkey } from '../../hotkeys/hotkeys';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import { cartLines, usePos, type NewLine, type PosLine } from '../../stores/pos';
import { parseOptionalMoney } from '../products/catalog-ui';
import { PaymentDialog } from './PaymentDialog';
import {
  CashMoveDialog,
  CloseSessionDialog,
  CustomerDialog,
  HeldDialog,
  UnitDialog,
} from './PosDialogs';
import { beep, missingUnits, posLinesFrom } from './pos-ui';

type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: CashSession | null };

type PosDialog =
  | { kind: 'pay' | 'held' | 'close' | 'newSale' }
  | { kind: 'customer'; thenPay: boolean }
  | { kind: 'move'; direction: 'in' | 'out' }
  | {
      kind: 'units';
      key: string;
      variantId: number;
      name: string;
      count: number;
      selected: number[];
      componentOf?: string;
    }
  | null;

function OpenSession({ onOpened }: { onOpened: (session: CashSession) => void }) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [amount, setAmount] = useState('0');
  const open = async (): Promise<void> => {
    const value = parseOptionalMoney(amount);
    if (value === null || value === undefined) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    const opened = await submit(() => invoke('cash:open', { openingFloat: value }));
    if (opened !== null) {
      toast.success(t('pos.opened'));
      onOpened(opened.value);
    }
  };
  return (
    <EmptyState
      icon={Lock}
      title={t('pos.closed.title')}
      description={t('pos.closed.description')}
      action={
        <form
          className="flex w-72 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <TextField
            label={t('pos.openingFloat')}
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <FormError message={error} />
          <Button type="submit" size="lg">
            {t('pos.open')}
          </Button>
        </form>
      }
    />
  );
}

function toNewLine(row: ProductRow): Promise<NewLine> {
  const base: NewLine = {
    variantId: row.variantId,
    name: row.name,
    variantLabel: row.variantLabel,
    sku: row.sku,
    productType: row.productType,
    trackingMode: row.trackingMode,
  };
  if (row.productType !== 'kit') return Promise.resolve(base);
  return invoke('products:get', { productId: row.productId }).then((product) => {
    const variant = product.variants.find((candidate) => candidate.id === row.variantId);
    return {
      ...base,
      components: (variant?.components ?? [])
        .filter((component) => component.isStocked && component.trackingMode !== 'none')
        .map((component) => ({
          variantId: component.variantId,
          name: component.productName,
          quantity: component.quantity,
        })),
    };
  });
}

function DiscountEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Discount | null;
  onChange: (discount: Discount | null) => void;
}) {
  const t = useT();
  const [type, setType] = useState<'percent' | 'amount'>(value?.type ?? 'percent');
  const [text, setText] = useState(
    value === null
      ? ''
      : value.type === 'percent'
        ? String(value.value / 100)
        : String(value.value),
  );
  const apply = (nextText: string, nextType: 'percent' | 'amount'): void => {
    setText(nextText);
    setType(nextType);
    const trimmed = nextText.trim().replace(',', '.');
    if (trimmed === '') {
      onChange(null);
      return;
    }
    const number = Number(trimmed);
    if (!Number.isFinite(number) || number < 0) return;
    onChange(
      nextType === 'percent'
        ? { type: 'percent', value: Math.min(10_000, Math.round(number * 100)) }
        : { type: 'amount', value: Math.round(number) },
    );
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-8 w-20 text-sm"
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(event) => apply(event.target.value, type)}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('pos.discountType')}
        aria-pressed={type === 'percent'}
        onClick={() => apply(text, type === 'percent' ? 'amount' : 'percent')}
      >
        {type === 'percent' ? t('pos.discountPercent') : t('pos.discountAmount')}
      </Button>
    </div>
  );
}

function CartLineRow({
  line,
  lineTotal,
  onUnits,
}: {
  line: PosLine;
  lineTotal: number | null;
  onUnits: (line: PosLine, componentVariantId?: number) => void;
}) {
  const t = useT();
  const { setQuantity, setDiscount, remove } = usePos();
  const name = line.variantLabel === '' ? line.name : `${line.name} (${line.variantLabel})`;
  const tracked =
    line.trackingMode !== 'none' && line.productType !== 'kit' && line.productType !== 'service';
  const fromQuote = line.quoteLineId !== undefined;
  return (
    <li className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{name}</p>
          <p className="text-muted-foreground font-mono text-xs">{line.sku}</p>
          {line.serialNumbers.length > 0 && (
            <p className="font-mono text-xs">
              {t('pos.units', { serials: line.serialNumbers.join(', ') })}
            </p>
          )}
        </div>
        <span className="tabular text-base font-semibold">
          {lineTotal === null ? '…' : formatMoney(lineTotal)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!fromQuote && (
          <span className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('pos.decrease', { name })}
              onClick={() => setQuantity(line.key, line.quantity - 1)}
              disabled={line.quantity <= 1}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Input
              className="tabular h-8 w-14 text-center"
              inputMode="numeric"
              aria-label={t('pos.quantity', { name })}
              value={String(line.quantity)}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) setQuantity(line.key, value);
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('pos.increase', { name })}
              onClick={() => setQuantity(line.key, line.quantity + 1)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </span>
        )}
        {!fromQuote && (
          <DiscountEditor
            label={t('pos.lineDiscount', { name })}
            value={line.discount}
            onChange={(discount) => setDiscount(line.key, discount)}
          />
        )}
        {tracked && (
          <Button
            size="sm"
            variant={line.serialUnitIds.length === line.quantity ? 'ghost' : 'secondary'}
            onClick={() => onUnits(line)}
          >
            {t('pos.chooseUnits', { count: line.quantity })}
          </Button>
        )}
        {line.components.map((component) => (
          <Button
            key={component.variantId}
            size="sm"
            variant={component.serialUnitIds.length === component.required ? 'ghost' : 'secondary'}
            onClick={() => onUnits(line, component.variantId)}
          >
            {component.name} · {t('pos.chooseUnits', { count: component.required })}
          </Button>
        ))}
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto"
          aria-label={t('pos.remove', { name })}
          onClick={() => remove(line.key)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** Caisse (A.5) : au clavier et au scanner, recherche à gauche, panier et total à droite. */
export function PosPage() {
  const t = useT();
  const pos = usePos();
  const searchRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; rows: ProductRow[] }>({
    query: '',
    rows: [],
  });
  const [computed, setPreview] = useState<CartPreview | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const [dialog, setDialog] = useState<PosDialog>(null);
  const focusSearch = useCallback(() => window.setTimeout(() => searchRef.current?.focus(), 0), []);

  const loadSession = useCallback(() => {
    invoke('cash:current').then(
      (current) => setSession({ status: 'ready', session: current }),
      (error: unknown) => setSession({ status: 'error', message: errorMessage(error) }),
    );
    invoke('sales:held').then(
      (held) => setHeldCount(held.length),
      () => setHeldCount(0),
    );
  }, []);
  useEffect(loadSession, [loadSession]);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('products:search', {
        query: trimmed,
        status: 'active',
        sort: 'name',
        offset: 0,
        limit: 8,
      }).then(
        (found) => {
          if (active) setResults({ query: trimmed, rows: found.rows });
        },
        (error: unknown) => {
          if (active) toast.error(errorMessage(error));
        },
      );
    }, 100);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [trimmed]);
  const rows = results.query === trimmed && trimmed.length >= 2 ? results.rows : [];

  const lines = pos.lines;
  const preview = lines.length === 0 ? null : computed;
  useEffect(() => {
    if (lines.length === 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('sales:preview', {
        lines: cartLines(lines),
        globalDiscount: pos.globalDiscount,
        quoteId: pos.quote?.id ?? null,
      }).then(
        (result) => {
          if (active) setPreview(result);
        },
        (error: unknown) => {
          if (active) toast.error(errorMessage(error));
        },
      );
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [lines, pos.globalDiscount, pos.quote]);

  const addRow = async (row: ProductRow): Promise<void> => {
    try {
      const line = await toNewLine(row);
      pos.add(line);
      beep(true);
      setQuery('');
      const added = usePos
        .getState()
        .lines.find((candidate) => candidate.variantId === row.variantId);
      if (added !== undefined && missingUnits(added) && added.components.length === 0) {
        setDialog({
          kind: 'units',
          key: added.key,
          variantId: added.variantId,
          name: added.name,
          count: added.quantity,
          selected: added.serialUnitIds,
        });
      } else focusSearch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  /** Entrée : code-barres ou référence exacts en tête ; sinon IMEI ou numéro de série d'une unité en stock. */
  const scan = async (): Promise<void> => {
    const code = trimmed;
    if (code === '') return;
    try {
      const found = await invoke('products:search', {
        query: code,
        status: 'active',
        sort: 'name',
        offset: 0,
        limit: 8,
      });
      const exact = found.rows.find(
        (row) => row.barcode === code || row.sku.toLowerCase() === code.toLowerCase(),
      );
      // Une suite de chiffres sans code-barres exact est plutôt un IMEI ou un numéro de série.
      const candidate = exact ?? (/^\d{8,}$/.test(code) ? undefined : found.rows[0]);
      if (candidate !== undefined) {
        await addRow(candidate);
        return;
      }
      const units = code.length >= 4 ? await invoke('serials:find', { serial: code }) : [];
      const [unit] = units;
      if (unit === undefined) {
        beep(false);
        toast.error(t('pos.scanFailed', { code }));
        return;
      }
      if (unit.status !== 'in_stock') {
        beep(false);
        toast.error(
          t('pos.unitUnavailable', {
            serial: unit.serialNumber,
            status: t(`serial.${unit.status}`),
          }),
        );
        return;
      }
      pos.add(
        {
          variantId: unit.variantId,
          name: unit.productName,
          variantLabel: unit.variantLabel,
          sku: unit.sku,
          productType: 'phone',
          trackingMode: 'serial',
        },
        { id: unit.id, serialNumber: unit.serialNumber },
      );
      beep(true);
      toast.success(t('pos.unitAdded', { serial: unit.serialNumber }));
      setQuery('');
    } catch (error) {
      beep(false);
      toast.error(errorMessage(error));
    }
  };

  const hold = async (): Promise<void> => {
    if (lines.length === 0) return;
    try {
      await invoke('sales:hold', {
        ...(pos.heldSaleId === null ? {} : { heldSaleId: pos.heldSaleId }),
        customerId: pos.customer?.id ?? null,
        lines: cartLines(lines),
        globalDiscount: pos.globalDiscount,
      });
      pos.clear();
      toast.success(t('pos.held.saved'));
      loadSession();
      focusSearch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const resume = async (saleId: number): Promise<void> => {
    try {
      const cart = await invoke('sales:resume', { saleId });
      const customer: Customer | null =
        cart.customerId === null
          ? null
          : await invoke('customers:get', { customerId: cart.customerId });
      pos.load({
        lines: posLinesFrom(cart.lines, cart.display),
        customer,
        heldSaleId: cart.heldSaleId,
        quote: null,
      });
      setDialog(null);
      focusSearch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const ready = session.status === 'ready' && session.session !== null;
  const blocked = dialog !== null;
  const canPay =
    lines.length > 0 &&
    preview !== null &&
    preview.issues.length === 0 &&
    !lines.some(missingUnits);
  useHotkey('F2', () => (lines.length === 0 ? focusSearch() : setDialog({ kind: 'newSale' })), {
    enabled: ready && !blocked,
  });
  useHotkey('F4', () => canPay && setDialog({ kind: 'pay' }), { enabled: ready && !blocked });
  useHotkey('F8', () => void hold(), { enabled: ready && !blocked });
  useHotkey(
    'Escape',
    () => {
      setQuery('');
      focusSearch();
    },
    { enabled: ready && !blocked },
  );

  if (session.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (session.status === 'error') {
    return (
      <ErrorState
        title={t('state.error.title')}
        message={session.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={loadSession}
      />
    );
  }
  if (session.session === null) {
    return (
      <>
        <PageHeader title={t('pos.title')} description={t('pos.closed.description')} />
        <OpenSession onOpened={(opened) => setSession({ status: 'ready', session: opened })} />
      </>
    );
  }
  const current = session.session;
  const shortcut = (key: string, label: string) => (
    <span className="flex items-center gap-1">
      <Kbd>{key}</Kbd>
      {label}
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('pos.title')}
        description={t('pos.session', {
          name: current.openedBy,
          date: formatDateTime(current.openedAt),
        })}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDialog({ kind: 'held' })}
              disabled={heldCount === 0}
            >
              <Pause aria-hidden="true" />
              {t('pos.held', { count: heldCount })}
            </Button>
            <Button variant="ghost" onClick={() => setDialog({ kind: 'move', direction: 'in' })}>
              <ArrowDownToLine aria-hidden="true" />
              {t('pos.moneyIn')}
            </Button>
            <Button variant="ghost" onClick={() => setDialog({ kind: 'move', direction: 'out' })}>
              <ArrowUpFromLine aria-hidden="true" />
              {t('pos.moneyOut')}
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'close' })}>
              <Lock aria-hidden="true" />
              {t('pos.closeSession')}
            </Button>
          </div>
        }
      />
      <div
        className="text-muted-foreground flex flex-wrap gap-4 text-sm"
        aria-label={t('pos.shortcuts')}
      >
        {shortcut('F2', t('pos.newSale'))}
        {shortcut('F4', t('pos.checkout'))}
        {shortcut('F8', t('pos.hold'))}
        {shortcut('Échap', t('common.cancel'))}
      </div>
      {pos.quote !== null && (
        <Badge tone="info">{t('pos.fromQuote', { number: pos.quote.number })}</Badge>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
        <section className="flex flex-col gap-3" aria-label={t('pos.searchLabel')}>
          <Label htmlFor="pos-search">{t('pos.searchLabel')}</Label>
          <Input
            ref={searchRef}
            id="pos-search"
            className="h-12 text-lg"
            autoFocus
            autoComplete="off"
            placeholder={t('pos.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void scan();
            }}
          />
          <p className="text-muted-foreground text-sm">{t('pos.searchHint')}</p>
          {trimmed.length >= 2 && results.query === trimmed && rows.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('pos.noResult')}</p>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const name = row.variantLabel === '' ? row.name : `${row.name} (${row.variantLabel})`;
              return (
                <li key={row.variantId}>
                  <button
                    type="button"
                    className="border-border hover:bg-muted flex min-h-14 w-full items-center justify-between gap-3 rounded-md border px-4 py-2 text-left"
                    aria-label={t('pos.add', { name })}
                    onClick={() => void addRow(row)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="text-muted-foreground block text-sm">
                        {row.isStocked ? t('pos.stock', { count: row.stock }) : t('pos.service')}
                      </span>
                    </span>
                    <Money amount={row.salePrice} className="font-semibold" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <ShoppingCart className="size-5" aria-hidden="true" />
                {t('pos.cart')}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDialog({ kind: 'customer', thenPay: false })}
              >
                <UserRound aria-hidden="true" />
                {pos.customer === null ? t('pos.chooseCustomer') : pos.customer.fullName}
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {t('pos.cart.empty')}
              </p>
            ) : (
              <ul className="flex flex-col">
                {lines.map((line, index) => (
                  <CartLineRow
                    key={line.key}
                    line={line}
                    lineTotal={preview?.lines[index]?.lineTotal ?? null}
                    onUnits={(target, componentVariantId) => {
                      const component = target.components.find(
                        (candidate) => candidate.variantId === componentVariantId,
                      );
                      setDialog(
                        component === undefined
                          ? {
                              kind: 'units',
                              key: target.key,
                              variantId: target.variantId,
                              name: target.name,
                              count: target.quantity,
                              selected: target.serialUnitIds,
                            }
                          : {
                              kind: 'units',
                              key: target.key,
                              variantId: component.variantId,
                              name: component.name,
                              count: component.required,
                              selected: component.serialUnitIds,
                              componentOf: target.key,
                            },
                      );
                    }}
                  />
                ))}
              </ul>
            )}
            {lines.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t('pos.globalDiscount')}</span>
                <DiscountEditor
                  label={t('pos.globalDiscount')}
                  value={pos.globalDiscount}
                  onChange={pos.setGlobalDiscount}
                />
              </div>
            )}
            {preview !== null && (
              <dl className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <dt>{t('pos.subtotal')}</dt>
                  <dd className="tabular">{formatMoney(preview.subtotal)}</dd>
                </div>
                {preview.discountTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <dt>{t('pos.discounts')}</dt>
                    <dd className="tabular">-{formatMoney(preview.discountTotal)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between">
                  <dt className="text-lg font-semibold">{t('pos.total')}</dt>
                  <dd className="tabular text-4xl font-bold" data-testid="pos-total">
                    {formatMoney(preview.total)}
                  </dd>
                </div>
                {preview.taxIncluded > 0 && (
                  <p className="text-muted-foreground text-right text-sm">
                    {t('pos.taxIncluded', { amount: formatMoney(preview.taxIncluded) })}
                  </p>
                )}
              </dl>
            )}
            {preview !== null && preview.issues.length > 0 && (
              <div
                role="alert"
                className="bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 text-sm"
              >
                <p className="font-semibold">{t('pos.issues')}</p>
                <ul className="list-disc pl-5">
                  {preview.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              size="xl"
              variant="success"
              disabled={!canPay}
              onClick={() => setDialog({ kind: 'pay' })}
            >
              {t('pos.checkout')} <Kbd className="ml-2">F4</Kbd>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={lines.length === 0} onClick={() => void hold()}>
                {t('pos.hold')} <Kbd>F8</Kbd>
              </Button>
              <Button
                variant="ghost"
                disabled={lines.length === 0}
                onClick={() => setDialog({ kind: 'newSale' })}
              >
                {t('pos.cancelSale')} <Kbd>F2</Kbd>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {dialog?.kind === 'units' && (
        <UnitDialog
          variantId={dialog.variantId}
          name={dialog.name}
          count={dialog.count}
          selected={dialog.selected}
          onOpenChange={() => {
            setDialog(null);
            focusSearch();
          }}
          onDone={(ids, serials) => {
            if (dialog.componentOf === undefined) pos.setUnits(dialog.key, ids, serials);
            else pos.setComponentUnits(dialog.componentOf, dialog.variantId, ids, serials);
            setDialog(null);
            focusSearch();
          }}
        />
      )}
      {dialog?.kind === 'held' && (
        <HeldDialog
          onOpenChange={() => setDialog(null)}
          onResume={(saleId) => void resume(saleId)}
        />
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog
          onOpenChange={() => setDialog(null)}
          onChoose={(customer) => {
            pos.setCustomer(customer);
            setDialog(dialog.thenPay ? { kind: 'pay' } : null);
            if (!dialog.thenPay) focusSearch();
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <CashMoveDialog
          direction={dialog.direction}
          onOpenChange={() => setDialog(null)}
          onDone={(updated) => {
            setSession({ status: 'ready', session: updated });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'close' && (
        <CloseSessionDialog
          session={current}
          onOpenChange={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            pos.clear();
            loadSession();
          }}
        />
      )}
      {dialog?.kind === 'newSale' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('pos.newSale.title')}
          description={t('pos.newSale.confirm')}
          confirmLabel={t('pos.newSale')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            pos.clear();
            setDialog(null);
            focusSearch();
          }}
        />
      )}
      {dialog?.kind === 'pay' && preview !== null && (
        <PaymentDialog
          total={preview.total}
          onOpenChange={() => {
            setDialog(null);
            focusSearch();
          }}
          onChooseCustomer={() => setDialog({ kind: 'customer', thenPay: true })}
          onFinished={() => {
            pos.clear();
            setDialog(null);
            loadSession();
            focusSearch();
          }}
        />
      )}
    </>
  );
}
