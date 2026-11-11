import { useState } from 'react';
import { FileUp } from 'lucide-react';
import type { ImportAnalysis } from '@shared/schemas/catalog';
import { useSubmit } from '../../auth/use-submit';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';

/**
 * Import du catalogue en deux temps : analyse du fichier (rien n'est enregistré), puis confirmation.
 * Le fichier est choisi par le processus principal : l'interface ne lit jamais le disque.
 */
export function ImportDialog({
  onOpenChange,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const { error, run, submit } = useSubmit();
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (): Promise<void> => {
    setBusy(true);
    await run(async () => {
      const result = await invoke('catalog:importAnalyze');
      if (result.fileName !== '') setAnalysis(result);
    });
    setBusy(false);
  };
  const commit = async (token: string): Promise<void> => {
    setBusy(true);
    const done = await submit(() => invoke('catalog:importCommit', { token }));
    setBusy(false);
    if (done !== null) {
      const { products, variants } = done.value;
      toast.success(t('import.done', { products, variants }));
      onDone();
    }
  };

  const pendingToken = analysis?.token ?? null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('import.templateHint')}</p>
        {busy && (
          <p role="status" className="text-sm">
            {t('import.analyzing')}
          </p>
        )}
        {analysis !== null && analysis.errors.length === 0 && (
          <p
            role="status"
            className="bg-success-soft text-success-soft-foreground rounded-md px-4 py-3 text-sm font-medium"
          >
            {t('import.ready', {
              file: analysis.fileName,
              products: analysis.productCount,
              variants: analysis.variantCount,
            })}
          </p>
        )}
        {analysis !== null && analysis.errors.length > 0 && (
          <div role="alert" className="flex flex-col gap-2">
            <p className="bg-danger-soft text-danger-soft-foreground rounded-md px-4 py-3 text-sm font-medium">
              {t('import.errors', { file: analysis.fileName, count: analysis.errors.length })}
            </p>
            <ul className="border-border max-h-60 overflow-y-auto rounded-md border text-sm">
              {analysis.errors.map((issue, index) => (
                <li
                  key={`${String(issue.row)}-${String(index)}`}
                  className="border-border flex gap-3 border-t px-3 py-2 first:border-t-0"
                >
                  <span className="tabular w-20 shrink-0 font-medium">
                    {t('import.errorRow', { row: issue.row })}
                  </span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={pendingToken === null ? 'primary' : 'secondary'}
            onClick={() => void choose()}
            disabled={busy}
          >
            <FileUp aria-hidden="true" />
            {t('import.choose')}
          </Button>
          {analysis !== null && pendingToken !== null && (
            <Button onClick={() => void commit(pendingToken)} disabled={busy}>
              {t('import.confirm', { products: analysis.productCount })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
