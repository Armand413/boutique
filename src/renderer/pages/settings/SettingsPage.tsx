import {
  ChevronRight,
  DatabaseBackup,
  Globe,
  Palette,
  Percent,
  Printer,
  ShieldCheck,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@shared/permissions';
import type { RouteName } from '../../app/routes';
import { Card } from '../../components/ui/basic';
import { useT, type TranslationKey } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { useSession } from '../../stores/session';

interface Section {
  route: RouteName;
  icon: LucideIcon;
  title: TranslationKey;
  description: TranslationKey;
  /** Sans permission : section de ce poste, ouverte à tous (apparence). */
  permission?: Permission;
}

const SECTIONS: readonly Section[] = [
  {
    route: 'settings.shop',
    icon: Store,
    title: 'nav.settings.shop',
    description: 'settings.shop.description',
    permission: 'settings.manage',
  },
  {
    route: 'settings.regional',
    icon: Globe,
    title: 'nav.settings.regional',
    description: 'settings.regional.description',
    permission: 'settings.manage',
  },
  {
    route: 'settings.taxes',
    icon: Percent,
    title: 'nav.settings.taxes',
    description: 'settings.taxes.description',
    permission: 'settings.manage',
  },
  {
    route: 'settings.printing',
    icon: Printer,
    title: 'nav.settings.printing',
    description: 'settings.printing.description',
    permission: 'settings.manage',
  },
  {
    route: 'settings.security',
    icon: ShieldCheck,
    title: 'nav.settings.security',
    description: 'settings.security.description',
    permission: 'settings.manage',
  },
  {
    route: 'settings.backup',
    icon: DatabaseBackup,
    title: 'nav.settings.backup',
    description: 'settings.backup.description',
    permission: 'backup.manage',
  },
  {
    route: 'settings.appearance',
    icon: Palette,
    title: 'settings.appearance.title',
    description: 'settings.appearance.description',
  },
];

/** Paramètres (A.4) : sections claires, chacune selon les droits de la session. */
export function SettingsPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const permissions = useSession((state) => state.session?.permissions ?? []);
  const visible = SECTIONS.filter(
    (section) => section.permission === undefined || permissions.includes(section.permission),
  );
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.route}>
              <button
                type="button"
                onClick={() => navigate(section.route)}
                className="hover:bg-muted flex w-full items-center gap-4 rounded-lg p-6 text-left"
              >
                <Icon className="text-primary size-6" aria-hidden="true" />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-xl font-semibold">{t(section.title)}</span>
                  <span className="text-muted-foreground text-sm">{t(section.description)}</span>
                </span>
                <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
              </button>
            </Card>
          );
        })}
      </div>
    </>
  );
}
