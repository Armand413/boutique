import { AppError } from '@shared/ipc/errors';
import type { Role } from '@shared/permissions';
import type { UserSummary } from '@shared/schemas/auth';
import { appendAudit } from '../audit/audit-log';
import type { Db } from '../db/types';
import { requirePermission } from './authorization';
import { assertPasswordAcceptable } from './credentials';
import { hashSecret } from './hashing';
import type { Session } from './session';
import {
  findUserById,
  findUserByUsername,
  insertUser,
  listUsers,
  setPassword,
  setPin,
  toSummary,
  updateUser,
  type UserChanges,
  type UserRecord,
} from './user-repository';

export interface CreateUserInput {
  username: string;
  fullName: string;
  role: Role;
  temporaryPassword: string;
}

/** Gestion des comptes (4.9), réservée à la permission user.manage. */
export class UserService {
  constructor(private readonly db: Db) {}

  list(actor: Session): UserSummary[] {
    requirePermission(actor, 'user.manage');
    return listUsers(this.db).map(toSummary);
  }

  async create(actor: Session, input: CreateUserInput): Promise<UserSummary> {
    requirePermission(actor, 'user.manage');
    if (findUserByUsername(this.db, input.username) !== null) {
      throw new AppError('CONFLICT', 'Cet identifiant est déjà utilisé.');
    }
    assertPasswordAcceptable(input.temporaryPassword, input.username);
    const passwordHash = await hashSecret(input.temporaryPassword);
    const id = this.db.transaction(() => {
      const userId = insertUser(this.db, {
        ...input,
        passwordHash,
        mustChangePassword: true,
        createdBy: actor.userId,
      });
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'user.created',
        entityType: 'user',
        entityId: userId,
        details: { username: input.username, role: input.role },
      });
      return userId;
    })();
    return toSummary(this.existing(id));
  }

  update(actor: Session, id: number, changes: UserChanges): UserSummary {
    requirePermission(actor, 'user.manage');
    const user = this.existing(id);
    if (
      id === actor.userId &&
      (changes.isActive === false || (changes.role !== undefined && changes.role !== user.role))
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Vous ne pouvez ni désactiver votre propre compte ni changer votre rôle.',
      );
    }
    this.db.transaction(() => {
      updateUser(this.db, id, changes);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        details: { ...changes, previousRole: user.role, previousActive: user.isActive },
      });
    })();
    return toSummary(this.existing(id));
  }

  /** Mot de passe provisoire : l'utilisateur devra le changer à sa prochaine connexion. */
  async resetPassword(actor: Session, id: number, temporaryPassword: string): Promise<UserSummary> {
    requirePermission(actor, 'user.manage');
    const user = this.existing(id);
    assertPasswordAcceptable(temporaryPassword, user.username);
    const passwordHash = await hashSecret(temporaryPassword);
    this.db.transaction(() => {
      setPassword(this.db, id, passwordHash, true);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
      });
    })();
    return toSummary(this.existing(id));
  }

  clearPin(actor: Session, id: number): UserSummary {
    requirePermission(actor, 'user.manage');
    this.existing(id);
    this.db.transaction(() => {
      setPin(this.db, id, null);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'user.pin_cleared',
        entityType: 'user',
        entityId: id,
      });
    })();
    return toSummary(this.existing(id));
  }

  private existing(id: number): UserRecord {
    const user = findUserById(this.db, id);
    if (user === null) throw new AppError('NOT_FOUND', 'Utilisateur introuvable.');
    return user;
  }
}
