/**
 * Rôles et permissions (section 3, B.2). Référentiel unique, repris par le seed système (Phase 2)
 * et par les contrôles des services. L'interface ne s'en sert que pour masquer ce qui est interdit.
 */
export const ROLES = ['admin', 'manager', 'seller'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view',
  'pos.use',
  'product.view',
  'product.edit',
  'price.edit',
  'price.override',
  'cost.view',
  'stock.view',
  'stock.adjust',
  'inventory.manage',
  'inventory.validate',
  'sale.view',
  'sale.cancel',
  'sale.return',
  'quote.manage',
  'customer.manage',
  'supplier.manage',
  'warranty.manage',
  'delivery.manage',
  'report.view',
  'export.run',
  'user.manage',
  'settings.manage',
  'backup.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const SELLER: readonly Permission[] = [
  'dashboard.view',
  'pos.use',
  'product.view',
  'stock.view',
  'sale.view',
  'quote.manage',
  'customer.manage',
  'warranty.manage',
  'delivery.manage',
];

const MANAGER: readonly Permission[] = [
  ...SELLER,
  'product.edit',
  'price.edit',
  'cost.view',
  'stock.adjust',
  'inventory.manage',
  'inventory.validate',
  'sale.cancel',
  'sale.return',
  'supplier.manage',
  'report.view',
  'export.run',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  seller: SELLER,
  manager: MANAGER,
  admin: PERMISSIONS,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  admin: 'Administrateur',
  manager: 'Gérant',
  seller: 'Vendeur',
};

/** Libellés repris par le seed système (table permissions). */
export const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  'dashboard.view': 'Voir le tableau de bord',
  'pos.use': 'Utiliser la caisse',
  'product.view': 'Consulter les produits',
  'product.edit': 'Créer et modifier les produits',
  'price.edit': 'Modifier les prix de vente',
  'price.override': 'Vendre sous le prix minimum ou au-delà du plafond de remise',
  'cost.view': 'Voir les prix d’achat et les marges',
  'stock.view': 'Consulter le stock',
  'stock.adjust': 'Ajuster le stock et enregistrer les entrées',
  'inventory.manage': 'Préparer et compter les inventaires',
  'inventory.validate': 'Valider un inventaire',
  'sale.view': 'Consulter les ventes',
  'sale.cancel': 'Annuler une vente',
  'sale.return': 'Enregistrer un retour',
  'quote.manage': 'Gérer les devis',
  'customer.manage': 'Gérer les clients',
  'supplier.manage': 'Gérer les fournisseurs et les achats',
  'warranty.manage': 'Gérer la garantie et le SAV',
  'delivery.manage': 'Gérer les livraisons',
  'report.view': 'Voir les rapports',
  'export.run': 'Exporter des données',
  'user.manage': 'Gérer les utilisateurs',
  'settings.manage': 'Modifier les paramètres',
  'backup.manage': 'Sauvegarder et restaurer',
  'audit.view': 'Consulter le journal d’audit',
};

/**
 * Une session ouverte par code PIN n'a que les droits de caisse (B.1),
 * dans la limite de ceux de son rôle.
 */
export const PIN_SESSION_PERMISSIONS: readonly Permission[] = [
  'pos.use',
  'product.view',
  'stock.view',
  'customer.manage',
];

export function sessionPermissions(role: Role, method: 'password' | 'pin'): Permission[] {
  const granted = ROLE_PERMISSIONS[role];
  return method === 'password'
    ? [...granted]
    : granted.filter((permission) => PIN_SESSION_PERMISSIONS.includes(permission));
}
