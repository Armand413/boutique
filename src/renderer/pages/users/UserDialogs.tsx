import { useId, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ROLES } from '@shared/permissions';
import type { UserSummary } from '@shared/schemas/auth';
import { formSchemas } from '../../auth/form-schemas';
import { useSubmit } from '../../auth/use-submit';
import { Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SecretField, TextField } from '../../components/ui/form-field';
import { Select, Switch } from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { zodResolver } from '../../lib/form';
import { invoke } from '../../lib/ipc';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function roleOptions(t: Translate) {
  return ROLES.map((role) => ({ value: role, label: t(`role.${role}`) }));
}

export function CreateUserDialog({ open, onOpenChange, onDone }: DialogProps) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).createUser, [t]);
  const roleLabelId = useId();
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, control, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', username: '', role: 'seller' as const, temporaryPassword: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    if (
      await run(async () => {
        await invoke('users:create', values);
      })
    ) {
      toast.success(t('users.created'));
      reset();
      onDone();
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('users.form.createTitle')}</DialogTitle>
          <DialogDescription>{t('users.form.temporaryHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('users.form.fullName')}
            autoFocus
            error={formState.errors.fullName?.message}
            {...register('fullName')}
          />
          <TextField
            label={t('users.form.username')}
            hint={t('form.username')}
            error={formState.errors.username?.message}
            {...register('username')}
          />
          <div className="flex flex-col gap-2">
            <Label id={roleLabelId}>{t('users.form.role')}</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select
                  aria-labelledby={roleLabelId}
                  value={field.value}
                  options={roleOptions(t)}
                  onValueChange={field.onChange}
                />
              )}
            />
          </div>
          <SecretField
            label={t('users.form.temporaryPassword')}
            hint={t('setup.passwordHint')}
            autoComplete="new-password"
            showLabel={t('common.showSecret')}
            hideLabel={t('common.hideSecret')}
            error={formState.errors.temporaryPassword?.message}
            {...register('temporaryPassword')}
          />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  onOpenChange,
  onDone,
}: Omit<DialogProps, 'open'> & { user: UserSummary }) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).editUser, [t]);
  const roleLabelId = useId();
  const activeId = useId();
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, control } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { fullName: user.fullName, role: user.role, isActive: user.isActive },
  });
  const onSubmit = handleSubmit(async (values) => {
    if (
      await run(async () => {
        await invoke('users:update', { id: user.id, ...values });
      })
    ) {
      toast.success(t('users.saved'));
      onDone();
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('users.form.editTitle', { name: user.fullName })}</DialogTitle>
          <DialogDescription>{user.username}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <TextField
            label={t('users.form.fullName')}
            autoFocus
            error={formState.errors.fullName?.message}
            {...register('fullName')}
          />
          <div className="flex flex-col gap-2">
            <Label id={roleLabelId}>{t('users.form.role')}</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select
                  aria-labelledby={roleLabelId}
                  value={field.value}
                  options={roleOptions(t)}
                  onValueChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="flex items-center gap-3">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <Switch id={activeId} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor={activeId}>{t('users.form.active')}</Label>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({
  user,
  onOpenChange,
  onDone,
}: Omit<DialogProps, 'open'> & { user: UserSummary }) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).resetPassword, [t]);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { temporaryPassword: '' },
  });
  const onSubmit = handleSubmit(async ({ temporaryPassword }) => {
    if (
      await run(async () => {
        await invoke('users:resetPassword', { id: user.id, temporaryPassword });
      })
    ) {
      toast.success(t('users.passwordReset'));
      onDone();
    }
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('users.form.resetTitle', { name: user.fullName })}</DialogTitle>
          <DialogDescription>{t('users.form.temporaryHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
          <SecretField
            label={t('users.form.temporaryPassword')}
            hint={t('setup.passwordHint')}
            autoFocus
            autoComplete="new-password"
            showLabel={t('common.showSecret')}
            hideLabel={t('common.hideSecret')}
            error={formState.errors.temporaryPassword?.message}
            {...register('temporaryPassword')}
          />
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
