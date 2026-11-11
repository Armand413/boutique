import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useT } from '../i18n';
import { RestoreDialog } from '../pages/settings/RestoreDialog';

/** Restauration sans session : nouvel ordinateur, base illisible ou clé perdue (4.10, B.7). */
export function RestoreBackupButton({ hint = false }: { hint?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      {hint && <p className="text-muted-foreground text-sm">{t('restore.fromSetup')}</p>}
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" />
        {t('backup.restore')}
      </Button>
      {open && <RestoreDialog mode="system" onClose={() => setOpen(false)} />}
    </div>
  );
}
