import type { TranslationKey } from '../i18n/fr';

export interface RouteDefinition {
  labelKey: TranslationKey;
  /** Écran parent pour le fil d'Ariane ; null pour un écran de premier niveau. */
  parent: RouteName | null;
}

/**
 * Écrans existants. Un écran n'est ajouté ici que lorsqu'il est réellement implémenté
 * (aucun écran factice).
 */
export const ROUTES = {
  settings: { labelKey: 'nav.settings', parent: null },
  'settings.appearance': { labelKey: 'nav.settings.appearance', parent: 'settings' },
  about: { labelKey: 'nav.about', parent: null },
  users: { labelKey: 'nav.users', parent: null },
  audit: { labelKey: 'nav.audit', parent: null },
  account: { labelKey: 'nav.account', parent: null },
  products: { labelKey: 'nav.products', parent: null },
  'products.detail': { labelKey: 'nav.products.detail', parent: 'products' },
  'products.categories': { labelKey: 'nav.products.categories', parent: 'products' },
  'products.brands': { labelKey: 'nav.products.brands', parent: 'products' },
  stock: { labelKey: 'nav.stock', parent: null },
  'stock.receipt': { labelKey: 'nav.stock.receipt', parent: 'stock' },
  'stock.locations': { labelKey: 'nav.stock.locations', parent: 'stock' },
  suppliers: { labelKey: 'nav.suppliers', parent: null },
  'suppliers.detail': { labelKey: 'nav.suppliers.detail', parent: 'suppliers' },
  pos: { labelKey: 'nav.pos', parent: null },
  sales: { labelKey: 'nav.sales', parent: null },
  'sales.detail': { labelKey: 'nav.sales.detail', parent: 'sales' },
  customers: { labelKey: 'nav.customers', parent: null },
  'customers.detail': { labelKey: 'nav.customers.detail', parent: 'customers' },
  quotes: { labelKey: 'nav.quotes', parent: null },
  'quotes.edit': { labelKey: 'nav.quotes.edit', parent: 'quotes' },
  installments: { labelKey: 'nav.installments', parent: null },
  deliveries: { labelKey: 'nav.deliveries', parent: null },
  inventory: { labelKey: 'nav.inventory', parent: null },
  'inventory.detail': { labelKey: 'nav.inventory.detail', parent: 'inventory' },
  warranty: { labelKey: 'nav.warranty', parent: null },
  'dev.gallery': { labelKey: 'nav.dev.gallery', parent: null },
} as const satisfies Record<string, { labelKey: TranslationKey; parent: string | null }>;

export type RouteName = keyof typeof ROUTES;

export const DEFAULT_ROUTE: RouteName = 'settings';

export function routeDefinition(name: RouteName): RouteDefinition {
  return ROUTES[name];
}

/** Chaîne des écrans du premier niveau jusqu'à `name` inclus. */
export function breadcrumbOf(name: RouteName): RouteName[] {
  const chain: RouteName[] = [];
  let cursor: RouteName | null = name;
  while (cursor !== null) {
    if (chain.includes(cursor)) throw new Error(`Cycle dans les routes : ${cursor}`);
    chain.unshift(cursor);
    cursor = routeDefinition(cursor).parent;
  }
  return chain;
}
