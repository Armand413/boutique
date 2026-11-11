import { useEffect, useState } from 'react';
import { formatDate } from '@shared/format/date';
import type { DeliveryRow, InstallmentRow } from '@shared/schemas/sales';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { SelectField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';

type Scope = 'overdue' | 'upcoming' | 'all';

/** Échéancier clients (A.4) : échéances en retard, à venir ou toutes. */
export function InstallmentsPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [scope, setScope] = useState<Scope>('overdue');
  const [rows, setRows] = useState<InstallmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    invoke('installments:list', { scope, limit: 500 }).then(
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
  }, [scope, attempt]);
  return (
    <>
      <PageHeader title={t('installments.title')} description={t('installments.description')} />
      <div className="w-64">
        <SelectField
          label={t('quotes.filter')}
          value={scope}
          options={(['overdue', 'upcoming', 'all'] as const).map((value) => ({
            value,
            label: t(`installments.scope.${value}`),
          }))}
          onValueChange={(value) => setScope(value as Scope)}
        />
      </div>
      {error !== null && (
        <ErrorState
          title={t('installments.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => setAttempt((v) => v + 1)}
        />
      )}
      {error === null && rows === null && <LoadingState label={t('state.loading')} rows={4} />}
      {rows !== null && rows.length === 0 && (
        <p className="text-muted-foreground py-6 text-sm">{t('installments.empty')}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('installments.col.due')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('installments.col.customer')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('installments.col.invoice')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('installments.col.amount')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('installments.col.remaining')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('installments.col.late')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-border border-t">
                  <td className="tabular px-4 py-3">{row.dueDate}</td>
                  <td className="px-4 py-3">
                    {row.customerId === null ? (
                      '—'
                    ) : (
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() =>
                          navigate('customers.detail', { customerId: row.customerId ?? 0 })
                        }
                      >
                        {row.customerName}
                      </button>
                    )}
                    {row.phone !== null && (
                      <span className="text-muted-foreground block">{row.phone}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">{row.invoiceNumber}</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={row.amount} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={row.remaining} className="font-semibold" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.daysOverdue > 0 ? (
                      <Badge tone="danger">
                        {t('installments.late', { days: row.daysOverdue })}
                      </Badge>
                    ) : (
                      '—'
                    )}
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

type DeliveryFilter = DeliveryRow['status'] | 'all';

/** Livraisons (A.4) : à livrer, livrées, annulées. */
export function DeliveriesPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [status, setStatus] = useState<DeliveryFilter>('to_deliver');
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cancelling, setCancelling] = useState<DeliveryRow | null>(null);
  useEffect(() => {
    let active = true;
    invoke('deliveries:list', { status, limit: 500 }).then(
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
  }, [status, attempt]);
  const update = async (row: DeliveryRow, next: 'delivered' | 'cancelled'): Promise<void> => {
    try {
      await invoke('deliveries:update', { deliveryId: row.id, status: next });
      toast.success(t(next === 'delivered' ? 'deliveries.delivered' : 'deliveries.cancelled'));
      setAttempt((v) => v + 1);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  return (
    <>
      <PageHeader title={t('deliveries.title')} description={t('deliveries.description')} />
      <div className="w-64">
        <SelectField
          label={t('quotes.filter')}
          value={status}
          options={[
            ...(['to_deliver', 'delivered', 'cancelled'] as const).map((value) => ({
              value,
              label: t(`delivery.status.${value}`),
            })),
            { value: 'all', label: t('common.all') },
          ]}
          onValueChange={(value) => setStatus(value as DeliveryFilter)}
        />
      </div>
      {error !== null && (
        <ErrorState
          title={t('deliveries.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => setAttempt((v) => v + 1)}
        />
      )}
      {error === null && rows === null && <LoadingState label={t('state.loading')} rows={4} />}
      {rows !== null && rows.length === 0 && (
        <p className="text-muted-foreground py-6 text-sm">{t('deliveries.empty')}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('deliveries.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('deliveries.col.customer')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('deliveries.col.address')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('deliveries.col.invoice')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('deliveries.col.status')}
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t('users.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-border border-t">
                  <td className="tabular px-4 py-3">
                    {row.scheduledAt === null
                      ? t('deliveries.notScheduled')
                      : formatDate(row.scheduledAt)}
                  </td>
                  <td className="px-4 py-3">
                    {row.customerName ?? '—'}
                    {row.phone !== null && (
                      <span className="text-muted-foreground block">{row.phone}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{row.address}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-mono hover:underline"
                      aria-label={t('sales.open', { invoice: row.invoiceNumber })}
                      onClick={() => navigate('sales.detail', { saleId: row.saleId })}
                    >
                      {row.invoiceNumber}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        row.status === 'delivered'
                          ? 'success'
                          : row.status === 'cancelled'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {t(`delivery.status.${row.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'to_deliver' && (
                      <span className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => void update(row, 'delivered')}>
                          {t('deliveries.markDelivered')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(row)}>
                          {t('deliveries.markCancelled')}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {cancelling !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setCancelling(null)}
          title={t('deliveries.cancel.title')}
          description={t('deliveries.cancel.description')}
          confirmLabel={t('deliveries.markCancelled')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            const row = cancelling;
            setCancelling(null);
            void update(row, 'cancelled');
          }}
        />
      )}
    </>
  );
}
