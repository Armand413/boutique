import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Lock } from 'lucide-react';
import type { SessionInfo } from '@shared/schemas/auth';
import { Button } from '../components/ui/button';
import { FormError, SecretField } from '../components/ui/form-field';
import { useT } from '../i18n';
import { zodResolver } from '../lib/form';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';
import { formSchemas } from './form-schemas';
import { useSubmit } from './use-submit';

/** Verrouillage (inactivité ou demande) : même utilisateur, même méthode, ou changement d'utilisateur. */
export function LockScreen({ session }: { session: SessionInfo }) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).unlock, [t]);
  const unlock = useSession((state) => state.unlock);
  const logout = useSession((state) => state.logout);
  const refresh = useSession((state) => state.refresh);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, resetField } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { secret: '' },
  });
  const isPin = session.method === 'pin';
  const onSubmit = handleSubmit(async ({ secret }) => {
    if (!(await run(() => unlock(secret)))) {
      resetField('secret');
      await refresh();
    }
  });
  return (
    <AuthLayout
      title={t('lock.title')}
      description={t(isPin ? 'lock.description.pin' : 'lock.description.password', {
        name: session.user.fullName,
      })}
    >
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <SecretField
          label={t(isPin ? 'login.pin' : 'login.password')}
          autoFocus
          {...(isPin ? { inputMode: 'numeric' as const } : { autoComplete: 'current-password' })}
          showLabel={t('common.showSecret')}
          hideLabel={t('common.hideSecret')}
          error={formState.errors.secret?.message}
          {...register('secret')}
        />
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          <Lock aria-hidden="true" />
          {t('lock.submit')}
        </Button>
      </form>
      <Button variant="ghost" className="self-center" onClick={() => void logout()}>
        {t('lock.switchUser')}
      </Button>
    </AuthLayout>
  );
}
