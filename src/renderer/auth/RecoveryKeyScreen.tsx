import { useId, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useT } from '../i18n';
import { useSession } from '../stores/session';
import { AuthLayout } from './AuthLayout';

/** Affichage unique de la clé de récupération, avec confirmation qu'elle a été recopiée. */
export function RecoveryKeyScreen({ recoveryKey }: { recoveryKey: string }) {
  const t = useT();
  const acknowledge = useSession((state) => state.acknowledgeRecoveryKey);
  const [confirmed, setConfirmed] = useState(false);
  const checkboxId = useId();
  const keyLabelId = useId();

  return (
    <AuthLayout title={t('recoveryKey.title')} description={t('recoveryKey.description')} wide>
      <div className="flex flex-col gap-2">
        <p id={keyLabelId} className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" aria-hidden="true" />
          {t('recoveryKey.label')}
        </p>
        <output
          aria-labelledby={keyLabelId}
          data-testid="recovery-key"
          className="border-primary bg-primary-soft text-primary-soft-foreground rounded-lg border-2 px-4 py-4 text-center font-mono text-2xl tracking-wider select-all"
        >
          {recoveryKey}
        </output>
      </div>
      <p className="bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 text-sm font-medium">
        {t('recoveryKey.instructions')}
      </p>
      <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-3 text-base">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="accent-primary size-5"
        />
        {t('recoveryKey.confirm')}
      </label>
      <Button size="lg" disabled={!confirmed} onClick={acknowledge}>
        {t('recoveryKey.continue')}
      </Button>
    </AuthLayout>
  );
}
