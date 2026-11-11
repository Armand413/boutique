import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Tags } from 'lucide-react';
import type { Brand } from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { CheckboxField, FormError, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import { useCan, useCatalogReferences } from './catalog-ui';

function BrandDialog({
  brand,
  onOpenChange,
  onDone,
}: {
  brand: Brand | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: brand?.name ?? '', isActive: brand?.isActive ?? true },
  });
  const onSubmit = handleSubmit(async (values) => {
    const ok = await run(async () => {
      await invoke('brands:save', { ...(brand === null ? {} : { id: brand.id }), ...values });
    });
    if (ok) {
      toast.success(t('brand.saved'));
      onDone();
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {brand === null
              ? t('brand.form.createTitle')
              : t('brand.form.editTitle', { name: brand.name })}
          </DialogTitle>
          <DialogDescription>{t('product.form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('brand.form.name')}
            autoFocus
            maxLength={80}
            error={formState.errors.name?.message}
            {...register('name', {
              validate: (value) => value.trim() !== '' || t('product.form.required'),
            })}
          />
          <CheckboxField label={t('brand.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {brand === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Marques (4.1), modifiables par l'administrateur. */
export function BrandsPage() {
  const t = useT();
  const canManage = useCan('settings.manage');
  const { state, reload } = useCatalogReferences();
  const [dialog, setDialog] = useState<{ brand: Brand | null } | null>(null);
  return (
    <>
      <PageHeader
        title={t('brands.title')}
        description={t('brands.description')}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ brand: null })}>
              <Plus aria-hidden="true" />
              {t('brands.new')}
            </Button>
          ) : undefined
        }
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('brands.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && state.data.brands.length === 0 && (
        <EmptyState
          icon={Tags}
          title={t('brands.empty.title')}
          description={t('brands.empty.description')}
          action={
            canManage ? (
              <Button onClick={() => setDialog({ brand: null })}>{t('brands.new')}</Button>
            ) : undefined
          }
        />
      )}
      {state.status === 'ready' && state.data.brands.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('brands.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('brands.col.products')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('brands.col.status')}
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">{t('users.col.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {state.data.brands.map((brand) => (
                <tr key={brand.id} className="border-border border-t">
                  <td className="px-4 py-3 text-base font-medium">{brand.name}</td>
                  <td className="tabular px-4 py-3">{brand.productCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={brand.isActive ? 'success' : 'neutral'}>
                      {t(brand.isActive ? 'common.active' : 'common.archived')}
                    </Badge>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('brands.edit', { name: brand.name })}
                        onClick={() => setDialog({ brand })}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {dialog !== null && (
        <BrandDialog
          brand={dialog.brand}
          onOpenChange={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
    </>
  );
}
