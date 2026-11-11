import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, MapPin, PackageMinus, PackagePlus, Warehouse } from 'lucide-react';
import type { Location, Movement, MovementType, StockRow, Valuation } from '@shared/schemas/stock';
import { formatDateTime } from '@shared/format/date';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { CheckboxField, SelectField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/radix';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote, type RemoteState } from '../../lib/use-remote';
import { useRouter } from '../../stores/router';
import { useCan } from '../products/catalog-ui';
import { MovementDialog } from './MovementDialog';
import { movementOptions, useLocations } from './stock-ui';

const PAGE_SIZE = 50;
const ALL = 'all';

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <ErrorState
      title={t('stock.error')}
      message={message}
      solution={t('state.preferences.solution')}
      retryLabel={t('state.error.retry')}
      onRetry={onRetry}
    />
  );
}

function LevelsTab({
  locations,
  initialLowStock,
  version,
}: {
  locations: readonly Location[];
  initialLowStock: boolean;
  version: number;
}) {
  const t = useT();
  const showCost = useCan('cost.view');
  const navigate = useRouter((state) => state.navigate);
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState(ALL);
  const [lowStock, setLowStock] = useState(initialLowStock);
  const [page, setPage] = useState(0);
  const [state, setState] = useState<RemoteState<{ total: number; rows: StockRow[] }>>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        invoke('stock:overview', {
          ...(query.trim() === '' ? {} : { query: query.trim() }),
          ...(locationId === ALL ? {} : { locationId: Number(locationId) }),
          ...(lowStock ? { lowStock: true } : {}),
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        }).then(
          (data) => {
            if (active) setState({ status: 'ready', data });
          },
          (error: unknown) => {
            if (active) setState({ status: 'error', message: errorMessage(error) });
          },
        );
      },
      query === '' ? 0 : 150,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, locationId, lowStock, page, attempt, version]);

  const columns = locations.filter((location) => location.isActive || location.units > 0);
  const pages = state.status === 'ready' ? Math.max(1, Math.ceil(state.data.total / PAGE_SIZE)) : 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[2fr_1fr_auto] items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="stock-search">{t('stock.search')}</Label>
          <Input
            id="stock-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <SelectField
          label={t('stock.filter.location')}
          value={locationId}
          options={[
            { value: ALL, label: t('stock.filter.allLocations') },
            ...locations.map((location) => ({ value: String(location.id), label: location.name })),
          ]}
          onValueChange={(value) => {
            setLocationId(value);
            setPage(0);
          }}
        />
        <CheckboxField
          label={t('stock.filter.lowStock')}
          className="h-10"
          checked={lowStock}
          onChange={(event) => {
            setLowStock(event.target.checked);
            setPage(0);
          }}
        />
      </div>
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={5} />}
      {state.status === 'error' && (
        <ErrorBlock message={state.message} onRetry={() => setAttempt((value) => value + 1)} />
      )}
      {state.status === 'ready' &&
        state.data.total === 0 &&
        (query === '' && locationId === ALL && !lowStock ? (
          <EmptyState
            icon={Warehouse}
            title={t('stock.empty.title')}
            description={t('stock.empty.description')}
          />
        ) : (
          <p className="text-muted-foreground py-6 text-sm">{t('stock.noMatch')}</p>
        ))}
      {state.status === 'ready' && state.data.total > 0 && (
        <>
          <p className="text-muted-foreground text-sm" role="status">
            {t('stock.count', { count: state.data.total })}
          </p>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('stock.col.product')}
                  </th>
                  {columns.map((location) => (
                    <th key={location.id} scope="col" className="px-4 py-3 text-right font-medium">
                      {location.name}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('stock.col.total')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('stock.col.threshold')}
                  </th>
                  {showCost && (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      {t('stock.col.avgCost')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row) => {
                  const low = row.reorderLevel > 0 && row.total <= row.reorderLevel;
                  return (
                    <tr key={row.variantId} className="border-border border-t">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="block text-left font-medium hover:underline"
                          onClick={() => navigate('products.detail', { productId: row.productId })}
                          aria-label={t('products.open', { name: row.name })}
                        >
                          {row.name}
                        </button>
                        <span className="text-muted-foreground block">
                          {[row.variantLabel, row.sku].filter((part) => part !== '').join(' · ')}
                        </span>
                      </td>
                      {columns.map((location) => (
                        <td key={location.id} className="tabular px-4 py-3 text-right">
                          {row.quantities.find((level) => level.locationId === location.id)
                            ?.quantity ?? 0}
                        </td>
                      ))}
                      <td className="tabular px-4 py-3 text-right font-semibold">
                        <span className="inline-flex items-center gap-2">
                          {low && <Badge tone="warning">{t('stock.lowStock')}</Badge>}
                          {row.total}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-right">{row.reorderLevel}</td>
                      {showCost && (
                        <td className="px-4 py-3 text-right">
                          <Money amount={row.avgCost ?? 0} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3">
              <span className="text-muted-foreground text-sm">
                {t('stock.page', { page: page + 1, pages })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t('stock.previous')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t('stock.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MovementsTab({ locations, version }: { locations: readonly Location[]; version: number }) {
  const t = useT();
  const showCost = useCan('cost.view');
  const [type, setType] = useState(ALL);
  const [locationId, setLocationId] = useState(ALL);
  const [items, setItems] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const filters = useCallback(
    (beforeId?: number) => ({
      ...(type === ALL ? {} : { type: type as MovementType }),
      ...(locationId === ALL ? {} : { locationId: Number(locationId) }),
      ...(beforeId === undefined ? {} : { beforeId }),
      limit: PAGE_SIZE,
    }),
    [type, locationId],
  );

  useEffect(() => {
    let active = true;
    invoke('stock:movements', filters()).then(
      (rows) => {
        if (!active) return;
        setItems(rows);
        setMore(rows.length === PAGE_SIZE);
        setError(null);
      },
      (failure: unknown) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [filters, attempt, version]);

  const loadMore = async (): Promise<void> => {
    const last = items?.at(-1);
    if (last === undefined) return;
    try {
      const rows = await invoke('stock:movements', filters(last.id));
      setItems((current) => [...(current ?? []), ...rows]);
      setMore(rows.length === PAGE_SIZE);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t('stock.filter.type')}
          value={type}
          options={[{ value: ALL, label: t('stock.filter.allTypes') }, ...movementOptions(t)]}
          onValueChange={setType}
        />
        <SelectField
          label={t('stock.filter.location')}
          value={locationId}
          options={[
            { value: ALL, label: t('stock.filter.allLocations') },
            ...locations.map((location) => ({ value: String(location.id), label: location.name })),
          ]}
          onValueChange={setLocationId}
        />
      </div>
      {error !== null && (
        <ErrorBlock message={error} onRetry={() => setAttempt((value) => value + 1)} />
      )}
      {error === null && items === null && <LoadingState label={t('state.loading')} rows={5} />}
      {items !== null && items.length === 0 && (
        <p className="text-muted-foreground py-6 text-sm">{t('stock.movements.empty')}</p>
      )}
      {items !== null && items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.product')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.type')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('stock.col.quantity')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('stock.col.after')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.location')}
                </th>
                {showCost && (
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('stock.col.unitCost')}
                  </th>
                )}
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.reason')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('stock.col.user')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((movement) => (
                <tr key={movement.id} className="border-border border-t">
                  <td className="tabular px-4 py-3 whitespace-nowrap">
                    {formatDateTime(movement.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{movement.productName}</span>
                    <span className="text-muted-foreground block">
                      {[movement.variantLabel, movement.sku]
                        .filter((part) => part !== '')
                        .join(' · ')}
                      {movement.serialNumber === null
                        ? ''
                        : ` · ${t('stock.serial', { serial: movement.serialNumber })}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">{t(`movement.${movement.type}`)}</td>
                  <td
                    className={`tabular px-4 py-3 text-right font-semibold ${movement.quantityDelta < 0 ? 'text-danger' : 'text-success'}`}
                  >
                    {movement.quantityDelta > 0
                      ? `+${String(movement.quantityDelta)}`
                      : String(movement.quantityDelta)}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{movement.quantityAfter}</td>
                  <td className="px-4 py-3">{movement.locationName}</td>
                  {showCost && (
                    <td className="px-4 py-3 text-right">
                      <Money amount={movement.unitCost ?? 0} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {[movement.reference, movement.reason]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </td>
                  <td className="px-4 py-3">{movement.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {more && (
        <Button variant="secondary" className="self-center" onClick={() => void loadMore()}>
          {t('stock.loadMore')}
        </Button>
      )}
    </div>
  );
}

function ValuationTab({ version }: { version: number }) {
  const t = useT();
  const loader = useCallback(() => invoke('stock:valuation'), []);
  const { state, reload } = useRemote<Valuation>(loader);
  useEffect(() => {
    if (version > 0) reload();
  }, [version, reload]);
  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={3} />;
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={reload} />;
  const valuation = state.data;
  const showCost = valuation.totalCost !== null;
  const table = (
    title: string,
    rows: { key: number; name: string; units: number; cost: number | null; sale: number }[],
  ) => (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('stock.valuation.name')}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {t('stock.valuation.units')}
            </th>
            {showCost && (
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('stock.valuation.cost')}
              </th>
            )}
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {t('stock.valuation.sale')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-border border-t">
              <td className="px-4 py-3 font-medium">{row.name}</td>
              <td className="tabular px-4 py-3 text-right">{row.units}</td>
              {showCost && (
                <td className="px-4 py-3 text-right">
                  <Money amount={row.cost ?? 0} />
                </td>
              )}
              <td className="px-4 py-3 text-right">
                <Money amount={row.sale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-6">
            <span className="text-muted-foreground text-sm">{t('stock.valuation.units')}</span>
            <span className="tabular text-3xl font-semibold">{valuation.units}</span>
          </CardContent>
        </Card>
        {showCost && (
          <Card>
            <CardContent className="flex flex-col gap-1 pt-6">
              <span className="text-muted-foreground text-sm">{t('stock.valuation.cost')}</span>
              <Money amount={valuation.totalCost ?? 0} className="text-3xl font-semibold" />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex flex-col gap-1 pt-6">
            <span className="text-muted-foreground text-sm">{t('stock.valuation.sale')}</span>
            <Money amount={valuation.totalSale} className="text-3xl font-semibold" />
          </CardContent>
        </Card>
      </div>
      {table(
        t('stock.valuation.byLocation'),
        valuation.byLocation.map((row) => ({
          key: row.locationId,
          name: row.name,
          units: row.units,
          cost: row.cost,
          sale: row.sale,
        })),
      )}
      {table(
        t('stock.valuation.byFamily'),
        valuation.byFamily.map((row) => ({
          key: row.familyId,
          name: row.name,
          units: row.units,
          cost: row.cost,
          sale: row.sale,
        })),
      )}
    </div>
  );
}

/** Stock (A.4) : vue par emplacement, historique, valorisation ; entrées, sorties et transferts. */
export function StockPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const lowStock = useRouter((state) => state.params.lowStock === true);
  const canAdjust = useCan('stock.adjust');
  const canManageSuppliers = useCan('supplier.manage');
  const canSeeCost = useCan('cost.view');
  const canReceive = canAdjust && canManageSuppliers && canSeeCost;
  const { state, reload } = useLocations();
  const [dialog, setDialog] = useState<'exit' | 'transfer' | null>(null);
  const [version, setVersion] = useState(0);

  return (
    <>
      <PageHeader
        title={t('stock.title')}
        description={t('stock.description')}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {canReceive && (
              <Button onClick={() => navigate('stock.receipt')}>
                <PackagePlus aria-hidden="true" />
                {t('stock.receive')}
              </Button>
            )}
            {canAdjust && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setDialog('exit')}
                  disabled={state.status !== 'ready'}
                >
                  <PackageMinus aria-hidden="true" />
                  {t('stock.exit')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setDialog('transfer')}
                  disabled={state.status !== 'ready'}
                >
                  <ArrowLeftRight aria-hidden="true" />
                  {t('stock.transfer')}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => navigate('stock.locations')}>
              <MapPin aria-hidden="true" />
              {t('stock.manageLocations')}
            </Button>
          </div>
        }
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={5} />}
      {state.status === 'error' && <ErrorBlock message={state.message} onRetry={reload} />}
      {state.status === 'ready' && (
        <Tabs defaultValue="levels" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="levels">{t('stock.tab.levels')}</TabsTrigger>
            <TabsTrigger value="movements">{t('stock.tab.movements')}</TabsTrigger>
            <TabsTrigger value="valuation">{t('stock.tab.valuation')}</TabsTrigger>
          </TabsList>
          <TabsContent value="levels">
            <LevelsTab locations={state.data} initialLowStock={lowStock} version={version} />
          </TabsContent>
          <TabsContent value="movements">
            <MovementsTab locations={state.data} version={version} />
          </TabsContent>
          <TabsContent value="valuation">
            <ValuationTab version={version} />
          </TabsContent>
        </Tabs>
      )}
      {dialog !== null && state.status === 'ready' && (
        <MovementDialog
          mode={{ kind: dialog }}
          locations={state.data}
          onOpenChange={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setVersion((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
