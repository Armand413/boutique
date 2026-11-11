import { nowIsoUtc } from '@shared/format/date';
import type { Role } from '@shared/permissions';
import type { UserSummary } from '@shared/schemas/auth';
import type { Db } from '../db/types';

export interface UserRecord {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  passwordHash: string;
  pinHash: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: string | null;
  lastLoginAt: string | null;
}

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  password_hash: string;
  pin_hash: string | null;
  is_active: number;
  must_change_password: number;
  failed_attempts: number;
  locked_until: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  last_login_at: string | null;
}

const SELECT_USER = `
  SELECT u.id, u.username, u.full_name, r.code AS role, u.password_hash, u.pin_hash, u.is_active,
         u.must_change_password, u.failed_attempts, u.locked_until, u.pin_failed_attempts,
         u.pin_locked_until, u.last_login_at
  FROM users u JOIN roles r ON r.id = u.role_id`;

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    passwordHash: row.password_hash,
    pinHash: row.pin_hash,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    pinFailedAttempts: row.pin_failed_attempts,
    pinLockedUntil: row.pin_locked_until,
    lastLoginAt: row.last_login_at,
  };
}

export function toSummary(user: UserRecord): UserSummary {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    hasPin: user.pinHash !== null,
    mustChangePassword: user.mustChangePassword,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
  };
}

export function findUserByUsername(db: Db, username: string): UserRecord | null {
  const row = db.prepare<[string], UserRow>(`${SELECT_USER} WHERE u.username = ?`).get(username);
  return row === undefined ? null : toRecord(row);
}

export function findUserById(db: Db, id: number): UserRecord | null {
  const row = db.prepare<[number], UserRow>(`${SELECT_USER} WHERE u.id = ?`).get(id);
  return row === undefined ? null : toRecord(row);
}

export function listUsers(db: Db): UserRecord[] {
  return db
    .prepare<[], UserRow>(`${SELECT_USER} ORDER BY u.is_active DESC, u.full_name COLLATE NOCASE`)
    .all()
    .map(toRecord);
}

export function countUsers(db: Db): number {
  return db.prepare('SELECT count(*) FROM users').pluck().get() as number;
}

export interface NewUser {
  username: string;
  fullName: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
  createdBy: number | null;
}

export function insertUser(db: Db, user: NewUser): number {
  const now = nowIsoUtc();
  const result = db
    .prepare(
      `INSERT INTO users (username, full_name, password_hash, role_id, must_change_password,
                          created_at, updated_at, created_by)
       VALUES (?, ?, ?, (SELECT id FROM roles WHERE code = ?), ?, ?, ?, ?)`,
    )
    .run(
      user.username,
      user.fullName,
      user.passwordHash,
      user.role,
      user.mustChangePassword ? 1 : 0,
      now,
      now,
      user.createdBy,
    );
  return Number(result.lastInsertRowid);
}

export interface UserChanges {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
}

export function updateUser(db: Db, id: number, changes: UserChanges): void {
  db.prepare(
    `UPDATE users SET
       full_name = coalesce(@fullName, full_name),
       role_id = coalesce((SELECT r.id FROM roles r WHERE r.code = @role), role_id),
       is_active = coalesce(@isActive, is_active),
       updated_at = @now
     WHERE id = @id`,
  ).run({
    id,
    fullName: changes.fullName ?? null,
    role: changes.role ?? null,
    isActive: changes.isActive === undefined ? null : changes.isActive ? 1 : 0,
    now: nowIsoUtc(),
  });
}

export function setPassword(db: Db, id: number, passwordHash: string, mustChange: boolean): void {
  db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = ?, failed_attempts = 0,
       locked_until = NULL, updated_at = ? WHERE id = ?`,
  ).run(passwordHash, mustChange ? 1 : 0, nowIsoUtc(), id);
}

export function setPin(db: Db, id: number, pinHash: string | null): void {
  db.prepare(
    'UPDATE users SET pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?',
  ).run(pinHash, nowIsoUtc(), id);
}

export type Credential = 'password' | 'pin';

export function recordFailure(
  db: Db,
  id: number,
  credential: Credential,
  failures: number,
  lockedUntil: string | null,
): void {
  const sql =
    credential === 'password'
      ? 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?'
      : 'UPDATE users SET pin_failed_attempts = ?, pin_locked_until = ? WHERE id = ?';
  db.prepare(sql).run(failures, lockedUntil, id);
}

export function recordSuccess(db: Db, id: number, credential: Credential): void {
  const sql =
    credential === 'password'
      ? 'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?'
      : 'UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL, last_login_at = ? WHERE id = ?';
  db.prepare(sql).run(nowIsoUtc(), id);
}
