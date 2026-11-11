import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ImageOff,
  ImagePlus,
  Pencil,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import { SERIAL_STATUSES } from '@shared/catalog/constants';
import type { CatalogReferences, ProductDetail, VariantDetail } from '@shared/schemas/catalog';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { useRouter } from '../../stores/router';
import { cn } from '../../lib/cn';
import { formatAttribute, useCan, useCatalogReferences } from './catalog-ui';
import { KitDialog, LabelsDialog, VariantDialog, variantName } from './ProductDialogs';
import { ProductFormDialog } from './ProductFormDialog';

type Dialog =
  | { kind: 'edit' | 'archive' | 'labels' | 'unitLabels' | 'newVariant' }
  | { kind: 'variant' | 'kit'; variant: VariantDetail }
  | null;

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  );
}

function Photo({
  product,
  canEdit,
  onChange,
}: {
  product: ProductDetail;
  canEdit: boolean;
  onChange: () => void;
}) {
  const t = useT();
  // Image rattachée à la version du produit chargée ; ignorée dès que le produit change.
  const version = `${String(product.id)}-${product.updatedAt}`;
  const [loaded, setLoaded] = useState<{ version: string; dataUrl: string | null } | null>(null);
  const dataUrl = product.hasImage && loaded?.version === version ? loaded.dataUrl : null;
  useEffect(() => {
    if (!product.hasImage) return;
    let active = true;
    invoke('products:image', { productId: product.id }).then(
      (result) => {
        if (active) setLoaded({ version, dataUrl: result.dataUrl });
      },
      () => {
        if (active) setLoaded({ version, dataUrl: null });
      },
    );
    return () => {
      active = false;
    };
  }, [product.id, product.hasImage, version]);

  const act = async (channel: 'products:chooseImage' | 'products:clearImage'): Promise<void> => {
    try {
      const result = await invoke(channel, { productId: product.id });
      if (!result.changed) return;
      toast.success(t(result.hasImage ? 'detail.photo.saved' : 'detail.photo.removed'));
      onChange();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="border-border bg-muted flex size-40 items-center justify-center overflow-hidden rounded-md border">
        {dataUrl === null ? (
          <span className="text-muted-foreground flex flex-col items-center gap-2 text-sm">
            <ImageOff className="size-8" aria-hidden="true" />
            {t('detail.photo.none')}
          </span>
        ) : (
          <img
            src={dataUrl}
            alt={t('detail.photoAlt', { name: product.name })}
            className="size-full object-contain"
          />
        )}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void act('products:chooseImage')}>
            <ImagePlus aria-hidden="true" />
            {t('detail.photo.choose')}
          </Button>
          {product.hasImage && (
            <Button size="sm" variant="ghost" onClick={() => void act('products:clearImage')}>
              <Trash2 aria-hidden="true" />
              {t('detail.photo.remove')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCard({
  product,
  references,
  canEdit,
  onChange,
}: {
  product: ProductDetail;
  references: CatalogReferences;
  canEdit: boolean;
  onChange: () => void;
}) {
  const t = useT();
  const tax = references.taxRates.find((candidate) => candidate.id === product.taxRateId);
  const notSet = <span className="text-muted-foreground">{t('detail.notSet')}</span>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.info')}</CardTitle>
        <CardDescription>
          {t('detail.history', {
            created: formatDateTime(product.createdAt),
            updated: formatDateTime(product.updatedAt),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-8">
        <dl className="grid flex-1 grid-cols-3 gap-4">
          <Field label={t('detail.brand')}>{product.brandName ?? notSet}</Field>
          <Field label={t('detail.model')}>{product.model ?? notSet}</Field>
          <Field label={t('detail.category')}>{product.categoryPath}</Field>
          <Field label={t('detail.type')}>{t(`type.${product.productType}`)}</Field>
          <Field label={t('detail.tracking')}>{t(`tracking.${product.trackingMode}`)}</Field>
          <Field label={t('detail.warranty')}>
            {product.warrantyMonths === 0
              ? t('detail.noWarranty')
              : t('detail.warrantyMonths', { months: product.warrantyMonths })}
          </Field>
          <Field label={t('detail.tax')}>{tax?.name ?? notSet}</Field>
          {product.isStocked && (
            <Field label={t('detail.reorderLevel')}>{product.reorderLevel}</Field>
          )}
          <Field label={t('detail.weight')}>
            {product.weightKg === null
              ? notSet
              : t('detail.weightValue', { weight: product.weightKg.toLocaleString('fr-FR') })}
          </Field>
          <Field label={t('detail.description')} className="col-span-3">
            {product.description === null ? (
              notSet
            ) : (
              <span className="whitespace-pre-line">{product.description}</span>
            )}
          </Field>
        </dl>
        <Photo product={product} canEdit={canEdit} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function AttributesCard({
  product,
  references,
}: {
  product: ProductDetail;
  references: CatalogReferences;
}) {
  const t = useT();
  const definitions = new Map(references.attributes.map((attribute) => [attribute.id, attribute]));
  const values = product.attributes.flatMap((value) => {
    const definition = definitions.get(value.attributeId);
    return definition === undefined ? [] : [{ definition, value: value.value }];
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.attributes')}</CardTitle>
      </CardHeader>
      <CardContent>
        {values.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.noAttributes')}</p>
        ) : (
          <dl className="grid grid-cols-3 gap-4">
            {values.map(({ definition, value }) => (
              <Field key={definition.id} label={definition.label}>
                <span className="tabular">{formatAttribute(t, definition, value)}</span>
              </Field>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function VariantsCard({
  product,
  canEdit,
  canAdd,
  showCost,
  onEdit,
  onAdd,
}: {
  product: ProductDetail;
  canEdit: boolean;
  canAdd: boolean;
  showCost: boolean;
  onEdit: (variant: VariantDetail) => void;
  onAdd: () => void;
}) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('detail.variants')}</CardTitle>
        {canAdd && (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Plus aria-hidden="true" />
            {t('detail.addVariant')}
          </Button>
        )}
      </CardHeader>
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('detail.col.variant')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('detail.col.sku')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('detail.col.price')}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {t('detail.col.minPrice')}
            </th>
            {showCost && (
              <th scope="col" className="px-4 py-3 font-medium">
                {t('detail.col.cost')}
              </th>
            )}
            {product.isStocked && (
              <th scope="col" className="px-4 py-3 font-medium">
                {t('detail.col.stock')}
              </th>
            )}
            <th scope="col" className="px-4 py-3 font-medium">
              {t('detail.col.status')}
            </th>
            {canEdit && (
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">{t('users.col.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {product.variants.map((variant) => {
            const name = variantName(variant, t('detail.variant.standard'));
            const low = product.reorderLevel > 0 && variant.stockTotal <= product.reorderLevel;
            return (
              <tr key={variant.id} className="border-border border-t">
                <td className="px-4 py-3 font-medium">{name}</td>
                <td className="px-4 py-3 font-mono">
                  <span className="block">{variant.sku}</span>
                  {variant.barcode !== null && (
                    <span className="text-muted-foreground block">{variant.barcode}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Money amount={variant.salePrice} />
                </td>
                <td className="px-4 py-3">
                  <Money amount={variant.minSalePrice} />
                </td>
                {showCost && (
                  <td className="text-muted-foreground px-4 py-3">
                    <Money amount={variant.costPrice ?? 0} /> /{' '}
                    <Money amount={variant.avgCost ?? 0} />
                  </td>
                )}
                {product.isStocked && (
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="tabular font-medium">{variant.stockTotal}</span>
                      {low && <Badge tone="warning">{t('products.lowStock')}</Badge>}
                    </span>
                  </td>
                )}
                <td className="px-4 py-3">
                  <Badge tone={variant.isActive ? 'success' : 'neutral'}>
                    {t(variant.isActive ? 'common.active' : 'common.archived')}
                  </Badge>
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('detail.editVariant', { label: name })}
                      onClick={() => onEdit(variant)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function KitCard({
  product,
  canEdit,
  onEdit,
}: {
  product: ProductDetail;
  canEdit: boolean;
  onEdit: (variant: VariantDetail) => void;
}) {
  const t = useT();
  return (
    <>
      {product.variants.map((variant) => {
        const total = variant.components.reduce(
          (sum, component) => sum + component.salePrice * component.quantity,
          0,
        );
        return (
          <Card key={variant.id} className="overflow-hidden">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  {t('detail.kit')}
                  {product.variants.length > 1 ? ` · ${variantName(variant, variant.sku)}` : ''}
                </CardTitle>
                <CardDescription>{t('detail.kit.hint')}</CardDescription>
              </div>
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={() => onEdit(variant)}>
                  <Pencil aria-hidden="true" />
                  {t('detail.kit.edit')}
                </Button>
              )}
            </CardHeader>
            {variant.components.length === 0 ? (
              <CardContent>
                <p className="text-muted-foreground text-sm">{t('detail.kit.empty')}</p>
              </CardContent>
            ) : (
              <>
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('detail.col.component')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('detail.col.quantity')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('detail.col.price')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('detail.col.stock')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {variant.components.map((component) => (
                      <tr key={component.variantId} className="border-border border-t">
                        <td className="px-4 py-3">
                          <span className="block font-medium">
                            {[component.productName, component.variantLabel]
                              .filter((part) => part !== '')
                              .join(' · ')}
                          </span>
                          <span className="text-muted-foreground block font-mono">
                            {component.sku}
                          </span>
                        </td>
                        <td className="tabular px-4 py-3">{component.quantity}</td>
                        <td className="px-4 py-3">
                          <Money amount={component.salePrice} />
                        </td>
                        <td className="px-4 py-3">
                          {component.isStocked ? (
                            <span className="tabular">{component.stock}</span>
                          ) : (
                            <span className="text-muted-foreground">{t('products.noStock')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <CardContent className="flex justify-end gap-6 pt-4 text-sm">
                  <span className="tabular">
                    {t('detail.kit.componentsTotal', { total: formatMoney(total) })}
                  </span>
                  <span className="tabular font-semibold">
                    {t('detail.kit.price', { price: formatMoney(variant.salePrice) })}
                  </span>
                </CardContent>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}

function statusTone(
  status: (typeof SERIAL_STATUSES)[number],
): 'success' | 'info' | 'neutral' | 'warning' | 'danger' {
  if (status === 'in_stock') return 'success';
  if (status === 'reserved') return 'info';
  if (status === 'sold') return 'neutral';
  if (status === 'returned') return 'warning';
  return 'danger';
}

function SerialsCard({
  t,
  product,
  selected,
  onToggle,
  onLabels,
}: {
  t: Translate;
  product: ProductDetail;
  selected: ReadonlySet<number>;
  onToggle: (unitId: number) => void;
  onLabels: () => void;
}) {
  const total = SERIAL_STATUSES.reduce(
    (sum, status) => sum + product.serialUnits.counts[status],
    0,
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <CardTitle>{t('detail.serials')}</CardTitle>
          <CardDescription>{t('detail.serials.hint')}</CardDescription>
          <div className="flex flex-wrap gap-2">
            {SERIAL_STATUSES.filter((status) => product.serialUnits.counts[status] > 0).map(
              (status) => (
                <Badge key={status} tone={statusTone(status)}>
                  {t(`serial.${status}`)} : {product.serialUnits.counts[status]}
                </Badge>
              ),
            )}
          </div>
        </div>
        {selected.size > 0 && (
          <Button size="sm" variant="secondary" onClick={onLabels}>
            <Printer aria-hidden="true" />
            {t('detail.labelsForUnits', { count: selected.size })}
          </Button>
        )}
      </CardHeader>
      {product.serialUnits.items.length === 0 ? (
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('detail.serials.empty')}</p>
        </CardContent>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="w-12 px-4 py-3">
                  <span className="sr-only">{t('detail.labels')}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('detail.col.serial')}
                </th>
                {product.trackingMode === 'imei' && (
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('detail.col.imei2')}
                  </th>
                )}
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('detail.col.status')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('detail.col.received')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('detail.col.warrantyEnd')}
                </th>
              </tr>
            </thead>
            <tbody>
              {product.serialUnits.items.map((unit) => (
                <tr key={unit.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="accent-primary size-5"
                      aria-label={t('detail.selectUnit', { serial: unit.serialNumber })}
                      checked={selected.has(unit.id)}
                      onChange={() => onToggle(unit.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono">{unit.serialNumber}</td>
                  {product.trackingMode === 'imei' && (
                    <td className="px-4 py-3 font-mono">{unit.imei2 ?? '—'}</td>
                  )}
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(unit.status)}>{t(`serial.${unit.status}`)}</Badge>
                  </td>
                  <td className="tabular px-4 py-3">
                    {unit.receivedAt === null ? '—' : formatDate(unit.receivedAt)}
                  </td>
                  <td className="tabular px-4 py-3">{unit.warrantyEnd ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > product.serialUnits.items.length && (
            <CardContent className="text-muted-foreground pt-4 text-sm">
              {t('detail.serials.more', { shown: product.serialUnits.items.length, total })}
            </CardContent>
          )}
        </>
      )}
    </Card>
  );
}

/** Fiche produit technique (A.4) : informations, caractéristiques, variantes, kit et unités suivies. */
export function ProductDetailPage() {
  const t = useT();
  const productId = useRouter((state) => state.params.productId);
  const navigate = useRouter((state) => state.navigate);
  const canEdit = useCan('product.edit');
  const canPrice = useCan('price.edit');
  const showCost = useCan('cost.view');
  const references = useCatalogReferences();
  const loader = useCallback(
    () => (productId === undefined ? Promise.resolve(null) : invoke('products:get', { productId })),
    [productId],
  );
  const { state, reload } = useRemote(loader);
  const [override, setOverride] = useState<ProductDetail | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedUnits, setSelectedUnits] = useState<ReadonlySet<number>>(new Set());
  const product =
    override?.id === productId ? override : state.status === 'ready' ? state.data : null;

  const unitsByVariant = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const unit of product?.serialUnits.items ?? []) {
      if (!selectedUnits.has(unit.id)) continue;
      map.set(unit.variantId, [...(map.get(unit.variantId) ?? []), unit.id]);
    }
    return map;
  }, [product, selectedUnits]);

  if (productId === undefined) {
    return (
      <EmptyState
        icon={Archive}
        title={t('detail.notSelected')}
        description={t('products.description')}
        action={<Button onClick={() => navigate('products')}>{t('detail.backToList')}</Button>}
      />
    );
  }
  if (state.status === 'loading' || references.state.status === 'loading') {
    return <LoadingState label={t('state.loading')} rows={6} />;
  }
  if (state.status === 'error' || references.state.status === 'error' || product === null) {
    const message =
      state.status === 'error'
        ? state.message
        : references.state.status === 'error'
          ? references.state.message
          : '';
    return (
      <ErrorState
        title={t('detail.error')}
        message={message}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={() => {
          reload();
          references.reload();
        }}
      />
    );
  }
  const refs = references.state.data;
  const close = (): void => setDialog(null);
  const saved = (next: ProductDetail): void => {
    setOverride(next);
    setDialog(null);
  };
  const refresh = (): void => {
    setOverride(null);
    reload();
  };
  const setActive = async (isActive: boolean): Promise<void> => {
    try {
      saved(await invoke('products:setActive', { productId: product.id, isActive }));
      toast.success(t(isActive ? 'detail.restored' : 'detail.archived'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={product.name}
        description={product.categoryPath}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: 'labels' })}>
              <Printer aria-hidden="true" />
              {t('detail.labels')}
            </Button>
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
                  <Pencil aria-hidden="true" />
                  {t('common.edit')}
                </Button>
                {product.isActive ? (
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'archive' })}>
                    <Archive aria-hidden="true" />
                    {t('detail.archive')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => void setActive(true)}>
                    <ArchiveRestore aria-hidden="true" />
                    {t('detail.restore')}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone="primary">{t(`type.${product.productType}`)}</Badge>
        {product.trackingMode !== 'none' && (
          <Badge tone="info">{t(`tracking.${product.trackingMode}`)}</Badge>
        )}
        {!product.isActive && <Badge tone="warning">{t('common.archived')}</Badge>}
      </div>
      <InfoCard product={product} references={refs} canEdit={canEdit} onChange={refresh} />
      <AttributesCard product={product} references={refs} />
      <VariantsCard
        product={product}
        canEdit={canEdit}
        canAdd={canEdit && canPrice}
        showCost={showCost}
        onEdit={(variant) => setDialog({ kind: 'variant', variant })}
        onAdd={() => setDialog({ kind: 'newVariant' })}
      />
      {product.productType === 'kit' && (
        <KitCard
          product={product}
          canEdit={canEdit}
          onEdit={(variant) => setDialog({ kind: 'kit', variant })}
        />
      )}
      {product.trackingMode !== 'none' && (
        <SerialsCard
          t={t}
          product={product}
          selected={selectedUnits}
          onToggle={(unitId) =>
            setSelectedUnits((current) => {
              const next = new Set(current);
              if (next.has(unitId)) next.delete(unitId);
              else next.add(unitId);
              return next;
            })
          }
          onLabels={() => setDialog({ kind: 'unitLabels' })}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ProductFormDialog
          references={refs}
          product={product}
          onOpenChange={close}
          onDone={() => {
            close();
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={t('detail.archive.title')}
          description={t('detail.archive.confirm', { name: product.name })}
          confirmLabel={t('detail.archive')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            close();
            void setActive(false);
          }}
        />
      )}
      {(dialog?.kind === 'variant' || dialog?.kind === 'newVariant') && (
        <VariantDialog
          product={product}
          variant={dialog.kind === 'variant' ? dialog.variant : null}
          onOpenChange={close}
          onDone={saved}
        />
      )}
      {dialog?.kind === 'kit' && (
        <KitDialog
          product={product}
          kitVariant={dialog.variant}
          onOpenChange={close}
          onDone={saved}
        />
      )}
      {(dialog?.kind === 'labels' || dialog?.kind === 'unitLabels') && (
        <LabelsDialog
          product={product}
          serialUnitIds={dialog.kind === 'unitLabels' ? unitsByVariant : null}
          onOpenChange={(open) => !open && close()}
        />
      )}
    </>
  );
}
