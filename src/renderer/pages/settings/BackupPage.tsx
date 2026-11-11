import { useCallback, useState } from 'react';
import { HardDriveDownload, History, KeyRound, RotateCcw, ShieldX } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import type { BackupStatus } from '@shared/schemas/backup';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormError, SecretField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useCan } from '../products/catalog-ui';
import { RestoreDialog } from './RestoreDialog';
import { intOrNull } from './settings-ui';

function size(bytes: number): string {
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`;
  return `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

function StatusCard({
  status,
  onBackup,
  busy,
}: {
  status: BackupStatus;
  onBackup: () => void;
  busy: boolean;
}) {
  const t = useT();
  const when = (date: string | null) => (date === null ? t('backup.never') : formatDateTime(date));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <CardTitle>{t('backup.status')}</CardTitle>
        <Button disabled={!status.passwordSet || busy} onClick={onBackup}>
          <HardDriveDownload aria-hidden="true" />
          {t('backup.now')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!status.passwordSet && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-foreground rounded-md px-4 py-3 font-medium"
          >
            {t('backup.passwordMissing')}
          </p>
        )}
        {status.passwordSet && status.reminderDue && (
          <p
            role="alert"
            className="bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 font-medium"
          >
            {t('backup.reminder', { days: status.reminderDays })}
          </p>
        )}
        <p>{t('backup.lastAuto', { date: when(status.lastAuto) })}</p>
        <p>{t('backup.lastManual', { date: when(status.lastManual) })}</p>
        <p className="text-muted-foreground break-all">
          {t('backup.folder', { folder: status.autoDirectory })}
        </p>
      </CardContent>
    </Card>
  );
}

function PasswordCard({
  status,
  onSaved,
}: {
  status: BackupStatus;
  onSaved: (next: BackupStatus) => void;
}) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };
  const save = async () => {
    if (password !== confirm) {
      setError(t('backup.passwordMismatch'));
      return;
    }
    try {
      onSaved(await invoke('backup:setPassword', { currentPassword: current, password }));
      toast.success(t('backup.passwordSaved'));
      setCurrent('');
      setPassword('');
      setConfirm('');
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden="true" />
          {t('backup.password')}
          {status.passwordSet && <Badge tone="success">{t('backup.passwordSet')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{t('backup.passwordHint')}</p>
        <SecretField
          label={t('backup.currentPassword')}
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          {...secret}
        />
        <SecretField
          label={t('backup.newPassword')}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          {...secret}
        />
        <SecretField
          label={t('backup.confirmPassword')}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          {...secret}
        />
        <FormError message={error} />
        <div className="flex justify-end">
          <Button
            disabled={current === '' || password === '' || confirm === ''}
            onClick={() => void save()}
          >
            {t('backup.passwordSave')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AutoCard({
  status,
  onSaved,
}: {
  status: BackupStatus;
  onSaved: (next: BackupStatus) => void;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(status.autoEnabled);
  const [keep, setKeep] = useState(String(status.keep));
  const [reminder, setReminder] = useState(String(status.reminderDays));
  const keepValue = intOrNull(keep, 1, 60);
  const reminderValue = intOrNull(reminder, 1, 90);
  const save = async () => {
    if (keepValue === null || reminderValue === null) return;
    try {
      onSaved(
        await invoke('backup:saveSettings', {
          autoEnabled: enabled,
          keep: keepValue,
          reminderDays: reminderValue,
        }),
      );
      toast.success(t('settings.saved'));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('backup.settings')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CheckboxField
          label={t('backup.autoEnabled')}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('backup.keep')}
            inputMode="numeric"
            value={keep}
            onChange={(event) => setKeep(event.target.value)}
          />
          <TextField
            label={t('backup.reminderDays')}
            inputMode="numeric"
            value={reminder}
            onChange={(event) => setReminder(event.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button
            disabled={keepValue === null || reminderValue === null}
            onClick={() => void save()}
          >
            {t('settings.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ status }: { status: BackupStatus }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5" aria-hidden="true" />
          {t('backup.history')}
        </CardTitle>
      </CardHeader>
      {status.history.length === 0 ? (
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('backup.noHistory')}</p>
        </CardContent>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('backup.col.date')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('backup.col.type')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('backup.col.file')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('backup.col.size')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('backup.col.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {status.history.map((item) => (
              <tr key={item.id} className="border-border border-t">
                <td className="tabular px-4 py-3">{formatDateTime(item.createdAt)}</td>
                <td className="px-4 py-3">{t(`backup.type.${item.type}`)}</td>
                <td className="px-4 py-3 font-mono text-xs break-all">{item.fileName}</td>
                <td className="tabular px-4 py-3 text-right">{size(item.sizeBytes)}</td>
                <td className="px-4 py-3">
                  <Badge tone={item.status === 'success' ? 'success' : 'danger'}>
                    {t(`backup.status.${item.status}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Sauvegardes (4.10, B.7) : état, mot de passe, copie externe, réglages, historique, restauration. */
export function BackupPage() {
  const t = useT();
  const allowed = useCan('backup.manage');
  const loader = useCallback(
    () => (allowed ? invoke('backup:status') : Promise.reject(new Error(t('settings.forbidden')))),
    [allowed, t],
  );
  const { state, reload } = useRemote<BackupStatus>(loader);
  const [override, setOverride] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const header = (
    <PageHeader
      title={t('nav.settings.backup')}
      description={t('settings.backup.description')}
      actions={
        allowed ? (
          <Button variant="secondary" onClick={() => setRestoring(true)}>
            <RotateCcw aria-hidden="true" />
            {t('backup.restore')}
          </Button>
        ) : undefined
      }
    />
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
  const backupNow = async () => {
    setBusy(true);
    try {
      if ((await invoke('backup:run')).saved) {
        toast.success(t('backup.done'));
        setOverride(null);
        reload();
      }
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
    setBusy(false);
  };
  const status = override ?? (state.status === 'ready' ? state.data : null);
  return (
    <>
      {header}
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('settings.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {status !== null && (
        <div className="grid gap-4 xl:grid-cols-2">
          <StatusCard status={status} busy={busy} onBackup={() => void backupNow()} />
          <PasswordCard status={status} onSaved={setOverride} />
          <AutoCard status={status} onSaved={setOverride} />
          <HistoryCard status={status} />
        </div>
      )}
      {restoring && <RestoreDialog mode="settings" onClose={() => setRestoring(false)} />}
    </>
  );
}
