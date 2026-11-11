import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { breadcrumbOf, routeDefinition } from '../app/routes';
import { Button } from '../components/ui/button';
import { Kbd } from '../components/ui/basic';
import { useHotkey } from '../hotkeys/hotkeys';
import { useT } from '../i18n';
import { useRouter } from '../stores/router';
import { useSession } from '../stores/session';
import { useStockEvents } from '../stores/stock-events';
import { invoke } from '../lib/ipc';

/** Indicateur permanent des alertes de stock (A.3), relu à chaque changement d'écran. */
function StockAlerts() {
  const t = useT();
  const canView = useSession((state) => state.session?.permissions.includes('stock.view') ?? false);
  const current = useRouter((state) => state.current);
  const navigate = useRouter((state) => state.navigate);
  const version = useStockEvents((state) => state.version);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!canView) return;
    let active = true;
    invoke('stock:alerts').then(
      ({ lowStock }) => {
        if (active) setCount(lowStock);
      },
      () => {
        if (active) setCount(0);
      },
    );
    return () => {
      active = false;
    };
  }, [canView, current, version]);
  if (!canView || count === 0) return null;
  return (
    <Button
      variant="secondary"
      className="border-warning text-foreground"
      onClick={() => navigate('stock', { lowStock: true })}
    >
      <TriangleAlert className="text-warning" aria-hidden="true" />
      {t('stock.alerts', { count })}
    </Button>
  );
}

interface HeaderProps {
  onOpenSearch: () => void;
}

export function Header({ onOpenSearch }: HeaderProps) {
  const t = useT();
  const current = useRouter((state) => state.current);
  const canGoBack = useRouter((state) => state.history.length > 0);
  const back = useRouter((state) => state.back);
  const navigate = useRouter((state) => state.navigate);
  const crumbs = breadcrumbOf(current);

  useHotkey('Alt+ArrowLeft', back, { enabled: canGoBack });

  return (
    <header className="border-border bg-surface flex h-14 shrink-0 items-center gap-4 border-b px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={back}
        disabled={!canGoBack}
        aria-label={t('nav.back')}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <nav aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((route, index) => {
            const label = t(routeDefinition(route).labelKey);
            const isLast = index === crumbs.length - 1;
            return (
              <li key={route} className="flex items-center gap-1">
                {index > 0 && (
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                )}
                {isLast ? (
                  <span aria-current="page" className="font-semibold">
                    {label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded hover:underline"
                    onClick={() => navigate(route)}
                  >
                    {label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <StockAlerts />
      <Button
        variant="secondary"
        onClick={onOpenSearch}
        className="text-muted-foreground w-72 justify-between"
      >
        <span className="flex items-center gap-2">
          <Search aria-hidden="true" />
          {t('search.open')}
        </span>
        <Kbd>Ctrl K</Kbd>
      </Button>
    </header>
  );
}
