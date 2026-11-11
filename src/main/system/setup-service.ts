import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import type { SetupInput } from '@shared/schemas/auth';
import { appendAudit } from '../audit/audit-log';
import { assertPasswordAcceptable } from '../auth/credentials';
import { hashSecret } from '../auth/hashing';
import { generateRecoveryKey, normalizeRecoveryKey } from '../auth/recovery-key';
import { countUsers, insertUser } from '../auth/user-repository';
import type { KeyStore } from '../db/keystore';
import type { Db } from '../db/types';
import { getSetting, setSetting } from '../settings/settings-repository';

/**
 * Assistant de premier lancement : nom de la boutique, compte administrateur choisi par le patron
 * (aucun mot de passe par défaut n'existe), et clé de récupération remise une seule fois.
 */
export class SetupService {
  constructor(
    private readonly db: Db,
    private readonly keyStore: KeyStore,
    private readonly databaseKey: Buffer,
  ) {}

  isCompleted(): boolean {
    return getSetting(this.db, 'setup.completed', z.boolean());
  }

  shopName(): string {
    return getSetting(this.db, 'shop.name', z.string());
  }

  async complete(input: SetupInput): Promise<string> {
    if (this.isCompleted() || countUsers(this.db) > 0) {
      throw new AppError('CONFLICT', 'L’application est déjà configurée.');
    }
    assertPasswordAcceptable(input.password, input.username);
    const passwordHash = await hashSecret(input.password);
    const recoveryKey = generateRecoveryKey();
    const recoveryHash = await hashSecret(normalizeRecoveryKey(recoveryKey) ?? '');
    await this.keyStore.writeEscrow(this.databaseKey, recoveryKey);
    this.db.transaction(() => {
      if (countUsers(this.db) > 0)
        throw new AppError('CONFLICT', 'L’application est déjà configurée.');
      const adminId = insertUser(this.db, {
        username: input.username,
        fullName: input.fullName,
        role: 'admin',
        passwordHash,
        mustChangePassword: false,
        createdBy: null,
      });
      setSetting(this.db, 'shop.name', input.shopName, adminId);
      setSetting(this.db, 'security.recovery_key_hash', recoveryHash, adminId);
      setSetting(this.db, 'setup.completed', true, adminId);
      appendAudit(this.db, {
        userId: adminId,
        action: 'setup.completed',
        entityType: 'user',
        entityId: adminId,
        details: { shopName: input.shopName, username: input.username },
      });
    })();
    return recoveryKey;
  }
}
