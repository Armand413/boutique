import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@shared/format/date';
import type { SaleSummary } from '@shared/schemas/sales';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, Input, Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { SelectField, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';

const PAGE = 50;

/** Historique des ventes (A.4) : filtres, accès au détail. */
export function SalesPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'completed' | 'cancelled' | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<SaleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const filters = useCallback(
    (beforeId?: number) => ({
      ...(query.trim() === '' ? {} : { query: query.trim() }),
      status,
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      ...(beforeId === undefined ? {} : { beforeId }),
      limit: PAGE,
    }),
    [query, status, from, to],
  );
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('sales:list', filters()).then(
        (found) => {
          if (!active) return;
          setRows(found);
          setMore(found.length === PAGE);
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
  }, [filters, attempt]);
  const loadMore = async (): Promise<void> => {
    const last = rows?.at(-1);
    if (last === undefined) return;
    try {
      const found = await invoke('sales:list', filters(last.id));
      setRows((current) => [...(current ?? []), ...found]);
      setMore(found.length === PAGE);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  return (
    <>
      <PageHeader title={t('sales.title')} description={t('sales.description')} />
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sales-search">{t('sales.search')}</Label>
          <Input
            id="sales-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectField
          label={t('sales.filter.status')}
          value={status}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'completed', label: t('sales.status.completed') },
            { value: 'cancelled', label: t('sales.status.cancelled') },
          ]}
          onValueChange={(value) => setStatus(value as typeof status)}
        />
        <TextField
          label={t('sales.filter.from')}
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <TextField
          label={t('sales.filter.to')}
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      {error !== null && (
        <ErrorState
          title={t('sales.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => setAttempt((v) => v + 1)}
        />
      )}
      {error === null && rows === null && <LoadingState label={t('state.loading')} rows={6} />}
      {rows !== null && rows.length === 0 && (
        <p className="text-muted-foreground py-6 text-sm">{t('sales.empty')}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('sales.col.invoice')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('sales.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('sales.col.customer')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('sales.col.user')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('sales.col.items')}
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
              {rows.map((sale) => (
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
                    {sale.status === 'cancelled' && (
                      <Badge tone="danger" className="ml-2">
                        {t('sales.status.cancelled')}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular px-4 py-3">{formatDateTime(sale.completedAt)}</td>
                  <td className="px-4 py-3">{sale.customerName ?? '—'}</td>
                  <td className="px-4 py-3">{sale.userName}</td>
                  <td className="tabular px-4 py-3 text-right">{sale.itemCount}</td>
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
        </Card>
      )}
      {more && (
        <Button variant="secondary" className="self-center" onClick={() => void loadMore()}>
          {t('sales.loadMore')}
        </Button>
      )}
    </>
  );
}
