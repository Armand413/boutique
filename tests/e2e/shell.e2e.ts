import { expect, test } from '@playwright/test';
import { checkAccessibility } from './a11y';
import {
  ADMIN,
  launchApp,
  launchReady,
  login,
  nav,
  removeUserData,
  type LaunchedApp,
} from './fixtures';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchReady();
});

test.afterEach(async () => {
  await launched.app.close();
  removeUserData(launched.userData);
});

test('démarre sur l’interface servie par app://, sans outil de développement', async () => {
  const { page } = launched;
  await expect(page).toHaveTitle('Boutique Gestion');
  expect(page.url()).toBe('app://renderer/index.html');
  await expect(nav(page).getByRole('button', { name: 'Paramètres' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Galerie des composants' })).toHaveCount(0);
});

test('démarre en moins de 3 secondes jusqu’à l’écran de connexion', async () => {
  await launched.app.close();
  const startedAt = Date.now();
  launched = await launchApp(launched.userData);
  await expect(launched.page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
  const elapsed = Date.now() - startedAt;
  test.info().annotations.push({ type: 'démarrage', description: `${elapsed} ms` });
  expect(elapsed).toBeLessThan(3000);
});

test('applique les réglages de sécurité de la fenêtre (B.5)', async () => {
  const preferences = await launched.app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) throw new Error('Aucune fenêtre');
    return { devTools: window.webContents.isDevToolsOpened() };
  });
  expect(preferences.devTools).toBe(false);

  const exposed = await launched.page.evaluate(() => ({
    api: Object.keys(window.api),
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
  }));
  expect(exposed).toEqual({ api: ['invoke'], require: 'undefined', process: 'undefined' });
});

test('valide les appels IPC côté processus principal', async () => {
  const results = await launched.page.evaluate(async () => {
    // Appels volontairement hors contrat : on contourne le typage pour tester le processus principal.
    const invoke = (channel: string, input?: unknown): Promise<unknown> =>
      window.api.invoke(channel as Parameters<typeof window.api.invoke>[0], input);
    return {
      info: await invoke('app:getInfo'),
      unknown: await invoke('db:dropAll'),
      invalid: await invoke('preferences:set', { theme: 'rose' }),
      extraKey: await invoke('preferences:set', { theme: 'dark', role: 'admin' }),
      injection: await invoke('auth:login', { username: "admin' OR 1=1 --", password: 'x' }),
      setupAgain: await invoke('setup:complete', {
        shopName: 'Pirate',
        username: 'pirate',
        fullName: 'Pirate',
        password: 'Tres-Long-Mot-2026',
      }),
    };
  });
  expect(results.info).toMatchObject({ ok: true, data: { isPackaged: false } });
  expect(results.unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
  expect(results.invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  expect(results.extraKey).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  expect(results.injection).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  expect(results.setupAgain).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
});

test('bloque le réseau, les nouvelles fenêtres et la navigation externe', async () => {
  const { app, page } = launched;
  const network = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'autorisé';
    } catch {
      return 'bloqué';
    }
  });
  expect(network).toBe('bloqué');

  await page.evaluate(() => window.open('https://example.com/', '_blank'));
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe('app://renderer/index.html');
});

test('enregistre le thème et le retrouve au redémarrage', async () => {
  const { app, page, userData } = launched;
  await nav(page).getByRole('button', { name: 'Paramètres' }).click();
  await page.getByRole('button', { name: /^Apparence/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
  await page.getByRole('radio', { name: 'Sombre' }).check({ force: true });
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.getByText('Préférence enregistrée.', { exact: true })).toBeVisible();
  await app.close();

  // Le afterEach ferme cette nouvelle instance et supprime le dossier de données.
  launched = await launchApp(userData);
  await expect(launched.page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
  await expect(launched.page.locator('html')).toHaveClass(/\bdark\b/);
});

test('laisse F8 libre pour la caisse (mise en attente)', async () => {
  const { page } = launched;
  await page.locator('main').click();
  await page.keyboard.press('F8');
  const focusedLabel = await page.evaluate(
    () => document.activeElement?.closest('[aria-label]')?.getAttribute('aria-label') ?? '',
  );
  expect(focusedLabel).not.toContain('Notifications');
});

test('affiche la version dans À propos', async () => {
  const { page } = launched;
  await nav(page).getByRole('button', { name: 'À propos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'À propos' })).toBeVisible();
  await expect(page.getByText('Développement')).toBeVisible();
});

test('respecte les règles WCAG AA sur les écrans livrés', async () => {
  const { page } = launched;
  for (const screen of [
    'Utilisateurs',
    'Journal d’audit',
    'Mon compte',
    'Paramètres',
    'À propos',
  ]) {
    await nav(page).getByRole('button', { name: screen }).click();
    await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible();
    await checkAccessibility(page, screen);
  }
});

test('se navigue entièrement au clavier : lien d’évitement et palette Ctrl+K', async () => {
  const { page } = launched;
  // L'administrateur reçoit à la connexion le rappel des sauvegardes : on le ferme d'abord, sinon
  // la notification, arrivée par-dessus la palette, prendrait la touche Échap.
  const notifications = page.getByRole('region', { name: /Notifications/ });
  await expect(notifications.getByText(/sauvegardes automatiques sont arrêtées/)).toBeVisible();
  await notifications.getByRole('button', { name: 'Fermer' }).click();
  await expect(notifications.getByText(/sauvegardes automatiques sont arrêtées/)).toHaveCount(0);
  // Point de départ de la navigation au clavier : le début du document.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu principal' })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reprend sur l’écran de connexion après une déconnexion, sans écran hérité', async () => {
  const { page } = launched;
  await nav(page).getByRole('button', { name: 'Utilisateurs' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
  await login(page, ADMIN.username, ADMIN.password);
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
});
