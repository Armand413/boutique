import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireSession } from '../../../src/main/auth/authorization';
import { verifyAuditChain } from '../../../src/main/audit/audit-log';
import { ADMIN, createAuthHarness, setupShop, type AuthHarness } from './harness';

let h: AuthHarness;

beforeEach(async () => {
  h = await createAuthHarness();
});

afterEach(() => {
  h.cleanup();
});

function actions(): string[] {
  return h.test.db.prepare('SELECT action FROM audit_log ORDER BY id').pluck().all() as string[];
}

const advance = (seconds: number): void => {
  h.clock.now += seconds * 1000;
};

describe('assistant de premier lancement', () => {
  it('crée l’administrateur, enregistre la boutique et remet une clé de récupération', async () => {
    const recoveryKey = await setupShop(h);
    expect(recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(h.setup.isCompleted()).toBe(true);
    expect(h.setup.shopName()).toBe('Boutique du Plateau');
    expect(actions()).toEqual(['setup.completed']);
  });

  it('refuse deux installations simultanées (une seule clé de récupération valable)', async () => {
    const attempts = await Promise.allSettled([setupShop(h), setupShop(h)]);
    const done = attempts.filter((attempt) => attempt.status === 'fulfilled');
    expect(done).toHaveLength(1);
    const [first] = done;
    if (first?.status !== 'fulfilled') throw new Error('aucune installation');
    await expect(h.keyStore.recoverKey(first.value)).resolves.toEqual(h.test.key);
  });

  it('ne peut être rejoué une fois terminé', async () => {
    await setupShop(h);
    await expect(setupShop(h)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuse un mot de passe faible pour l’administrateur', async () => {
    await expect(
      h.setup.complete({ shopName: 'B', ...ADMIN, password: 'azerty2026' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      h.setup.complete({ shopName: 'B', ...ADMIN, password: 'court' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(h.setup.isCompleted()).toBe(false);
  });

  it('séquestre la clé de la base sous la clé de récupération, sans la stocker en clair', async () => {
    const recoveryKey = await setupShop(h);
    const escrow = readFileSync(h.keyStore.escrowPath, 'utf8');
    expect(escrow).not.toContain(h.test.key.toString('hex'));
    expect(escrow).not.toContain(h.test.key.toString('base64'));
    await expect(
      h.keyStore.recoverKey(recoveryKey.toLowerCase().replace(/-/g, ' ')),
    ).resolves.toEqual(h.test.key);
    await expect(
      h.keyStore.recoverKey('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
});

describe('connexion et limitation des tentatives (B.1)', () => {
  beforeEach(async () => {
    await setupShop(h);
  });

  it('ouvre une session avec tous les droits du rôle', async () => {
    const info = await h.auth.login('PATRON', ADMIN.password);
    expect(info).toMatchObject({
      user: { username: 'patron', role: 'admin' },
      method: 'password',
      locked: false,
    });
    expect(info.permissions).toContain('user.manage');
    expect(actions()).toContain('auth.login');
  });

  it('donne le même message pour un identifiant inconnu et un mauvais mot de passe', async () => {
    const unknown = h.auth.login('inconnu', ADMIN.password);
    await expect(unknown).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Identifiant ou mot de passe incorrect.',
    });
    const wrong = h.auth.login('patron', 'mauvais-mot-de-passe');
    await expect(wrong).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Identifiant ou mot de passe incorrect.',
    });
  });

  it('impose un délai croissant puis un blocage de 15 minutes', async () => {
    for (let i = 0; i < 3; i += 1)
      await expect(h.auth.login('patron', 'faux')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    await expect(h.auth.login('patron', ADMIN.password)).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    advance(6);
    await expect(h.auth.login('patron', 'faux')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    advance(11);
    await expect(h.auth.login('patron', 'faux')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(h.auth.login('patron', ADMIN.password)).rejects.toThrow(/15 min/);
    expect(actions()).toContain('auth.account_locked');
    advance(15 * 60);
    await expect(h.auth.login('patron', ADMIN.password)).resolves.toMatchObject({
      user: { username: 'patron' },
    });
    expect(h.test.db.prepare('SELECT failed_attempts FROM users').pluck().get()).toBe(0);
  });

  it('refuse un compte désactivé', async () => {
    await h.auth.login('patron', ADMIN.password);
    const seller = await h.users.create(h.current(), {
      username: 'awa',
      fullName: 'Awa Vendeuse',
      role: 'seller',
      temporaryPassword: 'Provisoire-2026',
    });
    h.users.update(h.current(), seller.id, { isActive: false });
    await expect(h.auth.login('awa', 'Provisoire-2026')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
});

describe('sessions : changement imposé, PIN, inactivité', () => {
  beforeEach(async () => {
    await setupShop(h);
    await h.auth.login('patron', ADMIN.password);
    await h.users.create(h.current(), {
      username: 'awa',
      fullName: 'Awa',
      role: 'seller',
      temporaryPassword: 'Provisoire-2026',
    });
    h.auth.logout();
  });

  it('impose le changement d’un mot de passe provisoire avant toute autre action', async () => {
    const info = await h.auth.login('awa', 'Provisoire-2026');
    expect(info.mustChangePassword).toBe(true);
    expect(() => requireSession(h.sessions)).toThrow(
      expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }),
    );
    await expect(h.auth.changePassword('Provisoire-2026', 'Provisoire-2026')).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
    await expect(h.auth.changePassword('faux', 'Mangue-Sucree-77')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const changed = await h.auth.changePassword('Provisoire-2026', 'Mangue-Sucree-77');
    expect(changed.mustChangePassword).toBe(false);
    expect(() => requireSession(h.sessions)).not.toThrow();
  });

  it('limite une session PIN aux droits de caisse', async () => {
    await h.auth.login('awa', 'Provisoire-2026');
    await h.auth.changePassword('Provisoire-2026', 'Mangue-Sucree-77');
    await expect(h.auth.setOwnPin('Mangue-Sucree-77', '1234')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await h.auth.setOwnPin('Mangue-Sucree-77', '4071');
    h.auth.logout();
    const info = await h.auth.loginWithPin('awa', '4071');
    expect(info.method).toBe('pin');
    expect(info.permissions.sort()).toEqual([
      'customer.manage',
      'pos.use',
      'product.view',
      'stock.view',
    ]);
    await expect(h.auth.loginWithPin('patron', '4071')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('verrouille après inactivité et se déverrouille avec le bon secret', async () => {
    await h.auth.login('patron', ADMIN.password);
    advance(4 * 60);
    h.sessions.touch();
    advance(4 * 60);
    expect(h.auth.sessionInfo()?.locked).toBe(false);
    advance(60);
    expect(h.auth.sessionInfo()?.locked).toBe(true);
    expect(() => requireSession(h.sessions)).toThrow(
      expect.objectContaining({ code: 'SESSION_LOCKED' }),
    );
    await expect(h.auth.unlock('faux')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(h.auth.unlock(ADMIN.password)).resolves.toMatchObject({ locked: false });
    expect(actions()).toEqual(expect.arrayContaining(['auth.session_unlocked']));
  });

  it('ferme la session si le déverrouillage aboutit à un blocage du compte', async () => {
    await h.auth.login('patron', ADMIN.password);
    h.auth.lock();
    for (let i = 0; i < 3; i += 1) await expect(h.auth.unlock('faux')).rejects.toBeDefined();
    await expect(h.auth.unlock(ADMIN.password)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    expect(h.auth.sessionInfo()).toBeNull();
  });
});

describe('gestion des utilisateurs et rôles (B.2)', () => {
  beforeEach(async () => {
    await setupShop(h);
    await h.auth.login('patron', ADMIN.password);
  });

  it('réserve la gestion des comptes aux administrateurs, côté service', async () => {
    await h.users.create(h.current(), {
      username: 'koffi',
      fullName: 'Koffi',
      role: 'manager',
      temporaryPassword: 'Provisoire-2026',
    });
    h.auth.logout();
    await h.auth.login('koffi', 'Provisoire-2026');
    await h.auth.changePassword('Provisoire-2026', 'Baobab-Geant-12');
    expect(() => h.users.list(h.current())).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => requireSession(h.sessions, { permission: 'user.manage' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('refuse un identifiant déjà pris et protège le compte de l’administrateur connecté', async () => {
    await expect(
      h.users.create(h.current(), {
        username: 'PATRON',
        fullName: 'X',
        role: 'seller',
        temporaryPassword: 'Provisoire-2026',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const self = h.current().userId;
    expect(() => h.users.update(h.current(), self, { isActive: false })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => h.users.update(h.current(), self, { role: 'seller' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('réinitialise un mot de passe en imposant son changement', async () => {
    const seller = await h.users.create(h.current(), {
      username: 'awa',
      fullName: 'Awa',
      role: 'seller',
      temporaryPassword: 'Provisoire-2026',
    });
    const reset = await h.users.resetPassword(h.current(), seller.id, 'Nouveau-Depart-9');
    expect(reset.mustChangePassword).toBe(true);
    expect(actions()).toEqual(expect.arrayContaining(['user.created', 'user.password_reset']));
  });
});

describe('récupération du compte administrateur', () => {
  it('remet un nouveau mot de passe et remplace aussitôt la clé utilisée', async () => {
    const firstKey = await setupShop(h);
    for (let i = 0; i < 5; i += 1)
      await expect(h.auth.login('patron', 'faux'))
        .rejects.toBeDefined()
        .catch(() => undefined);
    advance(20);
    const nextKey = await h.auth.recoverAdmin('patron', firstKey, 'Recolte-Mil-2027');
    expect(nextKey).not.toBe(firstKey);
    await expect(h.auth.login('patron', 'Recolte-Mil-2027')).resolves.toMatchObject({
      user: { username: 'patron' },
    });
    h.auth.logout();
    await expect(h.auth.recoverAdmin('patron', firstKey, 'Autre-Chose-2028')).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
    await expect(h.keyStore.recoverKey(nextKey)).resolves.toEqual(h.test.key);
    await expect(h.keyStore.recoverKey(firstKey)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('bloque la récupération après cinq échecs', async () => {
    const key = await setupShop(h);
    for (let i = 0; i < 5; i += 1) {
      await expect(
        h.auth.recoverAdmin('patron', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH', 'X'),
      ).rejects.toBeDefined();
    }
    await expect(h.auth.recoverAdmin('patron', key, 'Recolte-Mil-2027')).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
  });
});

describe('journal d’audit', () => {
  it('reste intègre après toutes les opérations et n’enregistre aucun secret', async () => {
    await setupShop(h);
    await h.auth.login('patron', ADMIN.password);
    await expect(h.auth.login('patron', 'Secret-Faux-123')).rejects.toBeDefined();
    h.auth.logout();
    expect(verifyAuditChain(h.test.db).ok).toBe(true);
    const all = (h.test.db.prepare('SELECT details FROM audit_log').pluck().all() as string[]).join(
      '\n',
    );
    expect(all).not.toContain(ADMIN.password);
    expect(all).not.toContain('Secret-Faux-123');
    expect(all).not.toContain('$argon2id$');
  });

  it('se consulte et se vérifie avec la permission audit.view uniquement', async () => {
    await setupShop(h);
    await h.auth.login('patron', ADMIN.password);
    expect(h.audit.list(h.current(), 10).map((entry) => entry.action)).toEqual([
      'auth.login',
      'setup.completed',
    ]);
    expect(h.audit.verify(h.current())).toMatchObject({ ok: true, checked: 2 });
  });
});
