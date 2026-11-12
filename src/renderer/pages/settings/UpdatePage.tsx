import { useState } from 'react';
import { FolderOpen, PackageCheck, ShieldX } from 'lucide-react';
import type { UpdatePreview } from '@shared/schemas/update';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { CheckboxField, FormError, SecretField } from '../../components/ui/form-field';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useCan } from '../products/catalog-ui';

function PreviewCard({ preview }: { preview: UpdatePreview }) {
  const t = useT();
  const tone = { ready: 'success', unsigned: 'warning', refused: 'danger' } as const;
  return (
    <div className="bg-muted flex flex-col gap-2 rounded-md px-4 py-3 text-sm">
      <p className="font-medium">{t('update.file', { name: preview.fileName })}</p>
      <p>{t('update.versions', { version: preview.version, current: preview.currentVersion })}</p>
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={tone[preview.verdict]}>{t(`update.signature.${preview.signature}`)}</Badge>
        {preview.signer !== null && (
          <span className="text-muted-foreground break-all">{preview.signer}</span>
        )}
      </p>
      {preview.reason !== null && (
        <p
          role="alert"
          className={
            preview.verdict === 'refused'
              ? 'bg-danger-soft text-danger-soft-foreground rounded-md px-4 py-3 font-medium'
              : 'bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 font-medium'
          }
        >
          {preview.reason}
        </p>
      )}
    </div>
  );
}

function InstallCard({ currentVersion }: { currentVersion: string }) {
  const t = useT();
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [password, setPassword] = useState('');
  const [acceptUnsigned, setAcceptUnsigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [started, setStarted] = useState(false);
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };

  const choose = async () => {
    setError(null);
    setBusy(true);
    try {
      const chosen = await invoke('update:choose');
      if (chosen !== null) {
        setPreview(chosen);
        setAcceptUnsigned(false);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  };
  const install = async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('update:install', {
        token: preview.token,
        currentPassword: password,
        acceptUnsigned,
      });
      setStarted(true);
    } catch (failure) {
      setError(errorMessage(failure));
      // Un jeton ne sert qu'une fois : il faut rechoisir le fichier après un échec.
      setPreview(null);
      setBusy(false);
    }
  };
  const ready =
    preview !== null &&
    preview.verdict !== 'refused' &&
    (preview.verdict === 'ready' || acceptUnsigned) &&
    password !== '' &&
    !busy;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('update.install.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p>{t('update.current', { version: currentVersion })}</p>
        <p className="text-muted-foreground">{t('update.install.description')}</p>
        <div>
          <Button variant="secondary" disabled={busy || started} onClick={() => void choose()}>
            <FolderOpen aria-hidden="true" />
            {t('update.choose')}
          </Button>
        </div>
        {preview !== null && <PreviewCard preview={preview} />}
        {preview !== null && preview.verdict !== 'refused' && !started && (
          <>
            {preview.verdict === 'unsigned' && (
              <CheckboxField
                label={t('update.acceptUnsigned')}
                checked={acceptUnsigned}
                onChange={(event) => setAcceptUnsigned(event.target.checked)}
              />
            )}
            <SecretField
              label={t('update.password')}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...secret}
            />
            <p className="bg-info-soft text-info-soft-foreground rounded-md px-4 py-3">
              {t('update.warning')}
            </p>
            <div>
              <Button disabled={!ready} onClick={() => setConfirming(true)}>
                <PackageCheck aria-hidden="true" />
                {t('update.confirm')}
              </Button>
            </div>
          </>
        )}
        {started && (
          <p
            role="status"
            className="bg-success-soft text-success-soft-foreground rounded-md px-4 py-3"
          >
            {t('update.started')}
          </p>
        )}
        <FormError message={error} />
        {confirming && (
          <ConfirmDialog
            open
            tone="primary"
            title={t('update.confirmTitle')}
            description={t('update.confirmDescription')}
            confirmLabel={t('update.confirm')}
            cancelLabel={t('common.cancel')}
            onOpenChange={(open) => !open && setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void install();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RollbackCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('update.rollback.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{t('update.rollback.step1')}</p>
        <p>{t('update.rollback.step2')}</p>
        <p className="text-muted-foreground">{t('update.rollback.note')}</p>
      </CardContent>
    </Card>
  );
}

/** Mise à jour (9, B.6 ; D82) : nouveau setup.exe choisi sur une clé USB, vérifié avant installation. */
export function UpdatePage() {
  const t = useT();
  const allowed = useCan('settings.manage');
  const { state, reload } = useRemote(() => invoke('app:getInfo'));
  const header = (
    <PageHeader title={t('nav.settings.update')} description={t('settings.update.description')} />
  );
  if (!allowed) {
    return (
      <>
        {header}
        <EmptyState
          icon={ShieldX}
          title={t('state.forbidden.title')}
          description={t('settings.forbidden')}
        />
      </>
    );
  }
  return (
    <>
      {header}
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={3} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('settings.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <InstallCard currentVersion={state.data.version} />
          <RollbackCard />
        </div>
      )}
    </>
  );
}
