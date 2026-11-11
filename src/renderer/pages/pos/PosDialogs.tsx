import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { formatMoney } from '@shared/format/money';
import type { CashSession, Customer, HeldSale, SaleUnit } from '@shared/schemas/sales';
import { useSubmit } from '../../auth/use-submit';
import { Input, Label } from '../../components/ui/basic';
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
import { FormError, TextAreaField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { parseOptionalMoney } from '../products/catalog-ui';

interface Closable {
  onOpenChange: (open: boolean) => void;
}

/** Choix des numéros d'un article suivi : au scanner (Entrée) ou en cochant. */
export function UnitDialog({
  variantId,
  name,
  count,
  selected,
  onOpenChange,
  onDone,
}: Closable & {
  variantId: number;
  name: string;
  count: number;
  selected: readonly number[];
  onDone: (ids: number[], serials: string[]) => void;
}) {
  const t = useT();
  const loader = useCallback(() => invoke('sales:units', { variantId }), [variantId]);
  const { state } = useRemote<SaleUnit[]>(loader);
  const [chosen, setChosen] = useState<number[]>([...selected]);
  const [scan, setScan] = useState('');
  const units = state.status === 'ready' ? state.data : [];
  const toggle = (id: number): void =>
    setChosen((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  const confirm = (): void => {
    const serials = chosen.map((id) => units.find((unit) => unit.id === id)?.serialNumber ?? '');
    onDone(chosen, serials);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('units.title', { name })}</DialogTitle>
          <DialogDescription>{t('units.description', { count })}</DialogDescription>
        </DialogHeader>
        <TextField
          label={t('units.scan')}
          autoFocus
          autoComplete="off"
          className="font-mono"
          value={scan}
          onChange={(event) => setScan(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const code = scan.replace(/\s+/g, '').toUpperCase();
            const unit = units.find(
              (candidate) => candidate.serialNumber === code || candidate.imei2 === code,
            );
            if (unit === undefined) toast.error(t('pos.scanFailed', { code }));
            else if (!chosen.includes(unit.id)) setChosen((current) => [...current, unit.id]);
            setScan('');
          }}
        />
        {state.status === 'loading' && <p className="text-sm">{t('state.loading')}</p>}
        {state.status === 'error' && <FormError message={state.message} />}
        {state.status === 'ready' && units.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('units.none')}</p>
        )}
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center gap-3">
              <input
                id={`sale-unit-${String(unit.id)}`}
                type="checkbox"
                className="accent-primary size-5"
                checked={chosen.includes(unit.id)}
                onChange={() => toggle(unit.id)}
              />
              <label htmlFor={`sale-unit-${String(unit.id)}`} className="font-mono text-sm">
                {t('units.option', { serial: unit.serialNumber, location: unit.locationName })}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm}>{t('units.validate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Paniers mis en attente (F8) : reprise ou abandon. */
export function HeldDialog({
  onOpenChange,
  onResume,
}: Closable & { onResume: (saleId: number) => void }) {
  const t = useT();
  const loader = useCallback(() => invoke('sales:held'), []);
  const { state, reload } = useRemote<HeldSale[]>(loader);
  const [discarding, setDiscarding] = useState<HeldSale | null>(null);
  const discard = async (held: HeldSale): Promise<void> => {
    try {
      await invoke('sales:discard', { saleId: held.id });
      toast.success(t('pos.held.discarded'));
      reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pos.held.title')}</DialogTitle>
          <DialogDescription>{t('pos.held.description')}</DialogDescription>
        </DialogHeader>
        {state.status === 'error' && <FormError message={state.message} />}
        <ul className="flex flex-col gap-2">
          {(state.status === 'ready' ? state.data : []).map((held) => (
            <li
              key={held.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <span className="min-w-0 text-sm">
                <span className="block font-medium">
                  {held.customerName ?? t('pos.noCustomer')}
                </span>
                <span className="text-muted-foreground block">
                  {t('pos.held.item', {
                    count: held.itemCount,
                    amount: formatMoney(held.subtotal),
                    user: held.userName,
                  })}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => onResume(held.id)}>
                  {t('pos.held.resume')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDiscarding(held)}>
                  {t('pos.held.discard')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {discarding !== null && (
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setDiscarding(null)}
            title={t('pos.held.discard')}
            description={t('pos.newSale.confirm')}
            confirmLabel={t('pos.held.discard')}
            cancelLabel={t('common.cancel')}
            onConfirm={() => {
              const held = discarding;
              setDiscarding(null);
              void discard(held);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Recherche d'un client depuis la caisse, avec création à la volée (4.6). */
export function CustomerDialog({
  onOpenChange,
  onChoose,
}: Closable & { onChoose: (customer: Customer) => void }) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [phone, setPhone] = useState('');
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('customers:search', { query, limit: 8 }).then(
        (rows) => {
          if (active) setFound(rows.filter((row) => row.isActive));
        },
        (failure: unknown) => {
          if (active) toast.error(errorMessage(failure));
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  const create = async (): Promise<void> => {
    const created = await submit(() =>
      invoke('customers:save', {
        fullName: query,
        phone,
        address: null,
        notes: null,
        creditLimit: 0,
        isActive: true,
      }),
    );
    if (created !== null) {
      toast.success(t('customer.saved'));
      onChoose(created.value);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pos.chooseCustomer')}</DialogTitle>
          <DialogDescription>{t('customer.search')}</DialogDescription>
        </DialogHeader>
        <TextField
          label={t('customer.search')}
          autoFocus
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="flex flex-col gap-1">
          {found.length === 0 && (
            <li className="text-muted-foreground text-sm">{t('customer.none')}</li>
          )}
          {found.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="hover:bg-muted flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm"
                aria-label={t('customer.choose', { name: customer.fullName })}
                onClick={() => onChoose(customer)}
              >
                <span>
                  <span className="block font-medium">{customer.fullName}</span>
                  <span className="text-muted-foreground block">{customer.phone ?? ''}</span>
                </span>
                {customer.balance > 0 && (
                  <span className="text-sm font-medium">
                    {t('customer.balance', { amount: formatMoney(customer.balance) })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {creating ? (
          <div className="flex flex-col gap-3">
            <TextField
              label={t('customer.form.phone')}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <FormError message={error} />
            <Button onClick={() => void create()} disabled={query.trim() === ''}>
              {t('customer.quickCreate')}
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setCreating(true)}
            disabled={query.trim() === ''}
          >
            <UserPlus aria-hidden="true" />
            {t('customer.new')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Entrée ou sortie d'espèces hors vente, avec motif. */
export function CashMoveDialog({
  direction,
  onOpenChange,
  onDone,
}: Closable & { direction: 'in' | 'out'; onDone: (session: CashSession) => void }) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = async (): Promise<void> => {
    const value = parseOptionalMoney(amount);
    if (value === null || value === undefined || value === 0) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    const saved = await submit(() => invoke('cash:move', { direction, amount: value, reason }));
    if (saved !== null) {
      toast.success(t('session.move.saved'));
      onDone(saved.value);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{direction === 'in' ? t('pos.moneyIn') : t('pos.moneyOut')}</DialogTitle>
          <DialogDescription>{t('exit.reasonHint')}</DialogDescription>
        </DialogHeader>
        <TextField
          label={t('session.move.amount')}
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextAreaField
          label={t('session.move.reason')}
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
          <Button onClick={() => void save()} disabled={reason.trim().length < 3}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Clôture de caisse : totaux par moyen de paiement, espèces attendues et comptées, écart (4.5). */
export function CloseSessionDialog({
  session,
  onOpenChange,
  onDone,
}: Closable & { session: CashSession; onDone: () => void }) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [counted, setCounted] = useState('');
  const countedValue = parseOptionalMoney(counted);
  const close = async (): Promise<void> => {
    if (countedValue === null || countedValue === undefined) {
      toast.error(t('product.form.invalidMoney'));
      return;
    }
    const closed = await submit(() =>
      invoke('cash:close', { countedCash: countedValue, notes: null }),
    );
    if (closed !== null) {
      toast.success(t('session.close.done', { amount: formatMoney(closed.value.difference ?? 0) }));
      onDone();
    }
  };
  const row = (label: string, value: number) => (
    <div className="flex justify-between text-sm">
      <span>{label}</span>
      <span className="tabular">{formatMoney(value)}</span>
    </div>
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('session.close.title')}</DialogTitle>
          <DialogDescription>{t('session.close.description')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">
          {t('session.close.sales', {
            count: session.salesCount,
            amount: formatMoney(session.salesTotal),
          })}
        </p>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">{t('session.close.byMethod')}</p>
          {row(t('payment.cash'), session.byMethod.cash)}
          {row(t('payment.card'), session.byMethod.card)}
          {row(t('payment.mobile_money'), session.byMethod.mobile_money)}
          {row(t('payment.transfer'), session.byMethod.transfer)}
          {row(t('payment.cheque'), session.byMethod.cheque)}
        </div>
        <div className="flex flex-col gap-1">
          {row(t('session.close.float'), session.openingFloat)}
          {row(t('session.close.in'), session.cashMovementsIn)}
          {row(t('session.close.out'), -session.cashMovementsOut)}
          {row(t('session.close.refunds'), -session.cashRefunds)}
          <div className="flex justify-between text-base font-semibold">
            <span>{t('session.close.expected')}</span>
            <span className="tabular">{formatMoney(session.expectedCash)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="counted-cash">{t('session.close.counted')}</Label>
          <Input
            id="counted-cash"
            inputMode="decimal"
            autoFocus
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
          />
          {countedValue !== null && countedValue !== undefined && (
            <p role="status" className="text-sm font-medium">
              {t('session.close.difference', {
                amount: formatMoney(countedValue - session.expectedCash),
              })}
            </p>
          )}
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void close()}
            disabled={countedValue === null || countedValue === undefined}
          >
            {t('session.close.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
