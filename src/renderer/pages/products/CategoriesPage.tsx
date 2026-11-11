import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { FolderPlus, Pencil, Plus } from 'lucide-react';
import {
  MAX_CATEGORY_DEPTH,
  type AttributeValueType,
  type TrackingMode,
} from '@shared/catalog/constants';
import { categoryPath, descendantIds, effectiveAttributes } from '@shared/catalog/tree';
import {
  ATTRIBUTE_CODE_PATTERN,
  type AttributeDefinition,
  type CatalogReferences,
  type Category,
} from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  CheckboxField,
  FormError,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import {
  parseOptionalInt,
  trackingOptions,
  treeOrder,
  useCan,
  useCatalogReferences,
  valueTypeOptions,
} from './catalog-ui';

const NONE = 'none';

type Dialog =
  | { kind: 'category'; category: Category | null; parentId: number | null }
  | { kind: 'attribute'; attribute: AttributeDefinition | null; category: Category }
  | null;

interface CategoryValues {
  name: string;
  parentId: string;
  defaultTrackingMode: TrackingMode;
  defaultWarrantyMonths: string;
  sortOrder: string;
  isActive: boolean;
}

function CategoryDialog({
  references,
  category,
  parentId,
  onOpenChange,
  onDone,
}: {
  references: CatalogReferences;
  category: Category | null;
  parentId: number | null;
  onOpenChange: (open: boolean) => void;
  onDone: (category: Category) => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const parent = references.categories.find(
    (candidate) => candidate.id === (category?.parentId ?? parentId),
  );
  const { register, handleSubmit, control, formState, setError } = useForm<CategoryValues>({
    defaultValues: {
      name: category?.name ?? '',
      parentId:
        (category?.parentId ?? parentId) === null ? NONE : String(category?.parentId ?? parentId),
      defaultTrackingMode: category?.defaultTrackingMode ?? parent?.defaultTrackingMode ?? 'none',
      defaultWarrantyMonths: String(
        category?.defaultWarrantyMonths ?? parent?.defaultWarrantyMonths ?? 0,
      ),
      sortOrder: String(category?.sortOrder ?? 0),
      isActive: category?.isActive ?? true,
    },
  });
  // Parents possibles : pas la catégorie elle-même ni sa descendance, et pas au-delà de trois niveaux.
  const excluded = category === null ? [] : descendantIds(references.categories, category.id);
  const parents = treeOrder(references.categories).filter(
    (candidate) => candidate.depth < MAX_CATEGORY_DEPTH - 1 && !excluded.includes(candidate.id),
  );
  const onSubmit = handleSubmit(async (values) => {
    const warranty = parseOptionalInt(values.defaultWarrantyMonths);
    const sortOrder = parseOptionalInt(values.sortOrder);
    if (warranty === undefined || warranty === null || warranty > 600) {
      setError('defaultWarrantyMonths', { message: t('product.form.invalidNumber') });
      return;
    }
    if (sortOrder === undefined || sortOrder === null) {
      setError('sortOrder', { message: t('product.form.invalidNumber') });
      return;
    }
    const saved = await submit(() =>
      invoke('categories:save', {
        ...(category === null ? {} : { id: category.id }),
        name: values.name,
        parentId: values.parentId === NONE ? null : Number(values.parentId),
        defaultTrackingMode: values.defaultTrackingMode,
        defaultWarrantyMonths: warranty,
        sortOrder,
        isActive: values.isActive,
      }),
    );
    if (saved !== null) {
      toast.success(t('category.saved'));
      onDone(saved.value);
    }
  });
  const title =
    category !== null
      ? t('category.form.editTitle', { name: category.name })
      : parentId === null
        ? t('category.form.createFamilyTitle')
        : t('category.form.createTitle');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('product.form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('category.form.name')}
            autoFocus
            maxLength={80}
            error={formState.errors.name?.message}
            {...register('name', {
              validate: (value) => value.trim() !== '' || t('product.form.required'),
            })}
          />
          <Controller
            control={control}
            name="parentId"
            render={({ field }) => (
              <SelectField
                label={t('category.form.parent')}
                value={field.value}
                options={[
                  { value: NONE, label: t('category.form.noParent') },
                  ...parents.map((candidate) => ({
                    value: String(candidate.id),
                    label: categoryPath(references.categories, candidate.id),
                  })),
                ]}
                onValueChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="defaultTrackingMode"
            render={({ field }) => (
              <SelectField
                label={t('category.form.tracking')}
                value={field.value}
                options={trackingOptions(t)}
                onValueChange={field.onChange}
              />
            )}
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('category.form.warranty')}
              inputMode="numeric"
              error={formState.errors.defaultWarrantyMonths?.message}
              {...register('defaultWarrantyMonths')}
            />
            <TextField
              label={t('category.form.sortOrder')}
              inputMode="numeric"
              error={formState.errors.sortOrder?.message}
              {...register('sortOrder')}
            />
          </div>
          <CheckboxField label={t('category.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {category === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface AttributeValues {
  label: string;
  code: string;
  valueType: AttributeValueType;
  unit: string;
  choices: string;
  isRequired: boolean;
  isFilterable: boolean;
  sortOrder: string;
  isActive: boolean;
}

/** Code proposé à partir du libellé : « Puissance crête » → « puissance_crete ». */
export function codeFromLabel(label: string): string {
  const code = label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
  return code;
}

function AttributeDialog({
  attribute,
  category,
  onOpenChange,
  onDone,
}: {
  attribute: AttributeDefinition | null;
  category: Category;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, run } = useSubmit();
  const { register, handleSubmit, control, formState, setError, setValue, getValues } =
    useForm<AttributeValues>({
      defaultValues: {
        label: attribute?.label ?? '',
        code: attribute?.code ?? '',
        valueType: attribute?.valueType ?? 'number',
        unit: attribute?.unit ?? '',
        choices: (attribute?.choices ?? []).join('\n'),
        isRequired: attribute?.isRequired ?? false,
        isFilterable: attribute?.isFilterable ?? true,
        sortOrder: String(attribute?.sortOrder ?? 0),
        isActive: attribute?.isActive ?? true,
      },
    });
  const valueType = useWatch({ control, name: 'valueType' });
  const labelField = register('label', {
    validate: (value) => value.trim() !== '' || t('product.form.required'),
  });
  const onSubmit = handleSubmit(async (values) => {
    const code = values.code.trim();
    if (!ATTRIBUTE_CODE_PATTERN.test(code)) {
      setError('code', { message: t('attribute.form.invalidCode') });
      return;
    }
    const choices = values.choices
      .split('\n')
      .map((choice) => choice.trim())
      .filter((choice) => choice !== '');
    if (values.valueType === 'choice' && choices.length === 0) {
      setError('choices', { message: t('attribute.form.choicesRequired') });
      return;
    }
    const sortOrder = parseOptionalInt(values.sortOrder) ?? 0;
    const ok = await run(async () => {
      await invoke('attributes:save', {
        ...(attribute === null ? {} : { id: attribute.id }),
        categoryId: category.id,
        code,
        label: values.label,
        valueType: values.valueType,
        unit: values.unit,
        choices: values.valueType === 'choice' ? [...new Set(choices)] : null,
        isRequired: values.isRequired,
        isFilterable: values.isFilterable,
        sortOrder,
        isActive: values.isActive,
      });
    });
    if (ok) {
      toast.success(t('attribute.saved'));
      onDone();
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {attribute === null
              ? t('attribute.form.createTitle', { name: category.name })
              : t('attribute.form.editTitle', { name: attribute.label })}
          </DialogTitle>
          <DialogDescription>{t('categories.attributesHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('attribute.form.label')}
            autoFocus
            maxLength={80}
            error={formState.errors.label?.message}
            {...labelField}
            onChange={(event) => {
              void labelField.onChange(event);
              if (
                attribute === null &&
                (getValues('code') === '' || formState.dirtyFields.code !== true)
              ) {
                setValue('code', codeFromLabel(event.target.value));
              }
            }}
          />
          <TextField
            label={t('attribute.form.code')}
            hint={t('attribute.form.codeHint')}
            maxLength={40}
            autoComplete="off"
            error={formState.errors.code?.message}
            {...register('code')}
          />
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="valueType"
              render={({ field }) => (
                <SelectField
                  label={t('attribute.form.type')}
                  value={field.value}
                  options={valueTypeOptions(t)}
                  onValueChange={field.onChange}
                />
              )}
            />
            <TextField label={t('attribute.form.unit')} maxLength={16} {...register('unit')} />
          </div>
          {valueType === 'choice' && (
            <TextAreaField
              label={t('attribute.form.choices')}
              hint={t('attribute.form.choicesHint')}
              rows={4}
              error={formState.errors.choices?.message}
              {...register('choices')}
            />
          )}
          <TextField
            label={t('category.form.sortOrder')}
            inputMode="numeric"
            {...register('sortOrder')}
          />
          <CheckboxField label={t('attribute.form.required')} {...register('isRequired')} />
          <CheckboxField label={t('attribute.form.filterable')} {...register('isFilterable')} />
          <CheckboxField label={t('attribute.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {attribute === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttributesPanel({
  references,
  category,
  canManage,
  onEdit,
  onCreate,
}: {
  references: CatalogReferences;
  category: Category;
  canManage: boolean;
  onEdit: (attribute: AttributeDefinition) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const attributes = effectiveAttributes(
    references.categories,
    references.attributes,
    category.id,
    {
      includeInactive: true,
    },
  );
  const names = new Map(references.categories.map((candidate) => [candidate.id, candidate.name]));
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('categories.attributes', { name: category.name })}</CardTitle>
          <CardDescription>
            {t('categories.defaults', {
              tracking: t(`tracking.${category.defaultTrackingMode}`),
              months: category.defaultWarrantyMonths,
            })}{' '}
            {t('categories.attributesHint')}
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={onCreate}>
            <Plus aria-hidden="true" />
            {t('categories.newAttribute')}
          </Button>
        )}
      </CardHeader>
      {attributes.length === 0 ? (
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('categories.noAttributes')}</p>
        </CardContent>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('categories.col.label')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('categories.col.code')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('categories.col.type')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('categories.col.flags')}
              </th>
              {canManage && (
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t('users.col.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {attributes.map((attribute) => {
              const inherited = attribute.categoryId !== category.id;
              return (
                <tr key={attribute.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <span className="block font-medium">
                      {attribute.label}
                      {attribute.unit === null ? '' : ` (${attribute.unit})`}
                    </span>
                    {inherited && (
                      <span className="text-muted-foreground block">
                        {t('categories.inherited', { name: names.get(attribute.categoryId) ?? '' })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">{attribute.code}</td>
                  <td className="px-4 py-3">
                    {t(`valueType.${attribute.valueType}`)}
                    {attribute.choices !== null && (
                      <span className="text-muted-foreground block">
                        {attribute.choices.join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {attribute.isRequired && (
                        <Badge tone="info">{t('categories.required')}</Badge>
                      )}
                      {attribute.isFilterable && <Badge>{t('categories.filterable')}</Badge>}
                      {!attribute.isActive && <Badge tone="warning">{t('common.archived')}</Badge>}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {!inherited && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('categories.editAttribute', { name: attribute.label })}
                          onClick={() => onEdit(attribute)}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Familles, catégories et caractéristiques techniques (4.12), modifiables par l'administrateur. */
export function CategoriesPage() {
  const t = useT();
  const canManage = useCan('settings.manage');
  const { state, reload } = useCatalogReferences();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (): void => setDialog(null);

  return (
    <>
      <PageHeader
        title={t('categories.title')}
        description={t('categories.description')}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ kind: 'category', category: null, parentId: null })}>
              <FolderPlus aria-hidden="true" />
              {t('categories.newFamily')}
            </Button>
          ) : undefined
        }
      />
      {!canManage && <p className="text-muted-foreground text-sm">{t('categories.readOnly')}</p>}
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={6} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('categories.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('categories.tree')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1">
                {treeOrder(state.data.categories).map((category) => {
                  const selected = category.id === selectedId;
                  return (
                    <li
                      key={category.id}
                      className={cn('flex items-center gap-1 rounded-md', selected && 'bg-muted')}
                      style={{ paddingLeft: `${String(category.depth * 24)}px` }}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedId(category.id)}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left',
                          category.depth === 0 ? 'text-base font-semibold' : 'text-sm',
                        )}
                      >
                        <span className="truncate">{category.name}</span>
                        <span className="text-muted-foreground shrink-0 text-sm font-normal">
                          {t('categories.products', { count: category.productCount })}
                        </span>
                        {!category.isActive && <Badge tone="warning">{t('common.archived')}</Badge>}
                      </button>
                      {canManage && (
                        <>
                          {category.depth < MAX_CATEGORY_DEPTH - 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t('categories.addChild', { name: category.name })}
                              onClick={() =>
                                setDialog({
                                  kind: 'category',
                                  category: null,
                                  parentId: category.id,
                                })
                              }
                            >
                              <Plus aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('categories.edit', { name: category.name })}
                            onClick={() =>
                              setDialog({ kind: 'category', category, parentId: category.parentId })
                            }
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          {(() => {
            const category = state.data.categories.find((candidate) => candidate.id === selectedId);
            if (category === undefined) {
              return <p className="text-muted-foreground py-6 text-sm">{t('categories.select')}</p>;
            }
            return (
              <AttributesPanel
                references={state.data}
                category={category}
                canManage={canManage}
                onCreate={() => setDialog({ kind: 'attribute', attribute: null, category })}
                onEdit={(attribute) => setDialog({ kind: 'attribute', attribute, category })}
              />
            );
          })()}
          {dialog?.kind === 'category' && (
            <CategoryDialog
              references={state.data}
              category={dialog.category}
              parentId={dialog.parentId}
              onOpenChange={close}
              onDone={(category) => {
                close();
                setSelectedId(category.id);
                reload();
              }}
            />
          )}
          {dialog?.kind === 'attribute' && (
            <AttributeDialog
              attribute={dialog.attribute}
              category={dialog.category}
              onOpenChange={close}
              onDone={() => {
                close();
                reload();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
