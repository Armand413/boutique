import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineExecutor, type ReportExecutor } from '../../../src/main/reports/report-executor';
import type { ReportTask, TaskResult } from '../../../src/main/reports/report-tasks';
import { AppRuntime } from '../../../src/main/system/runtime';
import { ADMIN, fakeDialogs, fakeProtector } from './harness';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let directory: string;
let runtime: AppRuntime | null = null;

function newRuntime(): AppRuntime {
  runtime?.close();
  runtime = new AppRuntime({
    dataDirectory: directory,
    protector: fakeProtector,
    dialogs: fakeDialogs().dialogs,
    executorFactory: (db) => new InlineExecutor(db),
  });
  return runtime;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'boutique-runtime-'));
});

afterEach(() => {
  runtime?.close();
  runtime = null;
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function installShop(): Promise<string> {
  const first = newRuntime();
  await first.start();
  return first.requireServices().setup.complete({ shopName: 'Boutique test', ...ADMIN });
}

describe('démarrage de la base', () => {
  it('crée une base chiffrée vierge au premier lancement, puis la rouvre', async () => {
    await expect(newRuntime().start()).resolves.toEqual({
      state: 'ready',
      setupCompleted: false,
      shopName: '',
      auditChainBroken: false,
    });
    await installShop();
    await expect(newRuntime().start()).resolves.toMatchObject({
      state: 'ready',
      setupCompleted: true,
      shopName: 'Boutique test',
    });
    expect(readFileSync(join(directory, 'boutique.key')).subarray(0, 4).toString()).toBe('FAKE');
  });

  it('se verrouille si la clé protégée est perdue, et se rouvre avec la clé de récupération', async () => {
    const recoveryKey = await installShop();
    runtime?.close();
    unlinkSync(join(directory, 'boutique.key'));
    const restarted = newRuntime();
    await expect(restarted.start()).resolves.toEqual({ state: 'locked' });
    expect(() => restarted.requireServices()).toThrow(
      expect.objectContaining({ code: 'UNAVAILABLE' }),
    );
    await expect(
      restarted.unlockDatabase('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH'),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(restarted.unlockDatabase(recoveryKey)).resolves.toMatchObject({
      state: 'ready',
      setupCompleted: true,
    });
    const actions = restarted
      .requireServices()
      .db.prepare('SELECT action FROM audit_log')
      .pluck()
      .all();
    expect(actions).toContain('db.key_recovered');
    await expect(newRuntime().start()).resolves.toMatchObject({ state: 'ready' });
  });

  it('signale une clé introuvable quand aucun séquestre n’existe', async () => {
    await newRuntime().start();
    runtime?.close();
    unlinkSync(join(directory, 'boutique.key'));
    await expect(newRuntime().start()).resolves.toMatchObject({
      state: 'error',
      code: 'KEY_UNAVAILABLE',
    });
  });

  it('refuse d’ouvrir un fichier endommagé, sans planter', async () => {
    await installShop();
    runtime?.close();
    const file = join(directory, 'boutique.db');
    const content = readFileSync(file);
    content.fill(0x41, 4096, 8192);
    writeFileSync(file, content);
    const status = await newRuntime().start();
    expect(status.state === 'error' || status.state === 'locked').toBe(true);
  });

  it('signale une base endommagée quand l’ouverture lit une page altérée', async () => {
    await installShop();
    const db = runtime?.requireServices().db;
    const pages = Number(db?.pragma('page_count', { simple: true }));
    const pageSize = Number(db?.pragma('page_size', { simple: true }));
    runtime?.close();
    const file = join(directory, 'boutique.db');
    const content = readFileSync(file);
    content.fill(0x41, Math.floor(pages / 2) * pageSize, (pages - 1) * pageSize);
    writeFileSync(file, content);
    await expect(newRuntime().start()).resolves.toMatchObject({
      state: 'error',
      code: 'INTEGRITY',
    });
  });

  it('referme la base quand le contrôle d’intégrité lancé au démarrage échoue', async () => {
    await installShop();
    runtime?.close();
    let report: (problems: string[]) => void = () => undefined;
    const verdict = new Promise<string[]>((resolve) => {
      report = resolve;
    });
    runtime = new AppRuntime({
      dataDirectory: directory,
      protector: fakeProtector,
      dialogs: fakeDialogs().dialogs,
      executorFactory: (db): ReportExecutor => {
        const inline = new InlineExecutor(db);
        return {
          execute: <T extends ReportTask>(task: T) =>
            task.type === 'integrity'
              ? (verdict as Promise<TaskResult<T>>)
              : inline.execute(task),
          close: () => inline.close(),
        };
      },
    });
    const restarted = runtime;
    await expect(restarted.start()).resolves.toMatchObject({ state: 'ready' });
    expect(restarted.requireServices().db.open).toBe(true);
    report(['Page 42: btreeInitPage() returns error']);
    await restarted.integrityChecked();
    expect(restarted.getStatus()).toMatchObject({ state: 'error', code: 'INTEGRITY' });
    expect(() => restarted.requireServices()).toThrow(
      expect.objectContaining({ code: 'UNAVAILABLE' }),
    );
  });
});
