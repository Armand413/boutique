import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { LoadingState } from '../components/states/states';
import { Toaster } from '../components/ui/toast';
import { TooltipProvider } from '../components/ui/radix';
import { useT } from '../i18n';
import { AppShell } from '../layout/AppShell';
import { AboutPage } from '../pages/AboutPage';
import { AppearancePage } from '../pages/settings/AppearancePage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { usePreferences } from '../stores/preferences';
import { useRouter } from '../stores/router';
import { ThemeProvider } from '../theme/ThemeProvider';
import type { RouteName } from './routes';

/** La galerie n'existe qu'en développement : en production, ce bloc est éliminé du bundle. */
const DevGallery: ComponentType | null = import.meta.env.DEV
  ? lazy(() => import('../dev/ComponentGallery'))
  : null;

const PAGES: Readonly<Record<Exclude<RouteName, 'dev.gallery'>, ComponentType>> = {
  settings: SettingsPage,
  'settings.appearance': AppearancePage,
  about: AboutPage,
};

function CurrentPage() {
  const t = useT();
  const current = useRouter((state) => state.current);
  if (current === 'dev.gallery') {
    if (DevGallery === null) return null;
    return (
      <Suspense fallback={<LoadingState label={t('state.loading')} />}>
        <DevGallery />
      </Suspense>
    );
  }
  const Page = PAGES[current];
  return <Page />;
}

export function App() {
  const t = useT();
  const load = usePreferences((state) => state.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <AppShell>
          <CurrentPage />
        </AppShell>
        <Toaster regionLabel={t('common.notifications')} closeLabel={t('common.close')} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
