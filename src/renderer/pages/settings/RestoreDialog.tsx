import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import type { BackupPreview } from '@shared/schemas/backup';
import { Button } from '../../components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SecretField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useSession } from '../../stores/session';

/**
 * Restauration guidée (4.10) : choix du fichier (par le processus principal), aperçu, mot de passe
 * de la sauvegarde, confirmation. `system` : sans session (installation, base illisible) ;
 * `settings` : depuis les paramètres, avec le mot de passe de l'utilisateur connecté.
 */
export function RestoreDialog({
  mode,
  onClose,
}: {
  mode: 'system' | 'settings';
  onClose: () => void;
}) {
  const t = useT();
  const refresh = useSession((state) => state.refresh);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const secret = { showLabel: t('common.showSecret'), hideLabel: t('common.hideSecret') };

  const choose = async () => {
    setError(null);
    try {
      const chosen = await invoke(mode === 'system' ? 'system:chooseBackup' : 'backup:choose');
      if (chosen !== null) setPreview(chosen);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const restore = async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    const input = {
      token: preview.token,
      password,
      currentPassword: mode === 'settings' ? current : null,
    };
    try {
      await invoke(mode === 'system' ? 'system:restoreBackup' : 'backup:restore', input);
      toast.success(t('restore.done'));
      onClose();
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      // Un jeton ne sert qu'une fois : il faut rechoisir le fichier après un échec.
      setPreview(null);
    }
    setBusy(false);
  };
  const ready =
    preview !== null &&
    preview.compatible &&
    password !== '' &&
    (mode === 'system' || current !== '');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('restore.title')}</DialogTitle>
          <DialogDescription>{t('restore.description')}</DialogDescription>
        </DialogHeader>
        <Button variant="secondary" onClick={() => void choose()}>
          <FolderOpen aria-hidden="true" />
          {t('restore.choose')}
        </Button>
        {preview !== null && (
          <div className="bg-muted flex flex-col gap-1 rounded-md px-4 py-3 text-sm">
            <p className="font-medium">{t('restore.file', { name: preview.fileName })}</p>
            <p>
              {t('restore.details', {
                date: formatDateTime(preview.createdAt),
                shop: preview.shopName === '' ? '—' : preview.shopName,
                version: preview.appVersion,
              })}{' '}
              ({t(`restore.kind.${preview.kind}`)})
            </p>
          </div>
        )}
        {preview !== null && !preview.compatible && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-foreground rounded-md px-4 py-3 text-sm font-medium"
          >
            {t('restore.incompatible')}
          </p>
        )}
        {preview !== null && preview.compatible && (
          <>
            <SecretField
              label={t('restore.password')}
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...secret}
            />
            {mode === 'settings' && (
              <SecretField
                label={t('restore.currentPassword')}
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                {...secret}
              />
            )}
            <p className="text-warning-soft-foreground bg-warning-soft rounded-md px-4 py-3 text-sm">
              {t('restore.warning')}
            </p>
          </>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={!ready || busy} onClick={() => setConfirming(true)}>
            {t('restore.confirm')}
          </Button>
        </DialogFooter>
        {confirming && (
          <ConfirmDialog
            open
            tone="danger"
            title={t('restore.confirmTitle')}
            description={t('restore.confirmDescription')}
            confirmLabel={t('restore.confirm')}
            cancelLabel={t('common.cancel')}
            onOpenChange={(open) => !open && setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void restore();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
