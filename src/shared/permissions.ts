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
  'price.override',
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
