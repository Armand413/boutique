import { sessionPermissions, type Permission, type Role } from '@shared/permissions';
import type { SessionInfo } from '@shared/schemas/auth';

export type AuthMethod = 'password' | 'pin';

export interface Session {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
  method: AuthMethod;
  permissions: ReadonlySet<Permission>;
  mustChangePassword: boolean;
  locked: boolean;
  lastActivityAt: number;
  idleLockMs: number;
}

export interface SessionStart {
  userId: number;
  username: string;
  fullName: string;
  role: Role;
  method: AuthMethod;
  mustChangePassword: boolean;
  idleLockMs: number;
}

/**
 * Session unique du poste, tenue dans le processus principal (jamais dans l'interface).
 * Elle se verrouille d'elle-même après la durée d'inactivité.
 */
export class SessionManager {
  private session: Session | null = null;

  constructor(private readonly clock: () => number = Date.now) {}

  start(input: SessionStart): Session {
    this.session = {
      ...input,
      permissions: new Set(sessionPermissions(input.role, input.method)),
      locked: false,
      lastActivityAt: this.clock(),
    };
    return this.session;
  }

  end(): void {
    this.session = null;
  }

  /** Session courante, verrouillée si le délai d'inactivité est dépassé. */
  current(): Session | null {
    const session = this.session;
    if (
      session !== null &&
      !session.locked &&
      this.clock() - session.lastActivityAt >= session.idleLockMs
    ) {
      session.locked = true;
    }
    return session;
  }

  touch(): void {
    const session = this.current();
    if (session !== null && !session.locked) session.lastActivityAt = this.clock();
  }

  lock(): void {
    const session = this.current();
    if (session !== null) session.locked = true;
  }

  unlock(): void {
    const session = this.current();
    if (session === null) return;
    session.locked = false;
    session.lastActivityAt = this.clock();
  }

  passwordChanged(): void {
    const session = this.current();
    if (session !== null) session.mustChangePassword = false;
  }

  info(): SessionInfo | null {
    const session = this.current();
    if (session === null) return null;
    return {
      user: {
        id: session.userId,
        username: session.username,
        fullName: session.fullName,
        role: session.role,
      },
      method: session.method,
      permissions: [...session.permissions],
      locked: session.locked,
      mustChangePassword: session.mustChangePassword,
      idleLockSeconds: Math.max(1, Math.round(session.idleLockMs / 1000)),
    };
  }
}
