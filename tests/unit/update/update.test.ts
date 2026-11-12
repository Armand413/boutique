import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../../src/main/auth/session';
import { InlineExecutor } from '../../../src/main/reports/report-executor';
import { AppRuntime } from '../../../src/main/system/runtime';
import type { ExecutableInfo } from '../../../src/main/update/installer-inspector';
import {
  compareVersions,
  judgeInstaller,
  PRODUCT_NAME,
} from '../../../src/main/update/update-service';
import { ADMIN, fakeDialogs, fakeProtector } from '../auth/harness';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const BACKUP_PASSWORD = 'Coffre-Fort-Lagune-2026';

function info(overrides: Partial<ExecutableInfo> = {}): ExecutableInfo {
  return {
    signature: 'unsigned',
    signer: null,
    thumbprint: null,
    productName: PRODUCT_NAME,
    productVersion: '1.1.0',
    ...overrides,
  };
}

const SIGNED = { signature: 'valid' as const, signer: 'CN=Editeur', thumbprint: 'AA11' };

describe('versions et verdict sur un installateur (D82)', () => {
  it('compare les versions numériquement', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0-beta', '1.0.0')).toBe(-1);
  });

  it('refuse un autre produit, une signature invalide ou une version qui n’est pas plus récente', () => {
    const current = info({ productVersion: '1.0.0' });
    expect(judgeInstaller(info({ productName: 'Autre' }), current, '1.0.0').verdict).toBe(
      'refused',
    );
    expect(judgeInstaller(info({ signature: 'invalid' }), current, '1.0.0').verdict).toBe(
      'refused',
    );
    expect(judgeInstaller(info({ productVersion: '1.0.0' }), current, '1.0.0').verdict).toBe(
      'refused',
    );
    expect(judgeInstaller(info({ productVersion: '0.9.0' }), current, '1.0.0').verdict).toBe(
      'refused',
    );
  });

  it('exige le même signataire quand l’application installée est signée', () => {
    const current = info({ ...SIGNED, productVersion: '1.0.0' });
    expect(judgeInstaller(info(SIGNED), current, '1.0.0').verdict).toBe('ready');
    expect(judgeInstaller(info(), current, '1.0.0').verdict).toBe('refused');
    expect(judgeInstaller(info({ ...SIGNED, thumbprint: 'BB22' }), current, '1.0.0').verdict).toBe(
      'refused',
    );
  });

  it('demande un accord explicite pour un installateur non signé si l’application ne l’est pas', () => {
    const current = info({ productVersion: '1.0.0' });
    expect(judgeInstaller(info(), current, '1.0.0').verdict).toBe('unsigned');
    expect(judgeInstaller(info(SIGNED), current, '1.0.0').verdict).toBe('ready');
  });
});

describe('mise à jour depuis un setup.exe', () => {
  let directory: string;
  let runtime: AppRuntime;
  let installer: string;
  let inspected: ExecutableInfo;
  const launched: string[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'boutique-update-'));
    installer = join(directory, 'Boutique-Gestion-Setup-1.1.0.exe');
    writeFileSync(installer, 'programme d’installation');
    inspected = info();
    launched.length = 0;
    runtime = new AppRuntime({
      dataDirectory: join(directory, 'donnees'),
      protector: fakeProtector,
      dialogs: fakeDialogs({ open: installer }).dialogs,
      executorFactory: (db) => new InlineExecutor(db),
      appVersion: '1.0.0',
      updates: {
        inspector: {
          inspect: (path) =>
            Promise.resolve(
              path.endsWith('app.exe') ? info({ productVersion: '1.0.0' }) : inspected,
            ),
        },
        launcher: { launch: (path) => launched.push(path) },
        currentExecutable: join(directory, 'app.exe'),
      },
    });
    await runtime.start();
    await runtime.requireServices().setup.complete({ shopName: 'Boutique test', ...ADMIN });
    await runtime.requireServices().auth.login(ADMIN.username, ADMIN.password);
  });

  afterEach(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function admin(): Session {
    const session = runtime.requireServices().sessions.current();
    if (session === null) throw new Error('aucune session');
    return session;
  }

  async function withBackupPassword(): Promise<void> {
    await runtime.requireServices().backups.setPassword(admin(), ADMIN.password, BACKUP_PASSWORD);
  }

  it('vérifie une copie, sauvegarde la base, trace l’opération puis lance la copie vérifiée', async () => {
    await withBackupPassword();
    const { updates, db } = runtime.requireServices();
    const preview = await updates.choose(admin());
    expect(preview).toMatchObject({
      fileName: 'Boutique-Gestion-Setup-1.1.0.exe',
      version: '1.1.0',
      currentVersion: '1.0.0',
      verdict: 'unsigned',
    });
    const input = { token: preview?.token ?? '', currentPassword: ADMIN.password };
    await expect(
      updates.install(admin(), { ...input, acceptUnsigned: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const again = await updates.choose(admin());
    await expect(
      updates.install(admin(), {
        token: again?.token ?? '',
        currentPassword: ADMIN.password,
        acceptUnsigned: true,
      }),
    ).resolves.toEqual({ started: true });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatch(/mise-a-jour[\\/]installateur-[0-9a-f]+\.exe$/);
    expect(existsSync(launched[0] ?? '')).toBe(true);
    expect(
      readdirSync(join(directory, 'donnees', 'sauvegardes')).some((name) =>
        name.startsWith('avant-mise-a-jour-1.1.0-'),
      ),
    ).toBe(true);
    expect(
      db
        .prepare("SELECT count(*) FROM audit_log WHERE action = 'app.update_started'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('refuse sans mot de passe correct, sans mot de passe des sauvegardes, ou une version refusée', async () => {
    const { updates } = runtime.requireServices();
    let preview = await updates.choose(admin());
    await expect(
      updates.install(admin(), {
        token: preview?.token ?? '',
        currentPassword: 'faux',
        acceptUnsigned: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    preview = await updates.choose(admin());
    await expect(
      updates.install(admin(), {
        token: preview?.token ?? '',
        currentPassword: ADMIN.password,
        acceptUnsigned: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await withBackupPassword();
    inspected = info({ productVersion: '1.0.0' });
    preview = await updates.choose(admin());
    expect(preview?.verdict).toBe('refused');
    await expect(
      updates.install(admin(), {
        token: preview?.token ?? '',
        currentPassword: ADMIN.password,
        acceptUnsigned: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(launched).toEqual([]);
  });

  it('refuse un fichier modifié après sa vérification', async () => {
    await withBackupPassword();
    const { updates } = runtime.requireServices();
    const preview = await updates.choose(admin());
    const staged = readdirSync(join(directory, 'donnees', 'mise-a-jour'));
    expect(staged).toHaveLength(1);
    writeFileSync(join(directory, 'donnees', 'mise-a-jour', staged[0] ?? ''), 'autre contenu');
    await expect(
      updates.install(admin(), {
        token: preview?.token ?? '',
        currentPassword: ADMIN.password,
        acceptUnsigned: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(launched).toEqual([]);
  });
});

describe('vérification par Windows (PowerShell)', () => {
  it.runIf(process.platform === 'win32')(
    'lit la signature et la version d’un exécutable, même au nom piégé',
    async () => {
      const { windowsExecutableInspector } =
        await import('../../../src/main/update/installer-inspector');
      const node = await windowsExecutableInspector.inspect(process.execPath);
      expect(node.productName).toBe('Node.js');
      expect(node.signature).toBe('valid');
      expect(node.signer).toMatch(/CN=/);
      const directory = mkdtempSync(join(tmpdir(), 'boutique-inspect-'));
      const trapped = join(directory, "piege'; $(Remove-Item x) `; & calc.exe");
      writeFileSync(trapped, 'pas un exécutable');
      try {
        // Fichier non exécutable : Windows ne sait pas le vérifier, il est traité comme invalide.
        await expect(windowsExecutableInspector.inspect(trapped)).resolves.toMatchObject({
          signature: 'invalid',
          productName: '',
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
