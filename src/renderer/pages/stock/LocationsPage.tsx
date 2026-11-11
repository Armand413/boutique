import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Plus } from 'lucide-react';
import type { Location } from '@shared/schemas/stock';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
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
import { useCan } from '../products/catalog-ui';
import { useLocations } from './stock-ui';

function LocationDialog({
  location,
  onOpenChange,
  onDone,
}: {
  location: Location | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      name: location?.name ?? '',
      isDefault: location?.isDefault ?? false,
      isActive: location?.isActive ?? true,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    const saved = await submit(() =>
      invoke('locations:save', { ...(location === null ? {} : { id: location.id }), ...values }),
    );
    if (saved !== null) {
      toast.success(t('location.saved'));
      onDone();
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {location === null
              ? t('location.form.createTitle')
              : t('location.form.editTitle', { name: location.name })}
          </DialogTitle>
          <DialogDescription>{t('locations.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('location.form.name')}
            autoFocus
            maxLength={60}
            error={formState.errors.name?.message}
            {...register('name', {
              validate: (value) => value.trim() !== '' || t('form.required'),
            })}
          />
          <CheckboxField label={t('location.form.default')} {...register('isDefault')} />
          <CheckboxField label={t('location.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {location === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Emplacements de stock (4.12) : magasin, vitrine, dépôt ; modifiables par l'administrateur. */
export function LocationsPage() {
  const t = useT();
  const canManage = useCan('settings.manage');
  const { state, reload } = useLocations();
  const [dialog, setDialog] = useState<{ location: Location | null } | null>(null);
  return (
    <>
      <PageHeader
        title={t('locations.title')}
        description={t('locations.description')}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ location: null })}>
              <Plus aria-hidden="true" />
              {t('locations.new')}
            </Button>
          ) : undefined
        }
      />
      {!canManage && <p className="text-muted-foreground text-sm">{t('locations.readOnly')}</p>}
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={3} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('locations.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('locations.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('locations.col.units')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('locations.col.status')}
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">{t('users.col.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {state.data.map((location) => (
                <tr key={location.id} className="border-border border-t">
                  <td className="px-4 py-3 text-base font-medium">{location.name}</td>
                  <td className="tabular px-4 py-3 text-right">{location.units}</td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1">
                      {location.isDefault && <Badge tone="primary">{t('locations.default')}</Badge>}
                      <Badge tone={location.isActive ? 'success' : 'neutral'}>
                        {t(location.isActive ? 'common.active' : 'common.archived')}
                      </Badge>
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('locations.edit', { name: location.name })}
                        onClick={() => setDialog({ location })}
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
        <LocationDialog
          location={dialog.location}
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
