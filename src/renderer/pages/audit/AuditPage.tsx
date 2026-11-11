import { useCallback, useState } from 'react';
import { ScrollText, ShieldCheck, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import type { AuditEntry, AuditVerification } from '@shared/schemas/auth';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Card } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import type { TranslationKey } from '../../i18n/fr';
import { fr } from '../../i18n/fr';
import { PageHeader } from '../../layout/AppShell';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';

const PAGE_SIZE = 50;

function actionLabel(t: Translate, action: string): string {
  const key = `audit.action.${action}`;
  return key in fr ? t(key as TranslationKey) : action;
}

/** Détails lisibles, sans structure JSON brute (les valeurs sont échappées par React). */
function detailsText(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key} : ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

function VerificationResult({ result }: { result: AuditVerification }) {
  const t = useT();
  const Icon = result.ok ? ShieldCheck : ShieldAlert;
  return (
    <p
      role="status"
      className={
        result.ok
          ? 'bg-success-soft text-success-soft-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium'
          : 'bg-danger-soft text-danger-soft-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium'
      }
    >
      <Icon className="size-5" aria-hidden="true" />
      {result.ok
        ? t('audit.verify.ok', { count: result.checked })
        : t('audit.verify.broken', { id: result.brokenAtId ?? 0 })}
    </p>
  );
}

/** Journal d'audit (B.4) : consultation paginée et vérification de la chaîne d'empreintes. */
export function AuditPage() {
  const t = useT();
  const loader = useCallback(() => invoke('audit:list', { limit: PAGE_SIZE }), []);
  const { state, reload } = useRemote(loader);
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [verification, setVerification] = useState<AuditVerification | null>(null);

  const entries = state.status === 'ready' ? [...state.data, ...older] : [];

  const loadMore = async (): Promise<void> => {
    const last = entries.at(-1);
    if (last === undefined) return;
    try {
      const next = await invoke('audit:list', { limit: PAGE_SIZE, beforeId: last.id });
      setOlder((previous) => [...previous, ...next]);
      if (next.length < PAGE_SIZE) setExhausted(true);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const verify = async (): Promise<void> => {
    try {
      setVerification(await invoke('audit:verify'));
      setOlder([]);
      setExhausted(false);
      reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.description')}
        actions={
          <Button variant="secondary" onClick={() => void verify()}>
            <ShieldCheck aria-hidden="true" />
            {t('audit.verify')}
          </Button>
        }
      />
      {verification !== null && <VerificationResult result={verification} />}
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={6} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('audit.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && entries.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title={t('audit.empty')}
          description={t('audit.description')}
        />
      )}
      {state.status === 'ready' && entries.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('audit.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('audit.col.user')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('audit.col.action')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('audit.col.details')}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-border border-t align-top">
                  <td className="tabular px-4 py-2 whitespace-nowrap">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2">{entry.username ?? t('audit.system')}</td>
                  <td className="px-4 py-2 font-medium">{actionLabel(t, entry.action)}</td>
                  <td className="text-muted-foreground px-4 py-2 break-all">
                    {detailsText(entry.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {state.status === 'ready' && entries.length >= PAGE_SIZE && !exhausted && (
        <Button variant="secondary" className="self-center" onClick={() => void loadMore()}>
          {t('audit.more')}
        </Button>
      )}
    </>
  );
}
