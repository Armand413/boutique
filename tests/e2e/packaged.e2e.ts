import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { ADMIN, completeSetup, createUserData, login, nav, removeUserData } from './fixtures';
import { openModule, stubFileDialogs } from './helpers';

/**
 * Application INSTALLÉE par le setup.exe (phase 10) : `BOUTIQUE_PACKAGED_EXE` désigne l'exécutable
 * installé (voir `npm run test:packaged`). Le profil est isolé par `--user-data-dir` : les variables
 * de test sont ignorées par une application empaquetée.
 */
const executable = process.env.BOUTIQUE_PACKAGED_EXE;
/** Setup de la version suivante, non signé : proposé à la mise à jour après accord explicite. */
const nextSetup = process.env.BOUTIQUE_NEXT_SETUP;
let app: ElectronApplication | null = null;
let userData = '';

test.skip(executable === undefined || executable === '', 'BOUTIQUE_PACKAGED_EXE non défini');

test.afterEach(async () => {
  await app?.close();
  removeUserData(userData);
});

test('l’application installée démarre, garde ses données dans le profil et calcule ses rapports', async () => {
  test.setTimeout(3 * 60_000);
  userData = createUserData();
  app = await electron.launch({
    executablePath: executable ?? '',
    args: [`--user-data-dir=${userData}`],
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const packaged = await app.evaluate(({ app: electronApp }) => ({
    isPackaged: electronApp.isPackaged,
    userData: electronApp.getPath('userData'),
    appPath: electronApp.getAppPath(),
  }));
  expect(packaged.isPackaged).toBe(true);
  expect(packaged.userData.toLowerCase()).toBe(userData.toLowerCase());
  expect(packaged.appPath).toMatch(/app\.asar$/);

  await completeSetup(page);
  await login(page, ADMIN.username, ADMIN.password);
  await expect(nav(page)).toBeVisible();
  // Tableau de bord calculé par le thread des rapports, chargé depuis l'archive asar.
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByText('Ventes des 30 derniers jours').first()).toBeVisible();
  await openModule(page, 'Rapports');
  await expect(page.getByText('Marge brute')).toBeVisible();

  // Outils de développement inaccessibles dans l'application installée (B.5).
  const devTools = await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.webContents.openDevTools();
    return window?.webContents.isDevToolsOpened() ?? null;
  });
  expect(devTools).toBe(false);

  // Mise à jour : le setup de la version suivante est copié, vérifié par Windows, puis proposé.
  if (nextSetup !== undefined && nextSetup !== '') {
    await stubFileDialogs(app, { open: nextSetup });
    await openModule(page, 'Paramètres');
    await page.getByRole('button', { name: /^Mise à jour/ }).click();
    await page.getByRole('button', { name: 'Choisir le programme d’installation' }).click();
    await expect(page.getByText(/^Nouvelle version \d+\.\d+\.\d+ \(installée : /)).toBeVisible();
    await expect(page.getByText('Non signé', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Je confirme que ce fichier/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Installer la mise à jour' })).toBeDisabled();
    expect(readdirSync(join(userData, 'donnees', 'mise-a-jour'))).toHaveLength(1);
  }

  expect(existsSync(join(userData, 'donnees', 'boutique.db'))).toBe(true);
  expect(readdirSync(join(userData, 'donnees'))).toContain('boutique.key');
});
