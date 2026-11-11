import { join } from 'node:path';
import { AuthService } from '../../../src/main/auth/auth-service';
import { SessionManager, type Session } from '../../../src/main/auth/session';
import { UserService } from '../../../src/main/auth/user-service';
import { AuditService } from '../../../src/main/audit/audit-service';
import { KeyStore, type KeyProtector } from '../../../src/main/db/keystore';
import { SetupService } from '../../../src/main/system/setup-service';
import { createTestDatabase, type TestDatabase } from '../db/helpers';

/** Protection factice (les tests unitaires tournent hors d'Electron, sans DPAPI). */
export const fakeProtector: KeyProtector = {
  isAvailable: () => Promise.resolve(true),
  protect: (plain) =>
    Promise.resolve(
      Buffer.concat([Buffer.from('FAKE'), Buffer.from(plain.map((byte) => byte ^ 0x5a))]),
    ),
  unprotect: (sealed) => {
    if (sealed.subarray(0, 4).toString() !== 'FAKE') return Promise.reject(new Error('illisible'));
    return Promise.resolve({
      plain: Buffer.from(sealed.subarray(4).map((byte) => byte ^ 0x5a)),
      stale: false,
    });
  },
};

export const ADMIN = {
  username: 'patron',
  fullName: 'Kouassi Patron',
  password: 'Lagune-Bleue-2026',
};

export interface AuthHarness {
  test: TestDatabase;
  clock: { now: number };
  sessions: SessionManager;
  keyStore: KeyStore;
  auth: AuthService;
  users: UserService;
  setup: SetupService;
  audit: AuditService;
  current: () => Session;
  cleanup: () => void;
}

export async function createAuthHarness(): Promise<AuthHarness> {
  const test = createTestDatabase();
  const clock = { now: Date.parse('2026-11-10T09:00:00Z') };
  const sessions = new SessionManager(() => clock.now);
  const keyStore = new KeyStore(
    join(test.directory, 'boutique.key'),
    join(test.directory, 'boutique.key.recovery'),
    fakeProtector,
  );
  await keyStore.saveKey(test.key);
  return {
    test,
    clock,
    sessions,
    keyStore,
    auth: new AuthService({
      db: test.db,
      sessions,
      keyStore,
      databaseKey: test.key,
      clock: () => clock.now,
    }),
    users: new UserService(test.db),
    setup: new SetupService(test.db, keyStore, test.key),
    audit: new AuditService(test.db),
    current: () => {
      const session = sessions.current();
      if (session === null) throw new Error('aucune session');
      return session;
    },
    cleanup: () => test.cleanup(),
  };
}

export async function setupShop(harness: AuthHarness): Promise<string> {
  return harness.setup.complete({ shopName: 'Boutique du Plateau', ...ADMIN });
}
