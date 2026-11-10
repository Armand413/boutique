import { Store } from 'lucide-react';
import type { Permission } from '@shared/permissions';
import { MODULES, visibleModules } from '../app/modules';
import { breadcrumbOf } from '../app/routes';
import { useT } from '../i18n';
import { cn } from '../lib/cn';
import { useRouter } from '../stores/router';

/** Aucune session avant la Phase 2 : seuls les modules sans permission sont visibles. */
const NO_PERMISSIONS: ReadonlySet<Permission> = new Set();

export function Sidebar() {
  const t = useT();
  const current = useRouter((state) => state.current);
  const navigate = useRouter((state) => state.navigate);
  const topLevel = breadcrumbOf(current)[0];
  const modules = visibleModules(MODULES, NO_PERMISSIONS, import.meta.env.DEV);

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
    </aside>
  );
}
