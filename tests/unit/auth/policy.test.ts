import { describe, expect, it } from 'vitest';
import { lockoutSeconds, passwordProblems, pinProblems } from '@shared/auth/policy';
import { sessionPermissions } from '@shared/permissions';
import { isCommonPassword } from '../../../src/main/auth/common-passwords';
import { generateRecoveryKey, normalizeRecoveryKey } from '../../../src/main/auth/recovery-key';
import { SessionManager } from '../../../src/main/auth/session';

describe('mots de passe', () => {
  it('refuse les mots de passe courants, même décorés', () => {
    for (const candidate of [
      'azerty',
      'Azerty2026!',
      'MOTDEPASSE',
      'motdepasse123',
      'Bienvenue1',
      'abcabcabcabc',
      '1111111111',
    ]) {
      expect(isCommonPassword(candidate), candidate).toBe(true);
    }
    expect(isCommonPassword('Lagune-Bleue-2026')).toBe(false);
  });

  it('signale chaque problème', () => {
    expect(passwordProblems('court', 'awa', () => false)).toEqual(['too_short']);
    expect(passwordProblems('awa-et-ses-amis', 'awa', () => false)).toEqual(['contains_username']);
    expect(passwordProblems('Lagune-Bleue-2026', 'awa', () => false)).toEqual([]);
    expect(passwordProblems('ééééééééé', 'x', () => false)).toEqual(['too_short']);
  });
});

describe('codes PIN', () => {
  it('accepte 4 à 8 chiffres non triviaux', () => {
    expect(pinProblems('4071')).toEqual([]);
    expect(pinProblems('80243517')).toEqual([]);
    expect(pinProblems('123')).toEqual(['format']);
    expect(pinProblems('12a4')).toEqual(['format']);
    expect(pinProblems('123456789')).toEqual(['format']);
  });

  it('refuse les suites et les répétitions', () => {
    for (const pin of ['0000', '1234', '9876', '456789', '5555555'])
      expect(pinProblems(pin), pin).toEqual(['trivial']);
  });
});

describe('limitation des tentatives', () => {
  it('suit une progression bornée', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(lockoutSeconds)).toEqual([
      0, 0, 0, 5, 10, 900, 1800, 2700, 3600, 3600,
    ]);
  });
});

describe('clé de récupération', () => {
  it('se génère en 8 groupes et se relit malgré les erreurs de recopie courantes', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(normalizeRecoveryKey(key.toLowerCase())).toBe(key.replace(/-/g, ''));
    expect(normalizeRecoveryKey('o1il-0000-0000-0000-0000-0000-0000-0000')).toBe(
      '0111' + '0'.repeat(28),
    );
    expect(normalizeRecoveryKey('trop-court')).toBeNull();
    expect(normalizeRecoveryKey('UUUU-0000-0000-0000-0000-0000-0000-0000')).toBeNull();
  });

  it('change à chaque génération', () => {
    expect(new Set(Array.from({ length: 20 }, generateRecoveryKey)).size).toBe(20);
  });
});

describe('session', () => {
  it('limite les droits d’une session PIN à ceux du rôle', () => {
    expect(sessionPermissions('seller', 'pin').sort()).toEqual([
      'customer.manage',
      'pos.use',
      'product.view',
      'stock.view',
    ]);
    expect(sessionPermissions('admin', 'pin')).not.toContain('user.manage');
  });

  it('se verrouille seule après le délai d’inactivité', () => {
    let now = 0;
    const sessions = new SessionManager(() => now);
    sessions.start({
      userId: 1,
      username: 'a',
      fullName: 'A',
      role: 'seller',
      method: 'pin',
      mustChangePassword: false,
      idleLockMs: 1000,
    });
    now = 999;
    expect(sessions.info()?.locked).toBe(false);
    now = 1000;
    expect(sessions.info()?.locked).toBe(true);
    sessions.touch();
    expect(sessions.info()?.locked).toBe(true);
    sessions.unlock();
    expect(sessions.info()?.locked).toBe(false);
  });
});
