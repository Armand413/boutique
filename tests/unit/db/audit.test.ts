import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendAudit, verifyAuditChain } from '../../../src/main/audit/audit-log';
import { createTestDatabase, insertUser, type TestDatabase } from './helpers';

let test: TestDatabase;
let userId: number;

beforeEach(() => {
  test = createTestDatabase();
  userId = insertUser(test.db);
});

afterEach(() => {
  test.cleanup();
});

function fill(count: number): void {
  for (let i = 0; i < count; i += 1) {
    appendAudit(test.db, { userId, action: 'auth.login', details: { index: i } });
  }
}

describe('journal d’audit chaîné (B.4)', () => {
  it('valide une chaîne intacte', () => {
    fill(20);
    expect(verifyAuditChain(test.db)).toEqual({ ok: true, checked: 20, brokenAtId: null });
  });

  it('valide une chaîne vide', () => {
    expect(verifyAuditChain(test.db)).toEqual({ ok: true, checked: 0, brokenAtId: null });
  });

  it('refuse toute modification ou suppression', () => {
    fill(2);
    expect(() => test.db.prepare("UPDATE audit_log SET action = 'x.y'").run()).toThrow(/IMMUTABLE/);
    expect(() => test.db.prepare('DELETE FROM audit_log').run()).toThrow(/IMMUTABLE/);
  });

  it('refuse une ligne dont l’empreinte ou le chaînage est faux', () => {
    fill(1);
    const insert = (prev: string, hash: string): unknown =>
      test.db
        .prepare(
          `INSERT INTO audit_log (user_id, action, details, created_at, prev_hash, hash)
           VALUES (NULL, 'faux.ajout', '{}', '2026-11-10T10:00:00Z', ?, ?)`,
        )
        .run(prev, hash);
    const last = test.db
      .prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
      .pluck()
      .get() as string;
    expect(() => insert('0'.repeat(64), 'a'.repeat(64))).toThrow(/AUDIT_CHAIN/);
    expect(() => insert(last, 'a'.repeat(64))).toThrow(/AUDIT_CHAIN/);
  });

  it('empêche un autre outil, même avec la clé, d’écrire dans le journal', () => {
    test.db.close();
    const raw = new Database(test.file);
    raw.pragma("cipher = 'sqlcipher'");
    raw.pragma('legacy = 4');
    raw.pragma(`key = "x'${test.key.toString('hex')}'"`);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO audit_log (action, details, created_at, prev_hash, hash)
           VALUES ('faux.ajout', '{}', '2026-11-10T10:00:00Z', ?, ?)`,
        )
        .run('0'.repeat(64), 'b'.repeat(64)),
    ).toThrow(/audit_hash/);
    raw.close();
  });

  it('détecte une altération faite en contournant les triggers', () => {
    fill(10);
    test.db.exec('DROP TRIGGER trg_audit_log_no_update');
    test.db.prepare('UPDATE audit_log SET details = \'{"index":99}\' WHERE id = 6').run();
    expect(verifyAuditChain(test.db)).toEqual({ ok: false, checked: 5, brokenAtId: 6 });
  });

  it('détecte la suppression d’une ligne au milieu de la chaîne', () => {
    fill(10);
    test.db.exec('DROP TRIGGER trg_audit_log_no_delete');
    test.db.prepare('DELETE FROM audit_log WHERE id = 4').run();
    expect(verifyAuditChain(test.db)).toMatchObject({ ok: false, brokenAtId: 5 });
  });

  it('masque toute donnée sensible des détails', () => {
    appendAudit(test.db, {
      userId,
      action: 'user.created',
      details: { username: 'awa', password: 'Secret123!' },
    });
    const details = test.db.prepare('SELECT details FROM audit_log').pluck().get() as string;
    expect(details).not.toContain('Secret123!');
    expect(JSON.parse(details)).toEqual({ username: 'awa', password: '[masqué]' });
  });
});
