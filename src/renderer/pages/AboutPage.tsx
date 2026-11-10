import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc/contract';
import { ErrorState, LoadingState } from '../components/states/states';
import { Badge, Card, CardContent } from '../components/ui/basic';
import { useT } from '../i18n';
import { PageHeader } from '../layout/AppShell';
import { errorMessage, invoke } from '../lib/ipc';

type State =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; info: AppInfo };

export function AboutPage() {
  const t = useT();
  const [state, setState] = useState<State>({ status: 'loading' });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    invoke('app:getInfo').then(
      (info) => {
        if (active) setState({ status: 'ready', info });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = (): void => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  };

  return (
    <>
      <PageHeader title={t('about.title')} description={t('about.description')} />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('state.about.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={retry}
        />
      )}
      {state.status === 'ready' && (
        <Card>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-[12rem_1fr] gap-x-6 gap-y-4 text-base">
              <dt className="text-muted-foreground">{t('about.version')}</dt>
              <dd className="tabular font-semibold">{state.info.version}</dd>
              <dt className="text-muted-foreground">{t('about.mode')}</dt>
              <dd>
                <Badge tone={state.info.isPackaged ? 'success' : 'info'}>
                  {t(state.info.isPackaged ? 'about.mode.packaged' : 'about.mode.development')}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">{t('about.electron')}</dt>
              <dd className="tabular">{state.info.electron}</dd>
              <dt className="text-muted-foreground">{t('about.chrome')}</dt>
              <dd className="tabular">{state.info.chrome}</dd>
              <dt className="text-muted-foreground">{t('about.node')}</dt>
              <dd className="tabular">{state.info.node}</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </>
  );
}
