import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { ShieldAlert, ShieldX } from 'lucide-react';
import { AppGate } from '../auth/AppGate';
import { EmptyState, LoadingState } from '../components/states/states';
import { Toaster } from '../components/ui/toast';
import { TooltipProvider } from '../components/ui/radix';
import { translate, useT } from '../i18n';
import { AppShell } from '../layout/AppShell';
import { AboutPage } from '../pages/AboutPage';
import { AccountPage } from '../pages/account/AccountPage';
import { AuditPage } from '../pages/audit/AuditPage';
import { AppearancePage } from '../pages/settings/AppearancePage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { UsersPage } from '../pages/users/UsersPage';
import { BrandsPage } from '../pages/products/BrandsPage';
import { CategoriesPage } from '../pages/products/CategoriesPage';
import { ProductDetailPage } from '../pages/products/ProductDetailPage';
import { ProductsPage } from '../pages/products/ProductsPage';
import { LocationsPage } from '../pages/stock/LocationsPage';
import { ReceiptPage } from '../pages/stock/ReceiptPage';
import { StockPage } from '../pages/stock/StockPage';
import { SupplierDetailPage } from '../pages/suppliers/SupplierDetailPage';
import { SuppliersPage } from '../pages/suppliers/SuppliersPage';
import { CustomerDetailPage, CustomersPage } from '../pages/customers/CustomersPage';
import { DeliveriesPage, InstallmentsPage } from '../pages/followups/FollowupPages';
import { PosPage } from '../pages/pos/PosPage';
import { QuoteEditorPage, QuotesPage } from '../pages/quotes/QuotesPage';
import { SaleDetailPage } from '../pages/sales/SaleDetailPage';
import { SalesPage } from '../pages/sales/SalesPage';
import { InventoriesPage, InventoryDetailPage } from '../pages/inventory/InventoryPages';
import { WarrantyPage } from '../pages/warranty/WarrantyPage';
import { toast } from '../components/ui/toast';
import { errorMessage, invoke } from '../lib/ipc';
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
  products: ProductsPage,
  'products.detail': ProductDetailPage,
  'products.categories': CategoriesPage,
  'products.brands': BrandsPage,
  stock: StockPage,
  'stock.receipt': ReceiptPage,
  'stock.locations': LocationsPage,
  suppliers: SuppliersPage,
  'suppliers.detail': SupplierDetailPage,
  pos: PosPage,
  sales: SalesPage,
  'sales.detail': SaleDetailPage,
  customers: CustomersPage,
  'customers.detail': CustomerDetailPage,
  quotes: QuotesPage,
  'quotes.edit': QuoteEditorPage,
  installments: InstallmentsPage,
  deliveries: DeliveriesPage,
  inventory: InventoriesPage,
  'inventory.detail': InventoryDetailPage,
  warranty: WarrantyPage,
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
  const params = useRouter((state) => state.params);
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
  // Un écran repart de zéro quand ses paramètres changent (autre produit, autre devis…).
  return <Page key={`${current}:${JSON.stringify(params)}`} />;
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

/** Alertes de stock bas affichées à l'ouverture de session (4.3), pour qui peut voir le stock. */
function useStockAlertOnLogin(): void {
  const userId = useSession((state) => state.session?.user.id ?? null);
  const canView = useSession((state) => state.session?.permissions.includes('stock.view') ?? false);
  useEffect(() => {
    if (userId === null || !canView) return;
    invoke('stock:alerts').then(
      ({ lowStock }) => {
        // Traduit au moment de l'alerte : un changement de langue ne la relance pas.
        const language = usePreferences.getState().preferences.language;
        if (lowStock > 0)
          toast.warning(translate(language, 'stock.alerts.login', { count: lowStock }));
      },
      (error: unknown) => {
        toast.error(errorMessage(error));
      },
    );
  }, [userId, canView]);
}

function AuthenticatedApp() {
  useResetRouterOnUserChange();
  useStockAlertOnLogin();
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
