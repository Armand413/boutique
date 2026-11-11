import { useMemo } from 'react';
import { Lock, LogOut, Store } from 'lucide-react';
import { MODULES, visibleModules } from '../app/modules';
import { breadcrumbOf } from '../app/routes';
import { Badge } from '../components/ui/basic';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/radix';
import { useHotkey } from '../hotkeys/hotkeys';
import { useT } from '../i18n';
import { cn } from '../lib/cn';
import { useRouter } from '../stores/router';
import { useSession } from '../stores/session';

function SessionBlock() {
  const t = useT();
  const session = useSession((state) => state.session);
  const lock = useSession((state) => state.lock);
  const logout = useSession((state) => state.logout);
  useHotkey('Ctrl+L', () => void lock());
  if (session === null) return null;
  return (
    <section
      aria-label={t('user.menu', { name: session.user.fullName })}
      className="border-sidebar-active flex flex-col gap-2 border-t p-3"
    >
      <div className="flex flex-col gap-1 px-1">
        <span className="truncate text-sm font-semibold">{session.user.fullName}</span>
        <span className="flex items-center gap-2 text-xs">
          {t(`role.${session.user.role}`)}
          {session.method === 'pin' && <Badge tone="info">{t('user.pinSession')}</Badge>}
        </span>
      </div>
      <div className="flex gap-2">
        <Tooltip content={`${t('user.lock')} (Ctrl+L)`}>
          <Button
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground hover:bg-sidebar-active flex-1"
            onClick={() => void lock()}
          >
            <Lock aria-hidden="true" />
            {t('user.lock')}
          </Button>
        </Tooltip>
        <Tooltip content={t('user.logout')}>
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-active"
            aria-label={t('user.logout')}
            onClick={() => void logout()}
          >
            <LogOut aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}

export function Sidebar() {
  const t = useT();
  const current = useRouter((state) => state.current);
  const navigate = useRouter((state) => state.navigate);
  const permissions = useSession((state) => state.session?.permissions);
  const topLevel = breadcrumbOf(current)[0];
  const modules = useMemo(
    () => visibleModules(MODULES, new Set(permissions ?? []), import.meta.env.DEV),
    [permissions],
  );

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex w-60 shrink-0 flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Store className="size-6" aria-hidden="true" />
        <span className="text-base font-semibold">{t('app.name')}</span>
      </div>
      <nav aria-label={t('nav.label')} className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-1">
          {modules.map((entry) => {
            const active = entry.route === topLevel;
            const Icon = entry.icon;
            return (
              <li key={entry.route}>
                <button
                  type="button"
                  onClick={() => navigate(entry.route)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors',
                    active
                      ? 'bg-sidebar-active text-sidebar-active-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-active',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  {t(entry.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <SessionBlock />
    </aside>
  );
}
