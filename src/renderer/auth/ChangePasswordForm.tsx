import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/button';
import { FormError, SecretField } from '../components/ui/form-field';
import { toast } from '../components/ui/toast';
import { useT } from '../i18n';
import { zodResolver } from '../lib/form';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';
import { formSchemas } from './form-schemas';
import { useSubmit } from './use-submit';

export function ChangePasswordForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).changePassword, [t]);
  const changePassword = useSession((state) => state.changePassword);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', password: '', confirmation: '' },
  });
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };
  const onSubmit = handleSubmit(async ({ currentPassword, password }) => {
    if (await run(() => changePassword(currentPassword, password))) {
      reset();
      toast.success(t('changePassword.done'));
    }
  });
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <SecretField
        label={t('changePassword.current')}
        autoComplete="current-password"
        autoFocus={autoFocus}
        error={formState.errors.currentPassword?.message}
        {...secret}
        {...register('currentPassword')}
      />
      <SecretField
        label={t('changePassword.new')}
        hint={t('setup.passwordHint')}
        autoComplete="new-password"
        error={formState.errors.password?.message}
        {...secret}
        {...register('password')}
      />
      <SecretField
        label={t('changePassword.confirm')}
        autoComplete="new-password"
        error={formState.errors.confirmation?.message}
        {...secret}
        {...register('confirmation')}
      />
      <FormError message={error} />
      <Button type="submit" disabled={formState.isSubmitting} className="self-start">
        {t('changePassword.submit')}
      </Button>
    </form>
  );
}

/** Changement imposé d'un mot de passe provisoire, avant tout accès à l'application. */
export function ForcedPasswordChangeScreen() {
  const t = useT();
  const logout = useSession((state) => state.logout);
  return (
    <AuthLayout title={t('changePassword.title')} description={t('changePassword.forced')}>
      <ChangePasswordForm autoFocus />
      <Button variant="ghost" className="self-center" onClick={() => void logout()}>
        {t('user.logout')}
      </Button>
    </AuthLayout>
  );
}
