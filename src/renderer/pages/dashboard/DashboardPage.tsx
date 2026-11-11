import { useCallback } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ChartColumn,
  PackagePlus,
  ShieldCheck,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { Dashboard } from '@shared/schemas/reports';
import { SimpleChart } from '../../components/charts/charts';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { cn } from '../../lib/cn';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { useCan } from '../products/catalog-ui';

function PeriodCard({ title, totals }: { title: string; totals: Dashboard['today'] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="tabular text-2xl font-semibold">{formatMoney(totals.revenueTtc)}</p>
        <p className="text-muted-foreground text-sm">
          {t('dashboard.salesCount', { count: totals.count })}
        </p>
        {totals.margin !== null && (
          <p className="text-sm font-medium">
            {t('dashboard.margin', { value: formatMoney(totals.margin) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AlertTile({
  icon: Icon,
  label,
  value,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  onOpen: (() => void) | null;
}) {
  const content = (
    <>
      <Icon
        className={cn('size-6', value > 0 ? 'text-warning' : 'text-muted-foreground')}
        aria-hidden="true"
      />
      <span className="flex flex-col items-start">
        <span className="tabular text-2xl font-semibold">{value}</span>
        <span className="text-muted-foreground text-sm">{label}</span>
      </span>
    </>
  );
  const className =
    'border-border bg-surface flex items-center gap-4 rounded-lg border p-4 text-left';
  return onOpen === null ? (
    <div className={className}>{content}</div>
  ) : (
    <button type="button" className={cn(className, 'hover:bg-muted')} onClick={onOpen}>
      {content}
    </button>
  );
}

function DaysChart({ data }: { data: Dashboard['days'] }) {
  const t = useT();
  const total = data.reduce((sum, point) => sum + point.revenueTtc, 0);
  const best = data.reduce<Dashboard['days'][number] | null>(
    (top, point) => (top === null || point.revenueTtc > top.revenueTtc ? point : top),
    null,
  );
  if (total === 0)
    return <p className="text-muted-foreground text-sm">{t('dashboard.chart.noData')}</p>;
  const withMargin = data.some((point) => point.margin !== null);
  return (
    <SimpleChart
      type="bar"
      data={data}
      labelKey="day"
      series={[
        { key: 'revenueTtc', label: t('dashboard.series.revenue') },
        ...(withMargin ? [{ key: 'margin', label: t('dashboard.series.margin') }] : []),
      ]}
      summary={t('dashboard.chart.summary', {
        value: formatMoney(total),
        best: best === null ? '—' : `${best.day} (${formatMoney(best.revenueTtc)})`,
      })}
      formatValue={formatMoney}
      formatLabel={(day) => day.slice(8, 10) + '/' + day.slice(5, 7)}
    />
  );
}

function FamiliesChart({ data }: { data: Dashboard['families'] }) {
  const t = useT();
  if (data.length === 0)
    return <p className="text-muted-foreground text-sm">{t('dashboard.chart.noData')}</p>;
  return (
    <SimpleChart
      type="bar"
      data={data}
      labelKey="name"
      series={[{ key: 'revenueTtc', label: t('dashboard.series.revenue') }]}
      summary={data.map((row) => `${row.name} : ${formatMoney(row.revenueTtc)}`).join(' ; ')}
      formatValue={formatMoney}
    />
  );
}

function LatestSales({ sales }: { sales: Dashboard['latestSales'] }) {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const canOpen = useCan('sale.view');
  if (sales.length === 0)
    return <p className="text-muted-foreground text-sm">{t('dashboard.noSales')}</p>;
  return (
    <ul className="divide-border flex flex-col divide-y">
      {sales.map((sale) => (
        <li key={sale.saleId} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="flex flex-col">
            {canOpen ? (
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => navigate('sales.detail', { saleId: sale.saleId })}
              >
                {sale.invoiceNumber}
              </button>
            ) : (
              <span className="font-medium">{sale.invoiceNumber}</span>
            )}
            <span className="text-muted-foreground">
              {sale.customerName ?? t('dashboard.walkIn')} · {formatDateTime(sale.completedAt)}
            </span>
          </span>
          <span className="tabular font-semibold">{formatMoney(sale.total)}</span>
        </li>
      ))}
    </ul>
  );
}

function LatestMovements({ movements }: { movements: NonNullable<Dashboard['latestMovements']> }) {
  const t = useT();
  if (movements.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('dashboard.noMovements')}</p>;
  }
  return (
    <ul className="divide-border flex flex-col divide-y">
      {movements.map((movement) => (
        <li key={movement.id} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className="flex flex-col">
            <span className="font-medium">{movement.productName}</span>
            <span className="text-muted-foreground">
              {t(`movement.${movement.movementType}`)} · {movement.locationName} ·{' '}
              {formatDateTime(movement.createdAt)}
            </span>
          </span>
          <span
            className={cn(
              'tabular font-semibold',
              movement.quantity < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {movement.quantity > 0 ? `+${String(movement.quantity)}` : String(movement.quantity)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Shortcuts() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const canSell = useCan('pos.use');
  const canAdjust = useCan('stock.adjust');
  const canSuppliers = useCan('supplier.manage');
  const canCost = useCan('cost.view');
  const canReceive = canAdjust && canSuppliers && canCost;
  const canReport = useCan('report.view');
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {canSell && (
        <Button onClick={() => navigate('pos')}>
          <ShoppingCart aria-hidden="true" />
          {t('dashboard.newSale')}
        </Button>
      )}
      {canReceive && (
        <Button variant="secondary" onClick={() => navigate('stock.receipt')}>
          <PackagePlus aria-hidden="true" />
          {t('dashboard.newReceipt')}
        </Button>
      )}
      {canReport && (
        <Button variant="secondary" onClick={() => navigate('reports')}>
          <ChartColumn aria-hidden="true" />
          {t('dashboard.openReports')}
        </Button>
      )}
    </div>
  );
}

/** Tableau de bord (4.8, A.4) : écran d'accueil. */
export function DashboardPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const canInstallments = useCan('customer.manage');
  const canWarranty = useCan('warranty.manage');
  const loader = useCallback(() => invoke('dashboard:get'), []);
  const { state, reload } = useRemote<Dashboard>(loader);
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={<Shortcuts />}
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={6} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('dashboard.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <div className="flex flex-col gap-4">
          <section aria-label={t('dashboard.title')} className="grid gap-4 md:grid-cols-3">
            <PeriodCard title={t('dashboard.today')} totals={state.data.today} />
            <PeriodCard title={t('dashboard.week')} totals={state.data.week} />
            <PeriodCard title={t('dashboard.month')} totals={state.data.month} />
          </section>
          <section className="grid gap-4 md:grid-cols-3">
            {state.data.lowStock !== null && (
              <AlertTile
                icon={AlertTriangle}
                label={t('dashboard.lowStock')}
                value={state.data.lowStock}
                onOpen={() => navigate('stock', { lowStock: true })}
              />
            )}
            <AlertTile
              icon={CalendarClock}
              label={t('dashboard.overdue')}
              value={state.data.overdueInstallments}
              onOpen={canInstallments ? () => navigate('installments') : null}
            />
            <AlertTile
              icon={ShieldCheck}
              label={t('dashboard.claims')}
              value={state.data.openClaims}
              onOpen={canWarranty ? () => navigate('warranty') : null}
            />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.chart.days')}</CardTitle>
              </CardHeader>
              <CardContent>
                <DaysChart data={state.data.days} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.chart.families')}</CardTitle>
              </CardHeader>
              <CardContent>
                <FamiliesChart data={state.data.families} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.latestSales')}</CardTitle>
              </CardHeader>
              <CardContent>
                <LatestSales sales={state.data.latestSales} />
              </CardContent>
            </Card>
            {state.data.latestMovements !== null && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.latestMovements')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <LatestMovements movements={state.data.latestMovements} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
