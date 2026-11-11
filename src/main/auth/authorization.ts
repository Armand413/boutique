import { AppError } from '@shared/ipc/errors';
import type { Permission } from '@shared/permissions';
import type { Session, SessionManager } from './session';

export interface SessionRequirement {
  permission?: Permission;
  /** Autorisé sur une session verrouillée (déverrouillage). */
  allowLocked?: boolean;
  /** Autorisé avant le changement de mot de passe imposé. */
  allowPasswordChange?: boolean;
}

/**
 * Contrôle d'accès appliqué par le processus principal (B.2) : session ouverte, non verrouillée,
 * mot de passe à jour, et permission du rôle. Les services le rappellent pour leurs propres règles.
 */
export function requireSession(
  sessions: SessionManager,
  requirement: SessionRequirement = {},
): Session {
  const session = sessions.current();
  if (session === null) throw new AppError('UNAUTHENTICATED', 'Connectez-vous pour continuer.');
  if (session.locked && requirement.allowLocked !== true) {
    throw new AppError(
      'SESSION_LOCKED',
      'Session verrouillée : saisissez votre code pour continuer.',
    );
  }
  if (
    session.mustChangePassword &&
    requirement.allowPasswordChange !== true &&
    requirement.allowLocked !== true
  ) {
    throw new AppError(
      'PASSWORD_CHANGE_REQUIRED',
      'Choisissez un nouveau mot de passe pour continuer.',
    );
  }
  if (requirement.permission !== undefined) requirePermission(session, requirement.permission);
  return session;
}

export function requirePermission(session: Session, permission: Permission): void {
  if (!session.permissions.has(permission)) {
    const hint = session.method === 'pin' ? ' Connectez-vous avec votre mot de passe.' : '';
    throw new AppError('FORBIDDEN', `Vous n’avez pas le droit d’effectuer cette opération.${hint}`);
  }
}
