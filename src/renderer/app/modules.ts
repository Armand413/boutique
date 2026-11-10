import { Info, LayoutPanelTop, Settings, type LucideIcon } from 'lucide-react';
import type { Permission } from '@shared/permissions';
import type { RouteName } from './routes';
import type { TranslationKey } from '../i18n/fr';

export interface ModuleEntry {
  route: RouteName;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** Permission requise pour voir le module ; absent si accessible à tous. */
  permission?: Permission;
  /** Visible uniquement en développement (jamais dans l'application installée). */
  devOnly?: boolean;
}

/**
 * Modules de la barre latérale (A.3). Un module n'apparaît ici que lorsqu'il est livré.
 */
export const MODULES: readonly ModuleEntry[] = [
  { route: 'settings', labelKey: 'nav.settings', icon: Settings },
  { route: 'about', labelKey: 'nav.about', icon: Info },
  { route: 'dev.gallery', labelKey: 'nav.dev.gallery', icon: LayoutPanelTop, devOnly: true },
];

/** Modules visibles : ceux autorisés au rôle connecté, sans les outils de développement en production. */
export function visibleModules(
  modules: readonly ModuleEntry[],
  granted: ReadonlySet<Permission>,
  isDevelopment: boolean,
): ModuleEntry[] {
  return modules.filter(
    (entry) =>
      (entry.devOnly !== true || isDevelopment) &&
      (entry.permission === undefined || granted.has(entry.permission)),
  );
}
