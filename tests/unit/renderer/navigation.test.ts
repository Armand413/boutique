import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '@shared/permissions';
import { MODULES, visibleModules, type ModuleEntry } from '../../../src/renderer/app/modules';
import { breadcrumbOf } from '../../../src/renderer/app/routes';
import { en } from '../../../src/renderer/i18n/en';
import { fr, type TranslationKey } from '../../../src/renderer/i18n/fr';
import { translate } from '../../../src/renderer/i18n/index';

vi.mock('../../../src/renderer/stores/preferences', () => ({ usePreferences: vi.fn() }));

describe('navigation', () => {
  it('construit le fil d’Ariane depuis l’écran parent', () => {
    expect(breadcrumbOf('settings.appearance')).toEqual(['settings', 'settings.appearance']);
    expect(breadcrumbOf('about')).toEqual(['about']);
  });

  it('cache les outils de développement en production', () => {
    const none = new Set<Permission>();
    expect(visibleModules(MODULES, none, false, null).map((m) => m.route)).not.toContain(
      'dev.gallery',
    );
    expect(visibleModules(MODULES, none, true, null).map((m) => m.route)).toContain('dev.gallery');
  });

  it('cache un module dont la permission manque', () => {
    const [first] = MODULES;
    if (first === undefined) throw new Error('Aucun module déclaré');
    const guarded: ModuleEntry[] = [{ ...first, permission: 'cost.view' }];
    expect(visibleModules(guarded, new Set(), false, null)).toHaveLength(0);
    expect(visibleModules(guarded, new Set<Permission>(['cost.view']), false, null)).toHaveLength(
      1,
    );
  });

  it('cache les modules désactivés dans les paramètres (D90)', () => {
    const everything = new Set<Permission>([
      'supplier.manage',
      'delivery.manage',
      'warranty.manage',
    ]);
    const routes = (enabled: Parameters<typeof visibleModules>[3]) =>
      visibleModules(MODULES, everything, false, enabled).map((m) => m.route);
    const off = { suppliers: false, deliveries: false, warranty: false };
    expect(routes(off)).not.toContain('suppliers');
    expect(routes(off)).not.toContain('deliveries');
    expect(routes(off)).not.toContain('warranty');
    expect(routes(null)).not.toContain('suppliers');
    expect(routes({ ...off, suppliers: true })).toContain('suppliers');
  });
});

describe('traductions', () => {
  it('a les mêmes clés en français et en anglais, sans texte vide', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const text of [...Object.values(fr), ...Object.values(en)]) {
      expect(text.trim()).not.toBe('');
    }
  });

  it('a les mêmes paramètres {x} dans les deux langues', () => {
    const params = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(fr) as TranslationKey[]) {
      expect(params(en[key]), key).toEqual(params(fr[key]));
    }
  });

  it('traduit une clé dans la langue demandée', () => {
    expect(translate('fr', 'nav.settings')).toBe(fr['nav.settings']);
    expect(translate('en', 'nav.settings')).toBe('Settings');
    // Le nom de l'application est une marque : identique dans toutes les langues.
    expect(translate('en', 'app.name')).toBe('Bouba Store');
  });
});
