import type { FieldErrors, UseFormRegisterReturn } from 'react-hook-form';
import type { Condition } from '@shared/catalog/constants';
import type { VariantDetail, VariantInput } from '@shared/schemas/catalog';
import { SelectField, TextField } from '../../components/ui/form-field';
import { useT, type Translate } from '../../i18n';
import { conditionOptions, moneyText, parseOptionalInt, parseOptionalMoney } from './catalog-ui';

/** Champs d'une variante, en texte tels que saisis. */
export interface VariantValues {
  sku: string;
  barcode: string;
  color: string;
  storageGb: string;
  ramGb: string;
  condition: Condition;
  salePrice: string;
  minSalePrice: string;
  costPrice: string;
}

type VariantField = keyof VariantValues;

export function emptyVariantValues(): VariantValues {
  return {
    sku: '',
    barcode: '',
    color: '',
    storageGb: '',
    ramGb: '',
    condition: 'new',
    salePrice: '',
    minSalePrice: '',
    costPrice: '',
  };
}

export function variantValuesOf(variant: VariantDetail): VariantValues {
  return {
    sku: variant.sku,
    barcode: variant.barcode ?? '',
    color: variant.color ?? '',
    storageGb: variant.storageGb === null ? '' : String(variant.storageGb),
    ramGb: variant.ramGb === null ? '' : String(variant.ramGb),
    condition: variant.condition,
    salePrice: moneyText(variant.salePrice),
    minSalePrice: moneyText(variant.minSalePrice),
    costPrice: moneyText(variant.costPrice),
  };
}

/** Messages d'erreur des champs de variante, extraits des erreurs du formulaire. */
export function variantErrors<T extends VariantValues>(
  errors: FieldErrors<T>,
): Partial<Record<VariantField, string>> {
  const fields: VariantField[] = [
    'sku',
    'barcode',
    'color',
    'storageGb',
    'ramGb',
    'salePrice',
    'minSalePrice',
    'costPrice',
  ];
  const messages: Partial<Record<VariantField, string>> = {};
  for (const field of fields) {
    const message = (errors as FieldErrors<VariantValues>)[field]?.message;
    if (typeof message === 'string') messages[field] = message;
  }
  return messages;
}

/**
 * Saisie → variante à envoyer ; undefined si un champ est invalide (l'erreur est signalée par `fail`).
 * Le prix d'achat n'est envoyé qu'avec la permission cost.view.
 */
export function variantInput(
  t: Translate,
  values: VariantValues,
  withCost: boolean,
  fail: (field: VariantField, message: string) => void,
): VariantInput | undefined {
  let valid = true;
  const check = <V,>(field: VariantField, value: V | undefined, message: string): V | undefined => {
    if (value === undefined) {
      fail(field, message);
      valid = false;
    }
    return value;
  };
  const storageGb = check(
    'storageGb',
    parseOptionalInt(values.storageGb),
    t('product.form.invalidNumber'),
  );
  const ramGb = check('ramGb', parseOptionalInt(values.ramGb), t('product.form.invalidNumber'));
  const salePrice = check(
    'salePrice',
    parseOptionalMoney(values.salePrice) ?? undefined,
    t(values.salePrice.trim() === '' ? 'product.form.required' : 'product.form.invalidMoney'),
  );
  const minSalePrice = check(
    'minSalePrice',
    parseOptionalMoney(values.minSalePrice),
    t('product.form.invalidMoney'),
  );
  const costPrice = withCost
    ? check('costPrice', parseOptionalMoney(values.costPrice), t('product.form.invalidMoney'))
    : null;
  if (salePrice !== undefined && minSalePrice !== undefined && (minSalePrice ?? 0) > salePrice) {
    fail('minSalePrice', t('product.form.minAbovePrice'));
    valid = false;
  }
  if (!valid || salePrice === undefined) return undefined;
  return {
    sku: values.sku.trim(),
    barcode: values.barcode.trim() === '' ? null : values.barcode.trim(),
    color: values.color.trim() === '' ? null : values.color.trim(),
    storageGb: storageGb ?? null,
    ramGb: ramGb ?? null,
    condition: values.condition,
    salePrice,
    minSalePrice: minSalePrice ?? 0,
    ...(costPrice === null || costPrice === undefined ? {} : { costPrice }),
    isActive: true,
  };
}

interface VariantFieldsProps {
  register: (name: VariantField) => UseFormRegisterReturn;
  errors: Partial<Record<VariantField, string>>;
  condition: Condition;
  onConditionChange: (condition: Condition) => void;
  showCost: boolean;
}

export function VariantFields({
  register,
  errors,
  condition,
  onConditionChange,
  showCost,
}: VariantFieldsProps) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-4">
      <TextField
        label={t('variant.form.salePrice')}
        inputMode="decimal"
        error={errors.salePrice}
        {...register('salePrice')}
      />
      <TextField
        label={t('variant.form.minSalePrice')}
        inputMode="decimal"
        error={errors.minSalePrice}
        {...register('minSalePrice')}
      />
      {showCost && (
        <TextField
          label={t('variant.form.costPrice')}
          inputMode="decimal"
          error={errors.costPrice}
          {...register('costPrice')}
        />
      )}
      <TextField
        label={t('variant.form.barcode')}
        hint={t('variant.form.barcodeHint')}
        maxLength={64}
        autoComplete="off"
        error={errors.barcode}
        {...register('barcode')}
      />
      <TextField
        label={t('variant.form.sku')}
        hint={t('variant.form.skuHint')}
        maxLength={64}
        autoComplete="off"
        error={errors.sku}
        {...register('sku')}
      />
      <TextField
        label={t('variant.form.color')}
        maxLength={40}
        error={errors.color}
        {...register('color')}
      />
      <TextField
        label={t('variant.form.storage')}
        inputMode="numeric"
        error={errors.storageGb}
        {...register('storageGb')}
      />
      <TextField
        label={t('variant.form.ram')}
        inputMode="numeric"
        error={errors.ramGb}
        {...register('ramGb')}
      />
      <SelectField
        label={t('variant.form.condition')}
        value={condition}
        options={conditionOptions(t)}
        onValueChange={(value) => onConditionChange(value as Condition)}
      />
    </div>
  );
}
