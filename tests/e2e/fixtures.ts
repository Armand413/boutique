import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

export const ADMIN = {
  shopName: 'Boutique du Plateau',
  fullName: 'Kouassi Patron',
  username: 'patron',
  password: 'Lagune-Bleue-2026',
};

/** Variables qui feraient tourner l'application dans un autre mode que celui de production. */
const EXCLUDED_ENV = new Set(['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE']);

function testEnvironment(userData: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !EXCLUDED_ENV.has(name)) env[name] = value;
  }
  return { ...env, ...extra, BOUTIQUE_TEST_USER_DATA: userData };
}

/** Lance l'application compilée (`out/`) avec un dossier de données isolé. */
export async function launchApp(
  userData = createUserData(),
  extraEnv: Record<string, string> = {},
): Promise<LaunchedApp> {
  const app = await electron.launch({ args: ['.'], env: testEnvironment(userData, extraEnv) });
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

export function dataFile(userData: string, name: string): string {
  return join(userData, 'donnees', name);
}

/** Assistant de premier lancement ; renvoie la clé de récupération affichée. */
export async function completeSetup(page: Page, admin = ADMIN): Promise<string> {
  await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue' })).toBeVisible();
  await page.getByLabel('Nom de la boutique').fill(admin.shopName);
  await page.getByLabel('Votre nom complet').fill(admin.fullName);
  await page.getByLabel('Identifiant de connexion').fill(admin.username);
  await page.getByLabel('Mot de passe administrateur').fill(admin.password);
  await page.getByLabel('Confirmez le mot de passe').fill(admin.password);
  await page.getByRole('button', { name: 'Créer le compte administrateur' }).click();
  const key = page.getByTestId('recovery-key');
  await expect(key).toBeVisible();
  const recoveryKey = (await key.textContent()) ?? '';
  await page.getByLabel('J’ai recopié la clé et je la garde en lieu sûr').check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
  return recoveryKey;
}

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.getByRole('tab', { name: 'Mot de passe' }).click();
  // Le panneau d'onglet porte lui-même le nom « Mot de passe » : on cherche le champ à l'intérieur.
  const panel = page.getByRole('tabpanel', { name: 'Mot de passe' });
  await panel.getByLabel('Identifiant').fill(username);
  await panel.getByLabel('Mot de passe', { exact: true }).fill(password);
  await panel.getByRole('button', { name: 'Se connecter' }).click();
}

/** Tentative refusée : attend la réponse du processus principal (le champ est alors vidé). */
export async function failLogin(page: Page, username: string, password: string): Promise<void> {
  await login(page, username, password);
  const panel = page.getByRole('tabpanel', { name: 'Mot de passe' });
  await expect(panel.getByLabel('Mot de passe', { exact: true })).toHaveValue('');
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
}

export function nav(page: Page) {
  return page.getByRole('navigation', { name: 'Navigation principale' });
}

/** Application installée et administrateur connecté, sur l'écran d'accueil. */
export async function launchReady(
  extraEnv: Record<string, string> = {},
): Promise<LaunchedApp & { recoveryKey: string }> {
  const launched = await launchApp(createUserData(), extraEnv);
  const recoveryKey = await completeSetup(launched.page);
  await login(launched.page, ADMIN.username, ADMIN.password);
  await expect(nav(launched.page)).toBeVisible();
  return { ...launched, recoveryKey };
}
