import { DEFAULT_IDLE_LOCK_MINUTES } from '@shared/auth/policy';
import { DEFAULT_CURRENCY } from '@shared/format/money';
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  ROLES,
} from '@shared/permissions';
import type { Db } from './types';

/** Familles de premier niveau (section 4.12) ; l'administrateur pourra les renommer. */
const FAMILIES = [
  { name: 'Téléphonie', tracking: 'imei', warranty: 12 },
  { name: 'Électronique et audio', tracking: 'serial', warranty: 12 },
  { name: 'Électroménager', tracking: 'serial', warranty: 12 },
  { name: 'Énergie solaire', tracking: 'none', warranty: 12 },
] as const;

/** Paramètres par défaut : valeurs JSON, créées une seule fois. */
export const DEFAULT_SETTINGS: Readonly<Record<string, unknown>> = {
  'setup.completed': false,
  'shop.name': '',
  'shop.currency': DEFAULT_CURRENCY,
  'security.idle_lock_minutes': DEFAULT_IDLE_LOCK_MINUTES,
  'security.recovery_key_hash': null,
  'inventory.double_check': false,
  'payment.methods': ['cash', 'mobile_money', 'card', 'transfer', 'cheque'],
  // Plafonds de remise en centièmes de pourcent (1000 = 10 %) ; null = sans plafond (D52).
  'pos.discount_caps': { seller: 1000, manager: 3000, admin: null },
  // Imprimante de tickets : null = simulateur (fichier) ; « tcp://adresse:9100 » pour une imprimante réseau (D55).
  'printer.receipt': null,
  'printer.receipt_width': 48,
  // Sauvegardes (4.10, D70) : quotidienne, 7 copies gardées, rappel de copie externe après 7 jours.
  'backup.auto_enabled': true,
  'backup.keep': 7,
  'backup.reminder_days': 7,
  'maintenance.last_vacuum': null,
};

function seedRolesAndPermissions(db: Db): void {
  const insertRole = db.prepare(
    'INSERT INTO roles (code, name) VALUES (?, ?) ON CONFLICT (code) DO NOTHING',
  );
  const insertPermission = db.prepare(
    `INSERT INTO permissions (code, description) VALUES (?, ?)
     ON CONFLICT (code) DO UPDATE SET description = excluded.description`,
  );
  for (const role of ROLES) insertRole.run(role, ROLE_NAMES[role]);
  for (const permission of PERMISSIONS) {
    insertPermission.run(permission, PERMISSION_DESCRIPTIONS[permission]);
  }
  // Les droits des rôles suivent exactement le référentiel partagé (src/shared/permissions.ts).
  db.exec('DELETE FROM role_permissions');
  const grant = db.prepare(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = ? AND p.code = ?`,
  );
  for (const role of ROLES) {
    for (const permission of ROLE_PERMISSIONS[role]) grant.run(role, permission);
  }
}

function isEmpty(db: Db, table: 'categories' | 'tax_rates' | 'stock_locations'): boolean {
  return db.prepare(`SELECT NOT EXISTS (SELECT 1 FROM ${table}) AS empty`).pluck().get() === 1;
}

function seedReferenceData(db: Db): void {
  if (isEmpty(db, 'categories')) {
    const insert = db.prepare(
      `INSERT INTO categories (name, default_tracking_mode, default_warranty_months, sort_order)
       VALUES (?, ?, ?, ?)`,
    );
    FAMILIES.forEach((family, index) =>
      insert.run(family.name, family.tracking, family.warranty, index),
    );
  }
  if (isEmpty(db, 'tax_rates')) {
    const insert = db.prepare('INSERT INTO tax_rates (name, rate) VALUES (?, ?)');
    insert.run('Exonéré', 0);
    insert.run('TVA 18 %', 1800);
  }
  if (isEmpty(db, 'stock_locations')) {
    db.prepare("INSERT INTO stock_locations (name, is_default) VALUES ('Magasin', 1)").run();
  }
  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, JSON.stringify(value));
  }
}

/** Données initiales du système (E.7), idempotentes : rejouées à chaque démarrage. */
export function seedSystem(db: Db): void {
  db.transaction(() => {
    seedRolesAndPermissions(db);
    seedReferenceData(db);
  })();
}
