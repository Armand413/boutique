import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeBackup,
  encodeBackup,
  readBackupHeader,
} from '../../../src/main/backup/backup-format';
import { BackupSecretStore, deriveBackupKey, newKdf } from '../../../src/main/backup/backup-secret';
import { BackupService } from '../../../src/main/backup/backup-service';
import type { Session } from '../../../src/main/auth/session';
import { InlineExecutor } from '../../../src/main/reports/report-executor';
import { AppRuntime } from '../../../src/main/system/runtime';
import { ADMIN, fakeDialogs, fakeProtector } from '../auth/harness';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function signedIn(session: Session | null): Session {
  if (session === null) throw new Error('aucune session');
  return session;
}

const BACKUP_PASSWORD = 'Sauvegarde-Coffre-77';
let root: string;
const runtimes: AppRuntime[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'boutique-sauvegarde-'));
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function newRuntime(directory: string, files: { open?: string; save?: string }) {
  const dialogs = fakeDialogs(files);
  const runtime = new AppRuntime({
    dataDirectory: directory,
    protector: fakeProtector,
    dialogs: dialogs.dialogs,
    appVersion: '1.0.0-test',
    executorFactory: (db) => new InlineExecutor(db),
  });
  runtimes.push(runtime);
  return { runtime, dialogs: dialogs.state };
}

/** Boutique installée, administrateur connecté, mot de passe des sauvegardes défini. */
async function installedShop(directory: string, files: { open?: string; save?: string }) {
  const shop = newRuntime(directory, files);
  await shop.runtime.start();
  const services = shop.runtime.requireServices();
  await services.setup.complete({ shopName: 'Boutique du Plateau', ...ADMIN });
  await services.auth.login(ADMIN.username, ADMIN.password);
  const admin = signedIn(services.sessions.current());
  await services.backups.setPassword(admin, ADMIN.password, BACKUP_PASSWORD);
  return { ...shop, admin };
}

describe('format de sauvegarde', () => {
  it('chiffre base, clé et séquestre ; refuse un mauvais mot de passe et toute modification', async () => {
    const kdf = { ...newKdf(), memoryCost: 8192, timeCost: 1 };
    const key = await deriveBackupKey('mot-de-passe-solide', kdf);
    const database = Buffer.from('contenu de la base');
    const file = encodeBackup(
      {
        kind: 'manual',
        createdAt: '2026-11-11T10:00:00.000Z',
        appVersion: '1.0.0',
        schemaVersion: 10,
        shopName: 'Test',
        kdf,
      },
      key,
      { database, databaseKey: Buffer.alloc(32, 1), escrow: '{"version":1}' },
    );
    expect(file.includes(database)).toBe(false);
    expect(readBackupHeader(file)).toMatchObject({ kind: 'manual', shopName: 'Test' });
    expect(decodeBackup(file, key)).toMatchObject({ database, escrow: '{"version":1}' });
    const wrong = await deriveBackupKey('autre-mot-de-passe', kdf);
    expect(() => decodeBackup(file, wrong)).toThrow(/Mot de passe incorrect/);
    for (const position of [20, file.length - 40, file.length - 1]) {
      const tampered = Buffer.from(file);
      tampered[position] = (tampered[position] ?? 0) ^ 0xff;
      expect(() => decodeBackup(tampered, key)).toThrow();
    }
    expect(() => readBackupHeader(Buffer.from('pas une sauvegarde du tout'))).toThrow(
      /pas une sauvegarde/,
    );
  });
});

describe('sauvegarde et restauration', () => {
  it('sauvegarde manuellement, puis restaure sur le même poste après une copie de sécurité', async () => {
    const data = join(root, 'poste');
    const file = join(root, 'cle-usb.bgsauv');
    const shop = await installedShop(data, { save: file, open: file });
    const services = shop.runtime.requireServices();
    expect(services.backups.status(shop.admin).reminderDue).toBe(true);
    await expect(services.backups.backupNow(shop.admin)).resolves.toEqual({ saved: true });
    const status = services.backups.status(shop.admin);
    expect(status.reminderDue).toBe(false);
    expect(status.history[0]).toMatchObject({
      type: 'manual',
      status: 'success',
      fileName: 'cle-usb.bgsauv',
    });
    expect(readFileSync(file).includes(Buffer.from('Boutique du Plateau'))).toBe(true);

    services.db
      .prepare("UPDATE settings SET value = '\"Nom modifié\"' WHERE key = 'shop.name'")
      .run();
    const preview = await shop.runtime.chooseBackup(shop.admin);
    expect(preview).toMatchObject({
      shopName: 'Boutique du Plateau',
      compatible: true,
      kind: 'manual',
    });
    await expect(
      shop.runtime.restoreBackup(
        { token: preview?.token ?? '', password: BACKUP_PASSWORD, currentPassword: 'faux' },
        shop.admin,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const again = await shop.runtime.chooseBackup(shop.admin);
    await expect(
      shop.runtime.restoreBackup(
        {
          token: again?.token ?? '',
          password: 'mauvais-mot-de-passe',
          currentPassword: ADMIN.password,
        },
        shop.admin,
      ),
    ).rejects.toThrow(/Mot de passe incorrect/);
    const last = await shop.runtime.chooseBackup(shop.admin);
    await expect(
      shop.runtime.restoreBackup(
        { token: last?.token ?? '', password: BACKUP_PASSWORD, currentPassword: ADMIN.password },
        shop.admin,
      ),
    ).resolves.toMatchObject({
      state: 'ready',
      setupCompleted: true,
      shopName: 'Boutique du Plateau',
    });
    const saved = readdirSync(join(data, 'sauvegardes'));
    expect(saved.some((name) => name.startsWith('avant-restauration-'))).toBe(true);
    expect(saved.some((name) => name.startsWith('base-remplacee-'))).toBe(true);
    const restored = shop.runtime.requireServices();
    expect(restored.sessions.current()).toBeNull();
    expect(
      restored.db
        .prepare("SELECT count(*) FROM audit_log WHERE action = 'backup.restored'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('restaure sur un poste neuf sans session, avec la clé et le séquestre de la sauvegarde', async () => {
    const file = join(root, 'externe.bgsauv');
    const shop = await installedShop(join(root, 'ancien'), { save: file });
    await shop.runtime.requireServices().backups.backupNow(shop.admin);

    const fresh = newRuntime(join(root, 'neuf'), { open: file });
    await fresh.runtime.start();
    const preview = await fresh.runtime.chooseBackup(null);
    await expect(
      fresh.runtime.restoreBackup(
        { token: preview?.token ?? '', password: BACKUP_PASSWORD, currentPassword: null },
        null,
      ),
    ).resolves.toMatchObject({ state: 'ready', setupCompleted: true });
    const services = fresh.runtime.requireServices();
    await services.auth.login(ADMIN.username, ADMIN.password);
    const admin = signedIn(services.sessions.current());
    expect(services.backups.status(admin).passwordSet).toBe(true);
    expect(existsSync(join(root, 'neuf', 'boutique.key.recovery'))).toBe(true);
    // La boutique est configurée : la restauration sans session est désormais refusée.
    await expect(fresh.runtime.chooseBackup(null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuse une sauvegarde modifiée et ne touche pas à la base courante', async () => {
    const file = join(root, 'copie.bgsauv');
    const shop = await installedShop(join(root, 'poste'), { save: file, open: file });
    await shop.runtime.requireServices().backups.backupNow(shop.admin);
    const tampered = readFileSync(file);
    tampered[tampered.length - 100] = (tampered[tampered.length - 100] ?? 0) ^ 0x01;
    writeFileSync(file, tampered);
    const preview = await shop.runtime.chooseBackup(shop.admin);
    await expect(
      shop.runtime.restoreBackup(
        { token: preview?.token ?? '', password: BACKUP_PASSWORD, currentPassword: ADMIN.password },
        shop.admin,
      ),
    ).rejects.toThrow(/modifiée/);
    expect(shop.runtime.getStatus()).toMatchObject({
      state: 'ready',
      shopName: 'Boutique du Plateau',
    });
    expect(() => shop.runtime.requireServices()).not.toThrow();
  });

  it('sauvegarde automatiquement une fois par jour et garde les N dernières copies', async () => {
    const shop = await installedShop(join(root, 'poste'), {});
    const { db } = shop.runtime.requireServices();
    db.prepare("UPDATE settings SET value = '2' WHERE key = 'backup.keep'").run();
    const secrets = new BackupSecretStore(join(root, 'secret'), fakeProtector);
    let now = new Date('2026-11-01T08:00:00.000Z');
    const backups = new BackupService({
      db,
      executor: new InlineExecutor(db),
      secrets,
      databaseKey: Buffer.alloc(32, 3),
      escrowPath: join(root, 'absent'),
      directory: join(root, 'sauvegardes'),
      dialogs: fakeDialogs().dialogs,
      appVersion: 'test',
      confirmPassword: () => Promise.resolve(),
      clock: () => now,
    });
    expect(await backups.runAutomatic()).toBe('skipped');
    await secrets.set(BACKUP_PASSWORD);
    expect(await backups.runAutomatic()).toBe('done');
    expect(await backups.runAutomatic()).toBe('skipped');
    for (let day = 0; day < 3; day += 1) {
      now = new Date(now.getTime() + 25 * 3600_000);
      expect(await backups.runAutomatic()).toBe('done');
    }
    expect(readdirSync(join(root, 'sauvegardes', 'auto'))).toHaveLength(2);
    expect(backups.readStatus().lastAuto).toBe(now.toISOString());
    expect(
      db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get('maintenance.last_vacuum'),
    ).not.toBe('null');
  });
});
