import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/** Variables qui feraient tourner l'application dans un autre mode que celui de production. */
const EXCLUDED_ENV = new Set(['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE']);

function testEnvironment(userData: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !EXCLUDED_ENV.has(name)) env[name] = value;
  }
  env.BOUTIQUE_TEST_USER_DATA = userData;
  return env;
}

/** Lance l'application compilée (`out/`) avec un dossier de données isolé. */
export async function launchApp(userData = createUserData()): Promise<LaunchedApp> {
  const app = await electron.launch({ args: ['.'], env: testEnvironment(userData) });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

export function createUserData(): string {
  return mkdtempSync(join(tmpdir(), 'boutique-e2e-'));
}

/** Electron peut garder ses fichiers ouverts un instant après la fermeture sous Windows. */
export function removeUserData(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
