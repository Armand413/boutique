import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Download,
  FolderTree,
  MoreHorizontal,
  PackagePlus,
  PackageSearch,
  Tags,
  Upload,
} from 'lucide-react';
import { effectiveAttributes } from '@shared/catalog/tree';
import {
  PRODUCT_SORTS,
  type AttributeFilter,
  type CatalogReferences,
  type ProductRow,
  type ProductSearchInput,
} from '@shared/schemas/catalog';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, Input, Skeleton } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { CheckboxField, SelectField, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRouter } from '../../stores/router';
import { categoryOptions, useCan, useCatalogReferences } from './catalog-ui';
import { ImportDialog } from './ImportDialog';
import { ProductFormDialog } from './ProductFormDialog';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 64;
const ALL = 'all';

type Sort = (typeof PRODUCT_SORTS)[number];

interface AttributeFilterText {
  min: string;
  max: string;
  equals: string;
}

interface Filters {
  query: string;
  categoryId: string;
  brandId: string;
  status: ProductSearchInput['status'];
  lowStock: boolean;
  sort: Sort;
  attributes: Record<string, AttributeFilterText>;
}

const INITIAL_FILTERS: Filters = {
  query: '',
  categoryId: ALL,
  brandId: ALL,
  status: 'active',
  lowStock: false,
  sort: 'name',
  attributes: {},
};

function hasFilters(filters: Filters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.categoryId !== ALL ||
    filters.brandId !== ALL ||
    filters.status !== 'active' ||
    filters.lowStock ||
    Object.keys(filters.attributes).length > 0
  );
}

function attributeFilters(filters: Filters): AttributeFilter[] {
  return Object.entries(filters.attributes).flatMap(([id, text]) => {
    const filter: AttributeFilter = { attributeId: Number(id) };
    const min = Number(text.min.replace(',', '.'));
    const max = Number(text.max.replace(',', '.'));
    if (text.min.trim() !== '' && Number.isFinite(min)) filter.min = min;
    if (text.max.trim() !== '' && Number.isFinite(max)) filter.max = max;
    if (text.equals === 'yes' || text.equals === 'no') filter.equals = text.equals === 'yes';
    else if (text.equals.trim() !== '') filter.equals = text.equals.trim();
    return Object.keys(filter).length > 1 ? [filter] : [];
  });
}

function searchInput(filters: Filters, offset: number): ProductSearchInput {
  const query = filters.query.trim();
  const attributes = attributeFilters(filters);
  return {
    ...(query === '' ? {} : { query }),
    ...(filters.categoryId === ALL ? {} : { categoryId: Number(filters.categoryId) }),
    ...(filters.brandId === ALL ? {} : { brandId: Number(filters.brandId) }),
    status: filters.status,
    ...(filters.lowStock ? { lowStock: true } : {}),
    ...(attributes.length === 0 ? {} : { attributeFilters: attributes }),
    sort: filters.sort,
    offset,
    limit: PAGE_SIZE,
  };
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; total: number; pages: ReadonlyMap<number, ProductRow[]> };

/** Pages de résultats chargées à la demande (recherche et pagination côté base, 5.1). */
function useProductPages(filters: Filters) {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const generation = useRef(0);
  const requested = useRef(new Set<number>());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    requested.current = new Set([0]);
    const timer = window.setTimeout(
      () => {
        invoke('products:search', searchInput(filters, 0)).then(
          (result) => {
            if (generation.current === current) {
              setState({
                status: 'ready',
                total: result.total,
                pages: new Map([[0, result.rows]]),
              });
            }
          },
          (error: unknown) => {
            if (generation.current === current)
              setState({ status: 'error', message: errorMessage(error) });
          },
        );
      },
      filters.query === '' ? 0 : 150,
    );
    return () => window.clearTimeout(timer);
  }, [filters, attempt]);

  const ensurePage = useCallback(
    (page: number) => {
      if (requested.current.has(page)) return;
      requested.current.add(page);
      const current = generation.current;
      invoke('products:search', searchInput(filters, page * PAGE_SIZE)).then(
        (result) => {
          if (generation.current !== current) return;
          setState((previous) =>
            previous.status !== 'ready'
              ? previous
              : { ...previous, pages: new Map(previous.pages).set(page, result.rows) },
          );
        },
        (error: unknown) => {
          requested.current.delete(page);
          toast.error(errorMessage(error));
        },
      );
    },
    [filters],
  );

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);
  return { state, ensurePage, reload };
}

const column = createColumnHelper<ProductRow | null>();

function buildColumns(t: Translate, showCost: boolean, open: (row: ProductRow) => void) {
  const placeholder = <Skeleton className="h-5 w-24" />;
  return [
    column.display({
      id: 'product',
      header: t('products.col.product'),
      cell: ({ row }) => {
        const item = row.original;
        if (item === null) return <Skeleton className="h-5 w-56" />;
        const detail = [item.brandName, item.variantLabel]
          .filter((part) => part !== null && part !== '')
          .join(' · ');
        return (
          <div className="flex min-w-0 flex-col">
            <button
              type="button"
              onClick={() => open(item)}
              aria-label={t('products.open', { name: item.name })}
              className="truncate text-left text-base font-medium hover:underline"
            >
              {item.name}
            </button>
            <span className="text-muted-foreground truncate text-sm">
              {detail === '' ? t(`type.${item.productType}`) : detail}
            </span>
          </div>
        );
      },
    }),
    column.display({
      id: 'reference',
      header: t('products.col.reference'),
      cell: ({ row }) =>
        row.original === null ? (
          placeholder
        ) : (
          <div className="flex flex-col font-mono text-sm">
            <span>{row.original.sku}</span>
            {row.original.barcode !== null && (
              <span className="text-muted-foreground">{row.original.barcode}</span>
            )}
          </div>
        ),
    }),
    column.display({
      id: 'category',
      header: t('products.col.category'),
      cell: ({ row }) =>
        row.original === null ? (
          placeholder
        ) : (
          <span className="text-sm">
            {row.original.familyName === row.original.categoryName
              ? row.original.familyName
              : `${row.original.familyName} › ${row.original.categoryName}`}
          </span>
        ),
    }),
    column.display({
      id: 'price',
      header: t('products.col.price'),
      cell: ({ row }) =>
        row.original === null ? placeholder : <Money amount={row.original.salePrice} />,
    }),
    ...(showCost
      ? [
          column.display({
            id: 'cost',
            header: t('products.col.cost'),
            cell: ({ row }) =>
              row.original === null ? (
                placeholder
              ) : (
                <Money amount={row.original.costPrice ?? 0} className="text-muted-foreground" />
              ),
          }),
        ]
      : []),
    column.display({
      id: 'stock',
      header: t('products.col.stock'),
      cell: ({ row }) => {
        const item = row.original;
        if (item === null) return placeholder;
        if (!item.isStocked)
          return <span className="text-muted-foreground text-sm">{t('products.noStock')}</span>;
        const low = item.reorderLevel > 0 && item.stock <= item.reorderLevel;
        return (
          <span className="flex items-center gap-2">
            <span className="tabular font-medium">{item.stock}</span>
            {low && <Badge tone="warning">{t('products.lowStock')}</Badge>}
            {!item.isActive && <Badge>{t('common.archived')}</Badge>}
          </span>
        );
      },
    }),
  ];
}

function AttributeFilterFields({
  references,
  filters,
  onChange,
}: {
  references: CatalogReferences;
  filters: Filters;
  onChange: (attributes: Filters['attributes']) => void;
}) {
  const t = useT();
  if (filters.categoryId === ALL) return null;
  const filterable = effectiveAttributes(
    references.categories,
    references.attributes,
    Number(filters.categoryId),
  ).filter((attribute) => attribute.isFilterable);
  if (filterable.length === 0) return null;
  const set = (id: number, patch: Partial<AttributeFilterText>): void => {
    const current = filters.attributes[String(id)] ?? { min: '', max: '', equals: '' };
    const next = { ...current, ...patch };
    const empty = next.min === '' && next.max === '' && next.equals === '';
    const others = Object.entries(filters.attributes).filter(([key]) => key !== String(id));
    onChange(Object.fromEntries(empty ? others : [...others, [String(id), next]]));
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">{t('products.filter.attributes')}</legend>
      <div className="grid grid-cols-4 gap-4">
        {filterable.map((attribute) => {
          const value = filters.attributes[String(attribute.id)] ?? {
            min: '',
            max: '',
            equals: '',
          };
          const label =
            attribute.unit === null ? attribute.label : `${attribute.label} (${attribute.unit})`;
          if (attribute.valueType === 'number') {
            return (
              <div key={attribute.id} className="col-span-2 grid grid-cols-2 gap-2">
                <TextField
                  label={t('products.filter.min', { label })}
                  inputMode="decimal"
                  value={value.min}
                  onChange={(event) => set(attribute.id, { min: event.target.value })}
                />
                <TextField
                  label={t('products.filter.max', { label })}
                  inputMode="decimal"
                  value={value.max}
                  onChange={(event) => set(attribute.id, { max: event.target.value })}
                />
              </div>
            );
          }
          if (attribute.valueType === 'text') {
            return (
              <TextField
                key={attribute.id}
                label={label}
                value={value.equals}
                onChange={(event) => set(attribute.id, { equals: event.target.value })}
              />
            );
          }
          const options =
            attribute.valueType === 'boolean'
              ? [
                  { value: 'yes', label: t('common.yes') },
                  { value: 'no', label: t('common.no') },
                ]
              : (attribute.choices ?? []).map((choice) => ({ value: choice, label: choice }));
          return (
            <SelectField
              key={attribute.id}
              label={label}
              value={value.equals === '' ? ALL : value.equals}
              options={[{ value: ALL, label: t('common.all') }, ...options]}
              onValueChange={(next) => set(attribute.id, { equals: next === ALL ? '' : next })}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function ProductTable({
  rows,
  total,
  showCost,
  ensurePage,
  open,
}: {
  rows: (ProductRow | null)[];
  total: number;
  showCost: boolean;
  ensurePage: (page: number) => void;
  open: (row: ProductRow) => void;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => buildColumns(t, showCost, open), [t, showCost, open]);
  // Avertissement du compilateur React : TanStack Table renvoie des fonctions non mémoïsables, ce
  // composant n'est donc pas optimisé par le compilateur (comportement documenté, voir D41).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => {
    for (let page = Math.floor(first / PAGE_SIZE); page <= Math.floor(last / PAGE_SIZE); page += 1)
      ensurePage(page);
  }, [first, last, ensurePage]);
  const tableRows = table.getRowModel().rows;
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const columnCount = columns.length;

  return (
    <Card className="overflow-hidden">
      <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto" tabIndex={-1}>
        <table className="w-full table-fixed text-left text-sm" aria-rowcount={total + 1}>
          <thead className="bg-muted text-muted-foreground sticky top-0 z-10">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} aria-rowindex={1}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={
                      header.id === 'product'
                        ? 'w-[34%] px-4 py-3 font-medium'
                        : 'px-4 py-3 font-medium'
                    }
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: paddingTop }} />
              </tr>
            )}
            {items.map((item) => {
              const row = tableRows[item.index];
              if (row === undefined) return null;
              return (
                <tr
                  key={item.key}
                  aria-rowindex={item.index + 2}
                  className="border-border border-t"
                  style={{ height: ROW_HEIGHT }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ListBody({
  filters,
  setFilters,
  onCreate,
  onImport,
}: {
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onCreate: (() => void) | null;
  onImport: (() => void) | null;
}) {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const showCost = useCan('cost.view');
  const { state, ensurePage, reload } = useProductPages(filters);
  const open = useCallback(
    (row: ProductRow) => navigate('products.detail', { productId: row.productId }),
    [navigate],
  );
  const rows = useMemo(() => {
    if (state.status !== 'ready') return [];
    return Array.from(
      { length: state.total },
      (_, index) => state.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE] ?? null,
    );
  }, [state]);

  if (state.status === 'loading') return <LoadingState label={t('state.loading')} rows={6} />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('products.error')}
        message={state.message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={reload}
      />
    );
  }
  if (state.total === 0) {
    return hasFilters(filters) ? (
      <EmptyState
        icon={PackageSearch}
        title={t('products.noMatch.title')}
        description={t('products.noMatch.description')}
        action={
          <Button variant="secondary" onClick={() => setFilters(INITIAL_FILTERS)}>
            {t('products.filter.reset')}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={PackagePlus}
        title={t('products.empty.title')}
        description={t('products.empty.description')}
        action={
          <div className="flex gap-2">
            {onCreate !== null && <Button onClick={onCreate}>{t('products.new')}</Button>}
            {onImport !== null && (
              <Button variant="secondary" onClick={onImport}>
                {t('products.import')}
              </Button>
            )}
          </div>
        }
      />
    );
  }
  return (
    <>
      <p className="text-muted-foreground text-sm" role="status">
        {t('products.count', { count: state.total })}
      </p>
      <ProductTable
        rows={rows}
        total={state.total}
        showCost={showCost}
        ensurePage={ensurePage}
        open={open}
      />
    </>
  );
}

/** Catalogue (A.4 Produits) : tableau filtrable, ajout rapide, import et export. */
export function ProductsPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const canEdit = useCan('product.edit');
  const canPrice = useCan('price.edit');
  const canExport = useCan('export.run');
  const { state, reload } = useCatalogReferences();
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [dialog, setDialog] = useState<'create' | 'import' | null>(null);
  const [listKey, setListKey] = useState(0);
  const canCreate = canEdit && canPrice;

  const exportCatalog = async (format: 'xlsx' | 'csv'): Promise<void> => {
    try {
      const result = await invoke('catalog:export', { format });
      if (result.saved) toast.success(t('products.exported', { rows: result.rows }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const update = (patch: Partial<Filters>): void =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <>
      <PageHeader
        title={t('products.title')}
        description={t('products.description')}
        actions={
          <div className="flex gap-2">
            {canCreate && (
              <Button onClick={() => setDialog('create')} disabled={state.status !== 'ready'}>
                <PackagePlus aria-hidden="true" />
                {t('products.new')}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label={t('common.more')}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreate && (
                  <DropdownMenuItem onSelect={() => setDialog('import')}>
                    <Upload aria-hidden="true" />
                    {t('products.import')}
                  </DropdownMenuItem>
                )}
                {canExport && (
                  <>
                    <DropdownMenuItem onSelect={() => void exportCatalog('xlsx')}>
                      <Download aria-hidden="true" />
                      {t('products.exportXlsx')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void exportCatalog('csv')}>
                      <Download aria-hidden="true" />
                      {t('products.exportCsv')}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onSelect={() => navigate('products.categories')}>
                  <FolderTree aria-hidden="true" />
                  {t('products.manageCategories')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('products.brands')}>
                  <Tags aria-hidden="true" />
                  {t('products.manageBrands')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={6} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('products.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <>
          <section role="search" className="flex flex-col gap-4" aria-label={t('products.filters')}>
            <div className="flex flex-col gap-2">
              <label htmlFor="products-search" className="text-sm font-medium">
                {t('products.search')}
              </label>
              <Input
                id="products-search"
                type="search"
                autoFocus
                autoComplete="off"
                placeholder={t('products.searchPlaceholder')}
                value={filters.query}
                onChange={(event) => update({ query: event.target.value })}
              />
            </div>
            <div className="grid grid-cols-4 gap-4">
              <SelectField
                label={t('products.filter.category')}
                value={filters.categoryId}
                options={[
                  { value: ALL, label: t('products.filter.allCategories') },
                  ...categoryOptions(state.data.categories),
                ]}
                onValueChange={(categoryId) => update({ categoryId, attributes: {} })}
              />
              <SelectField
                label={t('products.filter.brand')}
                value={filters.brandId}
                options={[
                  { value: ALL, label: t('products.filter.allBrands') },
                  ...state.data.brands.map((brand) => ({
                    value: String(brand.id),
                    label: brand.name,
                  })),
                ]}
                onValueChange={(brandId) => update({ brandId })}
              />
              <SelectField
                label={t('products.filter.status')}
                value={filters.status}
                options={[
                  { value: 'active', label: t('products.filter.active') },
                  { value: 'archived', label: t('products.filter.archived') },
                  { value: 'all', label: t('common.all') },
                ]}
                onValueChange={(status) => update({ status: status as Filters['status'] })}
              />
              <SelectField
                label={t('products.filter.sort')}
                value={filters.sort}
                options={PRODUCT_SORTS.map((sort) => ({
                  value: sort,
                  label: t(`products.sort.${sort}`),
                }))}
                onValueChange={(sort) => update({ sort: sort as Sort })}
              />
            </div>
            <CheckboxField
              label={t('products.filter.lowStock')}
              checked={filters.lowStock}
              onChange={(event) => update({ lowStock: event.target.checked })}
            />
            <AttributeFilterFields
              references={state.data}
              filters={filters}
              onChange={(attributes) => update({ attributes })}
            />
          </section>
          <ListBody
            key={listKey}
            filters={filters}
            setFilters={setFilters}
            onCreate={canCreate ? () => setDialog('create') : null}
            onImport={canCreate ? () => setDialog('import') : null}
          />
          {dialog === 'create' && (
            <ProductFormDialog
              references={state.data}
              product={null}
              onOpenChange={() => setDialog(null)}
              onDone={(productId) => {
                setDialog(null);
                navigate('products.detail', { productId });
              }}
            />
          )}
          {dialog === 'import' && (
            <ImportDialog
              onOpenChange={() => setDialog(null)}
              onDone={() => {
                setDialog(null);
                reload();
                setListKey((key) => key + 1);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
