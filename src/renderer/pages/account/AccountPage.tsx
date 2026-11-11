import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { ChangePasswordForm } from '../../auth/ChangePasswordForm';
import { formSchemas } from '../../auth/form-schemas';
import { useSubmit } from '../../auth/use-submit';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { FormError, SecretField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { zodResolver } from '../../lib/form';
import { invoke } from '../../lib/ipc';
import { useSession } from '../../stores/session';

function OwnPinForm() {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).ownPin, [t]);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, reset, getValues, trigger } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { pin: '', currentPassword: '' },
  });
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };
  const save = handleSubmit(async ({ pin, currentPassword }) => {
    if (await run(() => invoke('auth:setOwnPin', { currentPassword, pin }).then(() => undefined))) {
      reset();
      toast.success(t('account.pin.saved'));
    }
  });
  const remove = async (): Promise<void> => {
    if (!(await trigger('currentPassword'))) return;
    const currentPassword = getValues('currentPassword');
    if (
      await run(() =>
        invoke('auth:setOwnPin', { currentPassword, pin: null }).then(() => undefined),
      )
    ) {
      reset();
      toast.success(t('account.pin.removed'));
    }
  };
  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <SecretField
          label={t('account.pin.new')}
          inputMode="numeric"
          hint={t('form.pin')}
          error={formState.errors.pin?.message}
          {...secret}
          {...register('pin')}
        />
        <SecretField
          label={t('account.pin.currentPassword')}
          autoComplete="current-password"
          error={formState.errors.currentPassword?.message}
          {...secret}
          {...register('currentPassword')}
        />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {t('account.pin.save')}
        </Button>
        <Button variant="ghost" onClick={() => void remove()}>
          {t('account.pin.remove')}
        </Button>
      </div>
    </form>
  );
}

/** Mon compte : mot de passe et code PIN de caisse de l'utilisateur connecté. */
export function AccountPage() {
  const t = useT();
  const method = useSession((state) => state.session?.method);
  return (
    <>
      <PageHeader title={t('account.title')} description={t('account.description')} />
      {method === 'pin' ? (
        <p className="bg-info-soft text-info-soft-foreground rounded-md px-4 py-3 text-sm font-medium">
          {t('account.pinSession')}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('account.password')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('account.pin')}</CardTitle>
              <CardDescription>{t('account.pin.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <OwnPinForm />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
