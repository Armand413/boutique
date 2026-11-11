import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { ProductDetail, ProductRow, VariantDetail } from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { Input } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { CheckboxField, FormError, SelectField, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useCan } from './catalog-ui';
import {
  emptyVariantValues,
  VariantFields,
  variantErrors,
  variantInput,
  variantValuesOf,
  type VariantValues,
} from './VariantFields';

interface DetailDialogProps {
  product: ProductDetail;
  onOpenChange: (open: boolean) => void;
  onDone: (product: ProductDetail) => void;
}

export function variantName(
  variant: Pick<VariantDetail, 'label' | 'sku'>,
  fallback: string,
): string {
  return variant.label === '' ? fallback : variant.label;
}

/** Ajout ou modification d'une variante (prix, codes, mémoire, état). */
export function VariantDialog({
  product,
  variant,
  onOpenChange,
  onDone,
}: DetailDialogProps & { variant: VariantDetail | null }) {
  const t = useT();
  const canSeeCost = useCan('cost.view');
  const { error, submit } = useSubmit();
  const { register, handleSubmit, control, formState, setError } = useForm<
    VariantValues & { isActive: boolean }
  >({
    defaultValues: {
      ...(variant === null ? emptyVariantValues() : variantValuesOf(variant)),
      isActive: variant?.isActive ?? true,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    const input = variantInput(t, values, canSeeCost, (name, message) =>
      setError(name, { message }),
    );
    if (input === undefined) return;
    const saved = await submit(() =>
      invoke('variants:save', {
        productId: product.id,
        ...(variant === null ? {} : { id: variant.id }),
        ...input,
        isActive: values.isActive,
      }),
    );
    if (saved !== null) {
      toast.success(t('variant.saved'));
      onDone(saved.value);
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {variant === null
              ? t('variant.form.createTitle')
              : t('variant.form.editTitle', { sku: variant.sku })}
          </DialogTitle>
          <DialogDescription>{product.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <Controller
            control={control}
            name="condition"
            render={({ field }) => (
              <VariantFields
                register={(name) => register(name)}
                errors={variantErrors(formState.errors)}
                condition={field.value}
                onConditionChange={field.onChange}
                showCost={canSeeCost}
              />
            )}
          />
          {variant !== null && (
            <CheckboxField label={t('variant.form.active')} {...register('isActive')} />
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {variant === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface KitLine {
  variantId: number;
  name: string;
  quantity: number;
}

/** Composition d'un kit : recherche des composants (hors kits) et quantités. */
export function KitDialog({
  product,
  kitVariant,
  onOpenChange,
  onDone,
}: DetailDialogProps & { kitVariant: VariantDetail }) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [lines, setLines] = useState<KitLine[]>(() =>
    kitVariant.components.map((component) => ({
      variantId: component.variantId,
      name: [component.productName, component.variantLabel]
        .filter((part) => part !== '')
        .join(' · '),
      quantity: component.quantity,
    })),
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [saving, setSaving] = useState(false);

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let active = true;
    const timer = window.setTimeout(() => {
      invoke('products:search', {
        query,
        status: 'active',
        excludeKits: true,
        sort: 'name',
        offset: 0,
        limit: 8,
      }).then(
        (found) => {
          if (active) setResults(found.rows);
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
  }, [query, searching]);

  const add = (row: ProductRow): void => {
    setLines((current) =>
      current.some((line) => line.variantId === row.variantId)
        ? current.map((line) =>
            line.variantId === row.variantId ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...current,
            {
              variantId: row.variantId,
              name: [row.name, row.variantLabel].filter((part) => part !== '').join(' · '),
              quantity: 1,
            },
          ],
    );
    setQuery('');
  };
  const setQuantity = (variantId: number, quantity: number): void =>
    setLines((current) =>
      current.map((line) =>
        line.variantId === variantId
          ? { ...line, quantity: Math.max(1, Math.min(10_000, quantity)) }
          : line,
      ),
    );
  const save = async (): Promise<void> => {
    setSaving(true);
    const saved = await submit(() =>
      invoke('kits:setComponents', {
        kitVariantId: kitVariant.id,
        components: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      }),
    );
    setSaving(false);
    if (saved !== null) {
      toast.success(t('kit.saved'));
      onDone(saved.value);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('kit.form.title', { name: product.name })}</DialogTitle>
          <DialogDescription>{t('kit.form.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <TextField
            label={t('kit.form.search')}
            placeholder={t('kit.form.searchPlaceholder')}
            value={query}
            autoFocus
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim().length >= 2 && (
            <ul
              className="border-border flex flex-col rounded-md border"
              aria-label={t('search.results')}
            >
              {results.length === 0 && (
                <li className="text-muted-foreground px-3 py-2 text-sm">
                  {t('kit.form.noResult')}
                </li>
              )}
              {results.map((row) => {
                const name = [row.name, row.variantLabel].filter((part) => part !== '').join(' · ');
                return (
                  <li
                    key={row.variantId}
                    className="border-border flex items-center justify-between gap-2 border-t px-3 py-2 first:border-t-0"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{name}</span>{' '}
                      <span className="text-muted-foreground font-mono">{row.sku}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => add(row)}
                      aria-label={t('kit.form.add', { name })}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.kit.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.variantId} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 text-sm font-medium">{line.name}</span>
                <span className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t('detail.col.quantity')} −1 : ${line.name}`}
                    onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <Input
                    className="tabular w-20 text-center"
                    inputMode="numeric"
                    aria-label={t('kit.form.quantity', { name: line.name })}
                    value={String(line.quantity)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value)) setQuantity(line.variantId, value);
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t('detail.col.quantity')} +1 : ${line.name}`}
                    onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('kit.form.remove', { name: line.name })}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((other) => other.variantId !== line.variantId),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Étiquettes PDF : par variante (nombre d'exemplaires) ou par unité suivie sélectionnée. */
export function LabelsDialog({
  product,
  serialUnitIds,
  onOpenChange,
}: {
  product: ProductDetail;
  /** Unités choisies dans la fiche (une étiquette chacune), par variante. */
  serialUnitIds: ReadonlyMap<number, number[]> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const [layout, setLayout] = useState<'a4' | 'roll'>('a4');
  const [showPrice, setShowPrice] = useState(true);
  const [copies, setCopies] = useState<Record<number, string>>(() =>
    Object.fromEntries(product.variants.filter((v) => v.isActive).map((v) => [v.id, '1'])),
  );
  const [saving, setSaving] = useState(false);
  const unitCount =
    serialUnitIds === null
      ? 0
      : [...serialUnitIds.values()].reduce((sum, ids) => sum + ids.length, 0);

  const generate = async (): Promise<void> => {
    const items =
      serialUnitIds === null
        ? product.variants.flatMap((variant) => {
            const count = Number(copies[variant.id] ?? '0');
            return Number.isInteger(count) && count > 0
              ? [{ variantId: variant.id, copies: Math.min(count, 500) }]
              : [];
          })
        : [...serialUnitIds.entries()].map(([variantId, ids]) => ({
            variantId,
            copies: 1,
            serialUnitIds: ids,
          }));
    if (items.length === 0) {
      toast.warning(t('labels.nothing'));
      return;
    }
    setSaving(true);
    const result = await submit(() => invoke('labels:generate', { layout, showPrice, items }));
    setSaving(false);
    if (result?.value.saved === true) {
      toast.success(t('labels.saved'));
      onOpenChange(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('labels.title')}</DialogTitle>
          <DialogDescription>{t('labels.description')}</DialogDescription>
        </DialogHeader>
        <SelectField
          label={t('labels.layout')}
          value={layout}
          options={[
            { value: 'a4', label: t('labels.layout.a4') },
            { value: 'roll', label: t('labels.layout.roll') },
          ]}
          onValueChange={(value) => setLayout(value === 'roll' ? 'roll' : 'a4')}
        />
        <CheckboxField
          label={t('labels.showPrice')}
          checked={showPrice}
          onChange={(event) => setShowPrice(event.target.checked)}
        />
        {serialUnitIds === null ? (
          <div className="flex flex-col gap-3">
            {product.variants
              .filter((variant) => variant.isActive)
              .map((variant) => {
                const label = `${variantName(variant, t('detail.variant.standard'))} (${variant.sku})`;
                return (
                  <div key={variant.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {label} · <Money amount={variant.salePrice} />
                    </span>
                    <Input
                      className="tabular w-24 text-center"
                      inputMode="numeric"
                      aria-label={t('labels.copies', { label })}
                      value={copies[variant.id] ?? ''}
                      onChange={(event) =>
                        setCopies((current) => ({ ...current, [variant.id]: event.target.value }))
                      }
                    />
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-sm">{t('labels.units', { count: unitCount })}</p>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void generate()} disabled={saving}>
            {t('labels.generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
