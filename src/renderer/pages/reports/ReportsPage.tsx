import { useCallback, useState } from 'react';
import { ChartColumn, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import {
  ADMIN_REPORTS,
  MOVEMENT_TYPES,
  PERIOD_REPORTS,
  PRODUCT_ORDERS,
  REPORT_KINDS,
  SALES_GROUPS,
  STOCK_GROUPS,
  type ReportKind,
  type ReportRequest,
  type ReportResult,
} from '@shared/schemas/reports';
import { SimpleChart } from '../../components/charts/charts';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, Input, Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { SelectField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useCan } from '../products/catalog-ui';
import {
  PRESETS,
  cellText,
  columnLabel,
  isNumeric,
  presetPeriod,
  summaryLabel,
  type Preset,
} from './report-format';

const PAGE_SIZE = 100;
const ALL = 'all';

interface Filters {
  kind: ReportKind;
  preset: Preset;
  from: string;
  to: string;
  salesGroup: (typeof SALES_GROUPS)[number];
  stockGroup: (typeof STOCK_GROUPS)[number];
  order: (typeof PRODUCT_ORDERS)[number];
  movementType: (typeof MOVEMENT_TYPES)[number] | typeof ALL;
}

/** Demande envoyée au service, ou null si la période saisie est incohérente. */
function toRequest(filters: Filters): ReportRequest | null {
  const period = { from: filters.from, to: filters.to };
  if (
    PERIOD_REPORTS.includes(filters.kind) &&
    (period.from === '' || period.to === '' || period.from > period.to)
  ) {
    return null;
  }
  switch (filters.kind) {
    case 'sales':
      return { kind: 'sales', period, groupBy: filters.salesGroup };
    case 'products':
      return { kind: 'products', period, order: filters.order };
    case 'stock':
      return { kind: 'stock', groupBy: filters.stockGroup };
    case 'movements':
      return {
        kind: 'movements',
        period,
        movementType: filters.movementType === ALL ? null : filters.movementType,
      };
    case 'cash':
      return { kind: 'cash', period };
    case 'balances':
      return { kind: 'balances' };
    case 'followups':
      return { kind: 'followups' };
    case 'sensitive':
      return { kind: 'sensitive', period };
  }
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const t = useT();
  const canAudit = useCan('audit.view');
  const kinds = REPORT_KINDS.filter((kind) => canAudit || !ADMIN_REPORTS.includes(kind));
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const withPeriod = PERIOD_REPORTS.includes(filters.kind);
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-4">
        <SelectField
          label={t('reports.kind')}
          value={filters.kind}
          options={kinds.map((kind) => ({ value: kind, label: t(`reports.kind.${kind}`) }))}
          onValueChange={(value) => set({ kind: value as ReportKind })}
        />
        {filters.kind === 'sales' && (
          <SelectField
            label={t('reports.groupBy')}
            value={filters.salesGroup}
            options={SALES_GROUPS.map((group) => ({
              value: group,
              label: t(`reports.group.${group}`),
            }))}
            onValueChange={(value) => set({ salesGroup: value as Filters['salesGroup'] })}
          />
        )}
        {filters.kind === 'stock' && (
          <SelectField
            label={t('reports.groupBy')}
            value={filters.stockGroup}
            options={STOCK_GROUPS.map((group) => ({
              value: group,
              label: t(`reports.group.${group}`),
            }))}
            onValueChange={(value) => set({ stockGroup: value as Filters['stockGroup'] })}
          />
        )}
        {filters.kind === 'products' && (
          <SelectField
            label={t('reports.order')}
            value={filters.order}
            options={PRODUCT_ORDERS.map((order) => ({
              value: order,
              label: t(`reports.order.${order}`),
            }))}
            onValueChange={(value) => set({ order: value as Filters['order'] })}
          />
        )}
        {filters.kind === 'movements' && (
          <SelectField
            label={t('reports.movementType')}
            value={filters.movementType}
            options={[
              { value: ALL, label: t('reports.movementType.all') },
              ...MOVEMENT_TYPES.map((type) => ({ value: type, label: t(`movement.${type}`) })),
            ]}
            onValueChange={(value) => set({ movementType: value as Filters['movementType'] })}
          />
        )}
        {withPeriod && (
          <>
            <SelectField
              label={t('reports.preset')}
              value={filters.preset}
              options={PRESETS.map((preset) => ({
                value: preset,
                label: t(`reports.preset.${preset}`),
              }))}
              onValueChange={(value) => {
                const preset = value as Preset;
                set(preset === 'custom' ? { preset } : { preset, ...presetPeriod(preset) });
              }}
            />
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="report-from">{t('reports.from')}</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={filters.from}
                  max={filters.to}
                  onChange={(event) => set({ preset: 'custom', from: event.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="report-to">{t('reports.to')}</Label>
                <Input
                  id="report-to"
                  type="date"
                  value={filters.to}
                  min={filters.from}
                  onChange={(event) => set({ preset: 'custom', to: event.target.value })}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReportChart({ result }: { result: ReportResult }) {
  const t = useT();
  const chart = result.chart;
  if (chart === null || result.rows.length === 0 || chart.series.length === 0) return null;
  const rows = chart.type === 'bar' ? result.rows.slice(0, 15) : result.rows;
  const labelColumn = result.columns.find((column) => column.key === chart.labelKey);
  const series = chart.series.map((key) => {
    const column = result.columns.find((candidate) => candidate.key === key);
    return { key, label: column === undefined ? key : columnLabel(t, column) };
  });
  const first = series[0];
  const moneySeries = result.columns.find((column) => column.key === first?.key)?.type === 'money';
  const format = (value: number) =>
    cellText(
      t,
      { key: '', type: moneySeries ? 'money' : 'int', sensitive: false, enumKey: null },
      value,
    );
  const summary = rows
    .slice(0, 10)
    .map(
      (row) =>
        `${labelColumn === undefined ? '' : cellText(t, labelColumn, row[chart.labelKey])} : ${format(Number(row[first?.key ?? ''] ?? 0))}`,
    )
    .join(' ; ');
  return (
    <Card>
      <CardContent className="pt-6">
        <SimpleChart
          type={chart.type === 'line' && rows.length < 2 ? 'bar' : chart.type}
          data={rows}
          labelKey={chart.labelKey}
          series={series}
          summary={`${t('reports.chart')} : ${summary}`}
          formatValue={format}
          formatLabel={(label) =>
            labelColumn === undefined ? label : cellText(t, labelColumn, label)
          }
        />
      </CardContent>
    </Card>
  );
}

function ReportTable({ result, t }: { result: ReportResult; t: Translate }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const rows = result.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('reports.table')}>
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {result.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-4 py-3 font-medium whitespace-nowrap ${isNumeric(column) ? 'text-right' : ''}`}
                >
                  {columnLabel(t, column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={page * PAGE_SIZE + index} className="border-border border-t">
                {result.columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-2 ${isNumeric(column) ? 'tabular text-right whitespace-nowrap' : ''}`}
                  >
                    {cellText(t, column, row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result.totals !== null && (
            <tfoot className="border-border bg-muted border-t font-semibold">
              <tr>
                {result.columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 ${isNumeric(column) ? 'tabular text-right whitespace-nowrap' : ''}`}
                  >
                    {index === 0
                      ? t('reports.total')
                      : result.totals?.[column.key] === undefined
                        ? ''
                        : cellText(t, column, result.totals[column.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pages > 1 && (
        <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-2 text-sm">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('stock.previous')}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="tabular">{t('stock.page', { page: page + 1, pages })}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('stock.next')}
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </Card>
  );
}

function ExportButtons({ request }: { request: ReportRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (format: 'pdf' | 'xlsx' | 'csv'): Promise<void> => {
    setBusy(true);
    try {
      if ((await invoke('reports:export', { request, format })).saved)
        toast.success(t('reports.exported'));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
    setBusy(false);
  };
  const formats = [
    ['pdf', t('reports.exportPdf')],
    ['xlsx', t('reports.exportXlsx')],
    ['csv', t('reports.exportCsv')],
  ] as const;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {formats.map(([format, label]) => (
        <Button
          key={format}
          variant="secondary"
          disabled={busy}
          aria-label={t('reports.exportLabel', { format: label })}
          onClick={() => void run(format)}
        >
          <FileDown aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  );
}

function ReportView({ request }: { request: ReportRequest }) {
  const t = useT();
  const canExport = useCan('export.run');
  const loader = useCallback(() => invoke('reports:run', request), [request]);
  const { state, reload } = useRemote<ReportResult>(loader);
  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('reports.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  const result = state.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <dl className="flex flex-wrap gap-6">
          {result.summary.map((item) => (
            <div key={item.key} className="flex flex-col">
              <dt className="text-muted-foreground text-sm">{summaryLabel(t, item.key)}</dt>
              <dd className="tabular text-xl font-semibold">
                {cellText(
                  t,
                  { key: item.key, type: item.type, sensitive: false, enumKey: null },
                  item.value,
                )}
              </dd>
            </div>
          ))}
        </dl>
        {canExport && <ExportButtons request={request} />}
      </div>
      {result.rows.length === 0 ? (
        <EmptyState
          icon={ChartColumn}
          title={t('reports.empty.title')}
          description={t('reports.empty.description')}
        />
      ) : (
        <>
          <ReportChart result={result} />
          {result.truncated && (
            <p
              role="status"
              className="text-warning-soft-foreground bg-warning-soft rounded-md px-4 py-2 text-sm"
            >
              {t('reports.truncated', { count: result.rows.length })}
            </p>
          )}
          <ReportTable result={result} t={t} />
        </>
      )}
    </div>
  );
}

/** Rapports (4.8, 4.12, A.4) : choix de période, graphique, tableau, export PDF, Excel et CSV. */
export function ReportsPage() {
  const t = useT();
  const [filters, setFilters] = useState<Filters>(() => ({
    kind: 'sales',
    preset: 'month',
    ...presetPeriod('month'),
    salesGroup: 'day',
    stockGroup: 'family',
    order: 'best',
    movementType: ALL,
  }));
  const request = toRequest(filters);
  const requestKey = JSON.stringify(request);
  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <FilterBar filters={filters} onChange={setFilters} />
      {request === null ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {t('reports.invalidPeriod')}
        </p>
      ) : (
        <StableReport key={requestKey} request={request} />
      )}
    </>
  );
}

/** La demande est figée pour la durée de vie du composant (clé = demande). */
function StableReport({ request }: { request: ReportRequest }) {
  const [stable] = useState(request);
  return <ReportView request={stable} />;
}
