import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/button';
import { FormError, SecretField, TextField } from '../components/ui/form-field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/radix';
import { toast } from '../components/ui/toast';
import { useT } from '../i18n';
import { zodResolver } from '../lib/form';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';
import { formSchemas } from './form-schemas';
import { useSubmit } from './use-submit';

function PasswordLoginForm() {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).login, [t]);
  const login = useSession((state) => state.login);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, resetField } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });
  const onSubmit = handleSubmit(async ({ username, password }) => {
    const ok = await run(() => login(username, password));
    if (!ok) resetField('password');
  });
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('login.username')}
        autoComplete="username"
        autoFocus
        error={formState.errors.username?.message}
        {...register('username')}
      />
      <SecretField
        label={t('login.password')}
        autoComplete="current-password"
        showLabel={t('common.showSecret')}
        hideLabel={t('common.hideSecret')}
        error={formState.errors.password?.message}
        {...register('password')}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {t('login.submit')}
      </Button>
    </form>
  );
}

function PinLoginForm() {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).pinLogin, [t]);
  const loginWithPin = useSession((state) => state.loginWithPin);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState, resetField } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { username: '', pin: '' },
  });
  const onSubmit = handleSubmit(async ({ username, pin }) => {
    const ok = await run(() => loginWithPin(username, pin));
    if (!ok) resetField('pin');
  });
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('login.username')}
        autoComplete="username"
        error={formState.errors.username?.message}
        {...register('username')}
      />
      <SecretField
        label={t('login.pin')}
        inputMode="numeric"
        hint={t('login.pinHint')}
        showLabel={t('common.showSecret')}
        hideLabel={t('common.hideSecret')}
        error={formState.errors.pin?.message}
        {...register('pin')}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {t('login.submit')}
      </Button>
    </form>
  );
}

function RecoverAdminForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const schema = useMemo(() => formSchemas(t).recoverAdmin, [t]);
  const recoverAdmin = useSession((state) => state.recoverAdmin);
  const { error, run } = useSubmit();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { username: '', recoveryKey: '', password: '', confirmation: '' },
  });
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };
  const onSubmit = handleSubmit(async ({ username, recoveryKey, password }) => {
    if (await run(() => recoverAdmin(username, recoveryKey, password))) {
      toast.success(t('recover.done'));
      onDone();
    }
  });
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t('recover.username')}
        autoFocus
        error={formState.errors.username?.message}
        {...register('username')}
      />
      <SecretField
        label={t('recover.key')}
        className="font-mono uppercase"
        error={formState.errors.recoveryKey?.message}
        {...secret}
        {...register('recoveryKey')}
      />
      <SecretField
        label={t('recover.newPassword')}
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
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('recover.back')}
        </Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {t('recover.submit')}
        </Button>
      </div>
    </form>
  );
}

export function LoginScreen() {
  const t = useT();
  const [recovering, setRecovering] = useState(false);
  if (recovering) {
    return (
      <AuthLayout title={t('recover.title')} description={t('recover.description')}>
        <RecoverAdminForm onDone={() => setRecovering(false)} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('login.title')}>
      <Tabs defaultValue="password" className="flex flex-col gap-6">
        <TabsList>
          <TabsTrigger value="password">{t('login.tab.password')}</TabsTrigger>
          <TabsTrigger value="pin">{t('login.tab.pin')}</TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <PasswordLoginForm />
        </TabsContent>
        <TabsContent value="pin">
          <PinLoginForm />
        </TabsContent>
      </Tabs>
      <Button variant="ghost" className="self-center" onClick={() => setRecovering(true)}>
        {t('login.forgot')}
      </Button>
    </AuthLayout>
  );
}
