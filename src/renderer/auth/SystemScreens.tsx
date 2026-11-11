import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { CircleAlert } from 'lucide-react';
import { Button } from '../components/ui/button';
import { FormError, SecretField } from '../components/ui/form-field';
import { useT } from '../i18n';
import { zodResolver } from '../lib/form';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';
import { formSchemas } from './form-schemas';
import { useSubmit } from './use-submit';

/** Base illisible sur ce compte Windows : la clé de récupération rouvre la base (séquestre). */
export function DatabaseLockedScreen() {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).recoveryKey, [t]);
  const unlockDatabase = useSession((state) => state.unlockDatabase);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { recoveryKey: '' },
  });
  const onSubmit = handleSubmit(async ({ recoveryKey }) => {
    await run(() => unlockDatabase(recoveryKey));
  });
  return (
    <AuthLayout title={t('dbLocked.title')} description={t('dbLocked.description')}>
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
        <SecretField
          label={t('recoveryKey.label')}
          autoFocus
          className="font-mono uppercase"
          showLabel={t('common.showSecret')}
          hideLabel={t('common.hideSecret')}
          error={formState.errors.recoveryKey?.message}
          {...register('recoveryKey')}
        />
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {t('dbLocked.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Erreur bloquante au démarrage (intégrité, migration, clé) : message clair et solution. */
export function FatalScreen({ message }: { message: string }) {
  const t = useT();
  const refresh = useSession((state) => state.refresh);
  return (
    <AuthLayout title={t('fatal.title')}>
      <div role="alert" className="flex gap-3">
        <CircleAlert className="text-danger mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium">{message}</p>
          <p className="text-muted-foreground text-sm">{t('fatal.solution')}</p>
        </div>
      </div>
      <Button variant="secondary" onClick={() => void refresh()}>
        {t('fatal.retry')}
      </Button>
    </AuthLayout>
  );
}
