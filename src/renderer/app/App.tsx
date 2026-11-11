import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { ShieldAlert, ShieldX } from 'lucide-react';
import { AppGate } from '../auth/AppGate';
import { EmptyState, LoadingState } from '../components/states/states';
import { Toaster } from '../components/ui/toast';
import { TooltipProvider } from '../components/ui/radix';
import { useT } from '../i18n';
import { AppShell } from '../layout/AppShell';
import { AboutPage } from '../pages/AboutPage';
import { AccountPage } from '../pages/account/AccountPage';
import { AuditPage } from '../pages/audit/AuditPage';
import { AppearancePage } from '../pages/settings/AppearancePage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { UsersPage } from '../pages/users/UsersPage';
import { usePreferences } from '../stores/preferences';
import { useRouter } from '../stores/router';
import { useSession } from '../stores/session';
import { ThemeProvider } from '../theme/ThemeProvider';
import { routePermission } from './modules';
import { breadcrumbOf, type RouteName } from './routes';

/** La galerie n'existe qu'en développement : en production, ce bloc est éliminé du bundle. */
const DevGallery: ComponentType | null = import.meta.env.DEV
  ? lazy(() => import('../dev/ComponentGallery'))
  : null;

const PAGES: Readonly<Record<Exclude<RouteName, 'dev.gallery'>, ComponentType>> = {
  settings: SettingsPage,
  'settings.appearance': AppearancePage,
  about: AboutPage,
  users: UsersPage,
  audit: AuditPage,
  account: AccountPage,
};

/** Écran refusé si la session n'a pas la permission (le service le refuserait aussi). */
function useRouteAllowed(route: RouteName): boolean {
  const permissions = useSession((state) => state.session?.permissions);
  const top = breadcrumbOf(route)[0] ?? route;
  const required = routePermission(top);
  return required === undefined || (permissions ?? []).includes(required);
}

function CurrentPage() {
  const t = useT();
  const current = useRouter((state) => state.current);
  const allowed = useRouteAllowed(current);
  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldX}
        title={t('state.forbidden.title')}
        description={t('state.forbidden.description')}
      />
    );
  }
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

/** Chaque nouvel utilisateur repart de l'écran d'accueil (aucun écran hérité du précédent). */
function useResetRouterOnUserChange(): void {
  const userId = useSession((state) => state.session?.user.id ?? null);
  const reset = useRouter((state) => state.reset);
  useEffect(() => {
    reset();
  }, [userId, reset]);
}

function AuditAlert() {
  const t = useT();
  const broken = useSession(
    (state) => state.status?.state === 'ready' && state.status.auditChainBroken,
  );
  const canView = useSession((state) => state.session?.permissions.includes('audit.view') ?? false);
  if (!broken || !canView) return null;
  return (
    <p
      role="alert"
      className="bg-danger-soft text-danger-soft-foreground flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium"
    >
      <ShieldAlert className="size-5" aria-hidden="true" />
      {t('alert.auditBroken')}
    </p>
  );
}

function AuthenticatedApp() {
  useResetRouterOnUserChange();
  return (
    <AppShell>
      <AuditAlert />
      <CurrentPage />
    </AppShell>
  );
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
        <AppGate>
          <AuthenticatedApp />
        </AppGate>
        <Toaster regionLabel={t('common.notifications')} closeLabel={t('common.close')} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
