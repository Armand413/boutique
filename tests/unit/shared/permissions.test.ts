import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, roleHasPermission } from '@shared/permissions';

describe('rôles et permissions', () => {
  it('ne donne au vendeur ni les prix d’achat, ni la modification des prix, ni les exports (B.2)', () => {
    expect(roleHasPermission('seller', 'cost.view')).toBe(false);
    expect(roleHasPermission('seller', 'price.edit')).toBe(false);
    expect(roleHasPermission('seller', 'export.run')).toBe(false);
  });

  it('réserve l’administration au rôle admin', () => {
    const adminOnly = ['user.manage', 'settings.manage', 'backup.manage', 'audit.view'] as const;
    for (const permission of adminOnly) {
      expect(roleHasPermission('admin', permission)).toBe(true);
      expect(roleHasPermission('manager', permission)).toBe(false);
      expect(roleHasPermission('seller', permission)).toBe(false);
    }
  });

  it('donne au gérant tout ce que peut faire le vendeur', () => {
    for (const permission of ROLE_PERMISSIONS.seller) {
      expect(roleHasPermission('manager', permission)).toBe(true);
    }
  });

  it('n’attribue que des permissions connues, sans doublon', () => {
    for (const role of ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size).toBe(granted.length);
      for (const permission of granted) expect(PERMISSIONS).toContain(permission);
    }
  });
});
