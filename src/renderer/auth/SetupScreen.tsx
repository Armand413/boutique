import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/button';
import { FormError, SecretField, TextField } from '../components/ui/form-field';
import { useT } from '../i18n';
import { zodResolver } from '../lib/form';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';
import { formSchemas } from './form-schemas';
import { useSubmit } from './use-submit';

/** Assistant de premier lancement : boutique et compte administrateur (aucun mot de passe par défaut). */
export function SetupScreen() {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).setup, [t]);
  const completeSetup = useSession((state) => state.completeSetup);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { shopName: '', fullName: '', username: '', password: '', confirmation: '' },
  });
  const errors = formState.errors;
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };

  const onSubmit = handleSubmit(async (values) => {
    await run(() =>
      completeSetup({
        shopName: values.shopName,
        fullName: values.fullName,
        username: values.username,
        password: values.password,
      }),
    );
  });

  return (
    <AuthLayout title={t('setup.title')} description={t('setup.description')} wide>
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <TextField
          label={t('setup.shopName')}
          autoFocus
          error={errors.shopName?.message}
          {...register('shopName')}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('setup.fullName')}
            error={errors.fullName?.message}
            {...register('fullName')}
          />
          <TextField
            label={t('setup.username')}
            hint={t('form.username')}
            autoComplete="username"
            error={errors.username?.message}
            {...register('username')}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <SecretField
            label={t('setup.password')}
            hint={t('setup.passwordHint')}
            autoComplete="new-password"
            error={errors.password?.message}
            {...secret}
            {...register('password')}
          />
          <SecretField
            label={t('setup.passwordConfirm')}
            autoComplete="new-password"
            error={errors.confirmation?.message}
            {...secret}
            {...register('confirmation')}
          />
        </div>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {t('setup.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
