import { useMemo } from 'react';
import { Controller, useForm, useWatch, type UseFormSetValue } from 'react-hook-form';
import { coerceTrackingMode, type ProductType, type TrackingMode } from '@shared/catalog/constants';
import { effectiveAttributes } from '@shared/catalog/tree';
import type {
  AttributeDefinition,
  AttributeValue,
  CatalogReferences,
  CreateProductInput,
  ProductDetail,
} from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { Separator } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextAreaField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { invoke } from '../../lib/ipc';
import {
  categoryOptions,
  parseOptionalInt,
  trackingOptions,
  typeOptions,
  useCan,
} from './catalog-ui';
import {
  emptyVariantValues,
  VariantFields,
  variantErrors,
  variantInput,
  type VariantValues,
} from './VariantFields';

interface ProductValues extends VariantValues {
  name: string;
  brandId: string;
  categoryId: string;
  model: string;
  productType: ProductType;
  trackingMode: TrackingMode;
  taxRateId: string;
  reorderLevel: string;
  warrantyMonths: string;
  weightKg: string;
  description: string;
  /** Caractéristiques, par identifiant d'attribut : texte saisi, ou 'yes' / 'no'. */
  attributes: Record<string, string>;
}

const NONE = 'none';

function initialValues(
  references: CatalogReferences,
  product: ProductDetail | null,
): ProductValues {
  if (product !== null) {
    const attributes: Record<string, string> = {};
    for (const { attributeId, value } of product.attributes) {
      attributes[String(attributeId)] =
        typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
    }
    return {
      ...emptyVariantValues(),
      name: product.name,
      brandId: product.brandId === null ? NONE : String(product.brandId),
      categoryId: String(product.categoryId),
      model: product.model ?? '',
      productType: product.productType,
      trackingMode: product.trackingMode,
      taxRateId: product.taxRateId === null ? NONE : String(product.taxRateId),
      reorderLevel: String(product.reorderLevel),
      warrantyMonths: String(product.warrantyMonths),
      weightKg: product.weightKg === null ? '' : String(product.weightKg).replace('.', ','),
      description: product.description ?? '',
      attributes,
    };
  }
  const family = references.categories.find(
    (category) => category.parentId === null && category.isActive,
  );
  return {
    ...emptyVariantValues(),
    name: '',
    brandId: NONE,
    categoryId: family === undefined ? '' : String(family.id),
    model: '',
    productType: 'accessory',
    trackingMode: coerceTrackingMode('accessory', family?.defaultTrackingMode ?? 'none'),
    taxRateId: NONE,
    reorderLevel: '0',
    warrantyMonths: String(family?.defaultWarrantyMonths ?? 0),
    weightKg: '',
    description: '',
    attributes: {},
  };
}

type ParsedAttribute = { value: AttributeValue | null } | { error: string };

/** Valeur saisie → valeur typée (null si vide), ou message d'erreur. */
function parseAttribute(
  t: Translate,
  definition: AttributeDefinition,
  text: string,
): ParsedAttribute {
  if (text.trim() === '') {
    return definition.isRequired ? { error: t('product.form.required') } : { value: null };
  }
  if (definition.valueType === 'boolean') return { value: text === 'yes' };
  if (definition.valueType === 'number') {
    const value = Number(text.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(value) ? { value } : { error: t('product.form.invalidDecimal') };
  }
  return { value: text.trim() };
}

function AttributeInputs({
  t,
  definitions,
  values,
  errors,
  setValue,
}: {
  t: Translate;
  definitions: readonly AttributeDefinition[];
  values: Record<string, string>;
  errors: Record<string, string>;
  setValue: UseFormSetValue<ProductValues>;
}) {
  if (definitions.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('product.form.noAttributes')}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      {definitions.map((definition) => {
        const key = String(definition.id);
        const value = values[key] ?? '';
        const label = `${definition.label}${definition.unit === null ? '' : ` (${definition.unit})`}${definition.isRequired ? ' *' : ''}`;
        const set = (next: string): void =>
          setValue(`attributes.${key}`, next, { shouldDirty: true });
        if (definition.valueType === 'boolean' || definition.valueType === 'choice') {
          const options =
            definition.valueType === 'boolean'
              ? [
                  { value: 'yes', label: t('common.yes') },
                  { value: 'no', label: t('common.no') },
                ]
              : (definition.choices ?? []).map((choice) => ({ value: choice, label: choice }));
          return (
            <SelectField
              key={key}
              label={label}
              value={value === '' ? NONE : value}
              options={[{ value: NONE, label: t('detail.notSet') }, ...options]}
              onValueChange={(next) => set(next === NONE ? '' : next)}
              error={errors[key]}
            />
          );
        }
        return (
          <TextField
            key={key}
            label={label}
            value={value}
            inputMode={definition.valueType === 'number' ? 'decimal' : undefined}
            error={errors[key]}
            onChange={(event) => set(event.target.value)}
          />
        );
      })}
    </div>
  );
}

interface ProductFormDialogProps {
  references: CatalogReferences;
  /** null : création. */
  product: ProductDetail | null;
  onOpenChange: (open: boolean) => void;
  onDone: (productId: number) => void;
}

/** Ajout rapide ou modification d'un produit, avec ses caractéristiques (4.1, 4.12). */
export function ProductFormDialog({
  references,
  product,
  onOpenChange,
  onDone,
}: ProductFormDialogProps) {
  const t = useT();
  const canSeeCost = useCan('cost.view');
  const { error, run } = useSubmit();
  const { register, handleSubmit, control, formState, setValue, setError, clearErrors } =
    useForm<ProductValues>({
      defaultValues: initialValues(references, product),
    });
  const [categoryId, productType, attributeValues] = useWatch({
    control,
    name: ['categoryId', 'productType', 'attributes'],
  });
  const definitions = useMemo(
    () =>
      categoryId === ''
        ? []
        : effectiveAttributes(references.categories, references.attributes, Number(categoryId)),
    [references, categoryId],
  );
  const attributeErrors = Object.fromEntries(
    Object.entries(formState.errors.attributes ?? {}).map(([key, issue]) => [
      key,
      issue?.message ?? '',
    ]),
  );
  const locked = product?.typeLocked === true;

  const onCategoryChange = (next: string): void => {
    setValue('categoryId', next);
    if (product !== null) return;
    const category = references.categories.find((candidate) => String(candidate.id) === next);
    if (category === undefined) return;
    setValue('trackingMode', coerceTrackingMode(productType, category.defaultTrackingMode));
    setValue('warrantyMonths', String(category.defaultWarrantyMonths));
  };
  const onTypeChange = (next: string): void => {
    const type = next as ProductType;
    setValue('productType', type);
    const category = references.categories.find((candidate) => String(candidate.id) === categoryId);
    setValue('trackingMode', coerceTrackingMode(type, category?.defaultTrackingMode ?? 'none'));
  };

  const onSubmit = handleSubmit(async (values) => {
    clearErrors();
    let valid = true;
    const attributes: CreateProductInput['attributes'] = [];
    for (const definition of definitions) {
      const key = String(definition.id);
      const parsed = parseAttribute(t, definition, values.attributes[key] ?? '');
      if ('error' in parsed) {
        setError(`attributes.${key}`, { message: parsed.error });
        valid = false;
      } else if (parsed.value !== null) {
        attributes.push({ attributeId: definition.id, value: parsed.value });
      }
    }
    const reorderLevel = parseOptionalInt(values.reorderLevel);
    const warrantyMonths = parseOptionalInt(values.warrantyMonths);
    if (reorderLevel === undefined) {
      setError('reorderLevel', { message: t('product.form.invalidNumber') });
      valid = false;
    }
    if (warrantyMonths === undefined || (warrantyMonths ?? 0) > 600) {
      setError('warrantyMonths', { message: t('product.form.invalidNumber') });
      valid = false;
    }
    const weightText = values.weightKg.trim().replace(',', '.');
    const weightKg = weightText === '' ? null : Number(weightText);
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0)) {
      setError('weightKg', { message: t('product.form.invalidDecimal') });
      valid = false;
    }
    const variant =
      product === null
        ? variantInput(t, values, canSeeCost, (name, message) => setError(name, { message }))
        : null;
    if (!valid || variant === undefined) return;
    const fields = {
      name: values.name,
      brandId: values.brandId === NONE ? null : Number(values.brandId),
      categoryId: Number(values.categoryId),
      model: values.model,
      description: values.description,
      productType: values.productType,
      trackingMode: values.trackingMode,
      taxRateId: values.taxRateId === NONE ? null : Number(values.taxRateId),
      reorderLevel: reorderLevel ?? 0,
      warrantyMonths: warrantyMonths ?? 0,
      weightKg,
      attributes,
    };
    let savedId = product?.id ?? 0;
    const succeeded = await run(async () => {
      const saved =
        product === null
          ? await invoke('products:create', {
              ...fields,
              variants: variant === null ? [] : [variant],
            })
          : await invoke('products:update', { id: product.id, ...fields });
      savedId = saved.id;
    });
    if (succeeded) {
      toast.success(t(product === null ? 'product.created' : 'product.saved'));
      onDone(savedId);
    }
  });

  const brandOptions = [
    { value: NONE, label: t('product.form.noBrand') },
    ...references.brands
      .filter((brand) => brand.isActive || brand.id === product?.brandId)
      .map((brand) => ({ value: String(brand.id), label: brand.name })),
  ];
  const taxOptions = [
    { value: NONE, label: t('product.form.noTax') },
    ...references.taxRates
      .filter((tax) => tax.isActive || tax.id === product?.taxRateId)
      .map((tax) => ({ value: String(tax.id), label: tax.name })),
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {product === null
              ? t('product.form.createTitle')
              : t('product.form.editTitle', { name: product.name })}
          </DialogTitle>
          <DialogDescription>{t('product.form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('product.form.name')}
            autoFocus
            maxLength={160}
            error={formState.errors.name?.message}
            {...register('name', {
              validate: (value) => value.trim() !== '' || t('product.form.required'),
            })}
          />
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <SelectField
                  label={t('product.form.category')}
                  value={field.value}
                  options={categoryOptions(references.categories, product?.categoryId)}
                  onValueChange={onCategoryChange}
                />
              )}
            />
            <Controller
              control={control}
              name="brandId"
              render={({ field }) => (
                <SelectField
                  label={t('product.form.brand')}
                  value={field.value}
                  options={brandOptions}
                  onValueChange={field.onChange}
                />
              )}
            />
            <TextField label={t('product.form.model')} maxLength={80} {...register('model')} />
            <Controller
              control={control}
              name="productType"
              render={({ field }) => (
                <SelectField
                  label={t('product.form.type')}
                  value={field.value}
                  options={typeOptions(t)}
                  onValueChange={onTypeChange}
                  disabled={locked}
                />
              )}
            />
            <Controller
              control={control}
              name="trackingMode"
              render={({ field }) => (
                <SelectField
                  label={t('product.form.tracking')}
                  value={field.value}
                  options={trackingOptions(t, productType)}
                  onValueChange={field.onChange}
                  disabled={locked}
                  hint={locked ? t('product.form.trackingLocked') : undefined}
                />
              )}
            />
            <Controller
              control={control}
              name="taxRateId"
              render={({ field }) => (
                <SelectField
                  label={t('product.form.tax')}
                  value={field.value}
                  options={taxOptions}
                  onValueChange={field.onChange}
                />
              )}
            />
            <TextField
              label={t('product.form.reorderLevel')}
              inputMode="numeric"
              error={formState.errors.reorderLevel?.message}
              {...register('reorderLevel')}
            />
            <TextField
              label={t('product.form.warranty')}
              inputMode="numeric"
              error={formState.errors.warrantyMonths?.message}
              {...register('warrantyMonths')}
            />
            <TextField
              label={t('product.form.weight')}
              inputMode="decimal"
              error={formState.errors.weightKg?.message}
              {...register('weightKg')}
            />
          </div>
          <TextAreaField
            label={t('product.form.descriptionField')}
            maxLength={2000}
            {...register('description')}
          />
          <Separator />
          <h3 className="text-base font-semibold">{t('product.form.attributes')}</h3>
          <AttributeInputs
            t={t}
            definitions={definitions}
            values={attributeValues}
            errors={attributeErrors}
            setValue={setValue}
          />
          {product === null && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold">{t('product.form.firstVariant')}</h3>
                <p className="text-muted-foreground text-sm">
                  {t('product.form.firstVariantHint')}
                </p>
              </div>
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
            </>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {product === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
