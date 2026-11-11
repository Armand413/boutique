import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import type { SessionInfo } from '@shared/schemas/auth';
import { appendAudit } from '../audit/audit-log';
import type { Db } from '../db/types';
import type { KeyStore } from '../db/keystore';
import { getSetting, setSetting } from '../settings/settings-repository';
import { requireSession } from './authorization';
import {
  assertPasswordAcceptable,
  assertPinAcceptable,
  lockedMessage,
  lockedUntilAfter,
  remainingLockSeconds,
} from './credentials';
import { hashSecret, verifyAgainstDummy, verifySecret } from './hashing';
import { generateRecoveryKey, normalizeRecoveryKey } from './recovery-key';
import type { AuthMethod, SessionManager } from './session';
import {
  findUserById,
  findUserByUsername,
  recordFailure,
  recordSuccess,
  setPassword,
  setPin,
  type Credential,
  type UserRecord,
} from './user-repository';

export interface AuthDependencies {
  db: Db;
  sessions: SessionManager;
  keyStore: KeyStore;
  /** Clé de la base ouverte, pour re-séquestrer après une récupération. */
  databaseKey: Buffer;
  clock?: () => number;
  /** Tests de bout en bout uniquement : délai d'inactivité court. */
  idleLockSecondsOverride?: number;
}

const INVALID_LOGIN = 'Identifiant ou mot de passe incorrect.';
const INVALID_PIN = 'Identifiant ou code PIN incorrect.';
const RECOVERY_MAX_FAILURES = 5;
const RECOVERY_LOCK_MS = 15 * 60 * 1000;

export class AuthService {
  private readonly clock: () => number;
  private recoveryFailures = 0;
  private recoveryLockedUntil = 0;

  constructor(private readonly deps: AuthDependencies) {
    this.clock = deps.clock ?? Date.now;
  }

  sessionInfo(): SessionInfo | null {
    return this.deps.sessions.info();
  }

  async login(username: string, password: string): Promise<SessionInfo> {
    const user = await this.authenticate(username, password, 'password');
    return this.openSession(user, 'password');
  }

  async loginWithPin(username: string, pin: string): Promise<SessionInfo> {
    const user = await this.authenticate(username, pin, 'pin');
    return this.openSession(user, 'pin');
  }

  logout(): void {
    const session = this.deps.sessions.current();
    if (session === null) return;
    appendAudit(this.deps.db, { userId: session.userId, action: 'auth.logout' });
    this.deps.sessions.end();
  }

  lock(): SessionInfo {
    const session = requireSession(this.deps.sessions, { allowPasswordChange: true });
    this.deps.sessions.lock();
    appendAudit(this.deps.db, { userId: session.userId, action: 'auth.session_locked' });
    return this.infoOrThrow();
  }

  /** Déverrouille avec le secret de la méthode de connexion (mot de passe ou PIN). */
  async unlock(secret: string): Promise<SessionInfo> {
    const session = requireSession(this.deps.sessions, { allowLocked: true });
    if (!session.locked) return this.infoOrThrow();
    try {
      await this.authenticate(session.username, secret, session.method);
    } catch (error) {
      if (error instanceof AppError && error.code === 'ACCOUNT_LOCKED') {
        appendAudit(this.deps.db, { userId: session.userId, action: 'auth.forced_logout' });
        this.deps.sessions.end();
      }
      throw error;
    }
    this.deps.sessions.unlock();
    appendAudit(this.deps.db, { userId: session.userId, action: 'auth.session_unlocked' });
    return this.infoOrThrow();
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<SessionInfo> {
    const session = requireSession(this.deps.sessions, { allowPasswordChange: true });
    if (session.method !== 'password') {
      throw new AppError('FORBIDDEN', 'Connectez-vous avec votre mot de passe pour le changer.');
    }
    const user = this.activeUser(session.userId);
    if (!(await verifySecret(user.passwordHash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
    }
    if (newPassword === currentPassword) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Le nouveau mot de passe doit être différent de l’actuel.',
      );
    }
    assertPasswordAcceptable(newPassword, user.username);
    const passwordHash = await hashSecret(newPassword);
    this.deps.db.transaction(() => {
      setPassword(this.deps.db, user.id, passwordHash, false);
      appendAudit(this.deps.db, {
        userId: user.id,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: user.id,
      });
    })();
    this.deps.sessions.passwordChanged();
    return this.infoOrThrow();
  }

  async setOwnPin(currentPassword: string, pin: string | null): Promise<void> {
    const session = requireSession(this.deps.sessions);
    const user = this.activeUser(session.userId);
    if (!(await verifySecret(user.passwordHash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
    }
    if (pin !== null) assertPinAcceptable(pin);
    const pinHash = pin === null ? null : await hashSecret(pin);
    this.deps.db.transaction(() => {
      setPin(this.deps.db, user.id, pinHash);
      appendAudit(this.deps.db, {
        userId: user.id,
        action: pin === null ? 'auth.pin_removed' : 'auth.pin_changed',
        entityType: 'user',
        entityId: user.id,
      });
    })();
  }

  /**
   * Récupération du compte administrateur par la clé de récupération (B.1).
   * La clé utilisée est aussitôt remplacée : la nouvelle est renvoyée pour être conservée.
   */
  async recoverAdmin(username: string, recoveryKey: string, newPassword: string): Promise<string> {
    const now = this.clock();
    if (now < this.recoveryLockedUntil) {
      throw new AppError(
        'ACCOUNT_LOCKED',
        lockedMessage(Math.ceil((this.recoveryLockedUntil - now) / 1000)),
      );
    }
    const storedHash = getSetting(
      this.deps.db,
      'security.recovery_key_hash',
      z.string().nullable(),
    );
    const canonical = normalizeRecoveryKey(recoveryKey);
    const user = findUserByUsername(this.deps.db, username);
    const keyMatches =
      storedHash !== null && canonical !== null && (await verifySecret(storedHash, canonical));
    if (!keyMatches || user?.role !== 'admin' || !user.isActive) {
      this.recordRecoveryFailure(username);
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Clé de récupération ou identifiant administrateur incorrect.',
      );
    }
    assertPasswordAcceptable(newPassword, user.username);
    const passwordHash = await hashSecret(newPassword);
    const nextKey = generateRecoveryKey();
    const nextHash = await hashSecret(normalizeRecoveryKey(nextKey) ?? '');
    await this.deps.keyStore.writeEscrow(this.deps.databaseKey, nextKey);
    this.deps.db.transaction(() => {
      setPassword(this.deps.db, user.id, passwordHash, false);
      setPin(this.deps.db, user.id, user.pinHash);
      setSetting(this.deps.db, 'security.recovery_key_hash', nextHash, user.id);
      appendAudit(this.deps.db, {
        userId: user.id,
        action: 'auth.recovery_used',
        entityType: 'user',
        entityId: user.id,
      });
    })();
    this.recoveryFailures = 0;
    return nextKey;
  }

  private recordRecoveryFailure(username: string): void {
    this.recoveryFailures += 1;
    if (this.recoveryFailures >= RECOVERY_MAX_FAILURES) {
      this.recoveryLockedUntil = this.clock() + RECOVERY_LOCK_MS;
      this.recoveryFailures = 0;
    }
    appendAudit(this.deps.db, {
      userId: null,
      action: 'auth.recovery_failed',
      details: { username },
    });
  }

  /** Vérifie un secret avec limitation des tentatives ; lève une erreur sans révéler la cause exacte. */
  private async authenticate(
    username: string,
    secret: string,
    credential: Credential,
  ): Promise<UserRecord> {
    const invalid = credential === 'password' ? INVALID_LOGIN : INVALID_PIN;
    const user = findUserByUsername(this.deps.db, username);
    const storedHash = credential === 'password' ? user?.passwordHash : user?.pinHash;
    if (user === null || !user.isActive || storedHash === null || storedHash === undefined) {
      await verifyAgainstDummy(secret);
      appendAudit(this.deps.db, {
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        details: { username, credential, reason: user === null ? 'unknown_user' : 'unavailable' },
      });
      throw new AppError('INVALID_CREDENTIALS', invalid);
    }
    const now = this.clock();
    const lockedUntil = credential === 'password' ? user.lockedUntil : user.pinLockedUntil;
    const remaining = remainingLockSeconds(lockedUntil, now);
    if (remaining > 0) throw new AppError('ACCOUNT_LOCKED', lockedMessage(remaining));
    if (await verifySecret(storedHash, secret)) return user;
    this.registerFailure(user, credential, now);
    throw new AppError('INVALID_CREDENTIALS', invalid);
  }

  private registerFailure(user: UserRecord, credential: Credential, now: number): void {
    const failures = (credential === 'password' ? user.failedAttempts : user.pinFailedAttempts) + 1;
    const lockedUntil = lockedUntilAfter(failures, now);
    this.deps.db.transaction(() => {
      recordFailure(this.deps.db, user.id, credential, failures, lockedUntil);
      appendAudit(this.deps.db, {
        userId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { credential, failures },
      });
      if (lockedUntil !== null && remainingLockSeconds(lockedUntil, now) >= 900) {
        appendAudit(this.deps.db, {
          userId: user.id,
          action: 'auth.account_locked',
          entityType: 'user',
          entityId: user.id,
          details: { credential, until: lockedUntil },
        });
      }
    })();
  }

  private openSession(user: UserRecord, method: AuthMethod): SessionInfo {
    this.deps.db.transaction(() => {
      recordSuccess(this.deps.db, user.id, method);
      appendAudit(this.deps.db, { userId: user.id, action: 'auth.login', details: { method } });
    })();
    this.deps.sessions.start({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      method,
      mustChangePassword: method === 'password' && user.mustChangePassword,
      idleLockMs: this.idleLockSeconds() * 1000,
    });
    return this.infoOrThrow();
  }

  private idleLockSeconds(): number {
    if (this.deps.idleLockSecondsOverride !== undefined) return this.deps.idleLockSecondsOverride;
    const minutes = getSetting(
      this.deps.db,
      'security.idle_lock_minutes',
      z.number().int().min(1).max(240),
    );
    return minutes * 60;
  }

  private activeUser(id: number): UserRecord {
    const user = findUserById(this.deps.db, id);
    if (user?.isActive !== true) {
      this.deps.sessions.end();
      throw new AppError('UNAUTHENTICATED', 'Ce compte n’est plus actif.');
    }
    return user;
  }

  private infoOrThrow(): SessionInfo {
    const info = this.deps.sessions.info();
    if (info === null) throw new AppError('UNAUTHENTICATED', 'Connectez-vous pour continuer.');
    return info;
  }
}
