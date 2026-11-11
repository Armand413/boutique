import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Truck, UserPlus } from 'lucide-react';
import type { Supplier } from '@shared/schemas/stock';
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
import { CheckboxField, FormError, TextAreaField, TextField } from '../../components/ui/form-field';
import { Money } from '../../components/ui/money';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Création ou modification d'une fiche fournisseur (4.7). */
export function SupplierDialog({
  supplier,
  onOpenChange,
  onDone,
}: {
  supplier: Supplier | null;
  onOpenChange: (open: boolean) => void;
  onDone: (supplier: Supplier) => void;
}) {
  const t = useT();
  const { error, submit } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      name: supplier?.name ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    const saved = await submit(() =>
      invoke('suppliers:save', { ...(supplier === null ? {} : { id: supplier.id }), ...values }),
    );
    if (saved !== null) {
      toast.success(t('supplier.saved'));
      onDone(saved.value);
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {supplier === null
              ? t('supplier.form.createTitle')
              : t('supplier.form.editTitle', { name: supplier.name })}
          </DialogTitle>
          <DialogDescription>{t('product.form.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('supplier.form.name')}
            autoFocus
            maxLength={120}
            error={formState.errors.name?.message}
            {...register('name', {
              validate: (value) => value.trim() !== '' || t('form.required'),
            })}
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('supplier.form.phone')}
              type="tel"
              maxLength={32}
              {...register('phone')}
            />
            <TextField
              label={t('supplier.form.email')}
              type="email"
              maxLength={120}
              error={formState.errors.email?.message}
              {...register('email', {
                validate: (value) =>
                  value.trim() === '' ||
                  EMAIL.test(value.trim()) ||
                  t('supplier.form.invalidEmail'),
              })}
            />
          </div>
          <TextField label={t('supplier.form.address')} maxLength={300} {...register('address')} />
          <TextAreaField label={t('supplier.form.notes')} maxLength={1000} {...register('notes')} />
          <CheckboxField label={t('supplier.form.active')} {...register('isActive')} />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {supplier === null ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fournisseurs (A.4) : liste avec le reste dû à chacun. */
export function SuppliersPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const loader = useCallback(() => invoke('suppliers:list'), []);
  const { state, reload } = useRemote(loader);
  const [creating, setCreating] = useState(false);
  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <UserPlus aria-hidden="true" />
      {t('suppliers.new')}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t('suppliers.title')}
        description={t('suppliers.description')}
        actions={newButton}
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('suppliers.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState
          icon={Truck}
          title={t('suppliers.empty.title')}
          description={t('suppliers.empty.description')}
          action={newButton}
        />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('suppliers.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('suppliers.col.phone')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('suppliers.col.receipts')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('suppliers.col.balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((supplier) => (
                <tr key={supplier.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-base font-medium hover:underline"
                      aria-label={t('suppliers.open', { name: supplier.name })}
                      onClick={() => navigate('suppliers.detail', { supplierId: supplier.id })}
                    >
                      {supplier.name}
                    </button>
                    {!supplier.isActive && (
                      <Badge className="ml-2" tone="neutral">
                        {t('common.archived')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">{supplier.phone ?? '—'}</td>
                  <td className="tabular px-4 py-3 text-right">{supplier.receiptCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Money
                      amount={supplier.balance}
                      className={
                        supplier.balance > 0 ? 'text-warning-soft-foreground font-semibold' : ''
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && (
        <SupplierDialog
          supplier={null}
          onOpenChange={() => setCreating(false)}
          onDone={(supplier) => {
            setCreating(false);
            navigate('suppliers.detail', { supplierId: supplier.id });
          }}
        />
      )}
    </>
  );
}
