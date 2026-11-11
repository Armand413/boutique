import { readFileSync, unlinkSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import {
  ADMIN,
  completeSetup,
  createUserData,
  dataFile,
  failLogin,
  launchApp,
  launchReady,
  login,
  logout,
  nav,
  removeUserData,
  type LaunchedApp,
} from './fixtures';

let launched: LaunchedApp | null = null;

test.afterEach(async () => {
  if (launched === null) return;
  await launched.app.close();
  removeUserData(launched.userData);
  launched = null;
});

const SELLER = {
  fullName: 'Awa Vendeuse',
  username: 'awa',
  temporary: 'Provisoire-2026',
  password: 'Mangue-Sucree-77',
};

async function createSeller(page: Page): Promise<void> {
  await nav(page).getByRole('button', { name: 'Utilisateurs' }).click();
  await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom complet').fill(SELLER.fullName);
  await dialog.getByLabel('Identifiant').fill(SELLER.username);
  await dialog.getByLabel('Mot de passe provisoire').fill(SELLER.temporary);
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByText('Utilisateur créé.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: SELLER.fullName, exact: true })).toBeVisible();
}

test.describe('premier lancement', () => {
  test('guide la création du compte administrateur et remet une clé de récupération', async () => {
    launched = await launchApp(createUserData());
    const { page } = launched;
    await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue' })).toBeVisible();
    await checkAccessibility(page, 'Assistant');
    await page.getByLabel('Nom de la boutique').fill(ADMIN.shopName);
    await page.getByLabel('Votre nom complet').fill(ADMIN.fullName);
    await page.getByLabel('Identifiant de connexion').fill(ADMIN.username);
    await page.getByLabel('Mot de passe administrateur').fill('azerty2026!');
    await page.getByLabel('Confirmez le mot de passe').fill('azerty2026!');
    await page.getByRole('button', { name: 'Créer le compte administrateur' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'courant' })).toBeVisible();

    await page.getByLabel('Mot de passe administrateur').fill(ADMIN.password);
    await page.getByLabel('Confirmez le mot de passe').fill('autre-chose-2026');
    await page.getByRole('button', { name: 'Créer le compte administrateur' }).click();
    await expect(page.getByText('Les deux mots de passe ne correspondent pas.')).toBeVisible();

    await page.getByLabel('Confirmez le mot de passe').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Créer le compte administrateur' }).click();
    const key = page.getByTestId('recovery-key');
    await expect(key).toHaveText(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    await checkAccessibility(page, 'Clé de récupération');
    await expect(page.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    await page.getByLabel('J’ai recopié la clé et je la garde en lieu sûr').check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
    await expect(page.getByText(ADMIN.shopName)).toBeVisible();
    await checkAccessibility(page, 'Connexion');
  });

  test('chiffre la base et protège sa clé : aucun contenu lisible sur le disque', async () => {
    launched = await launchApp(createUserData());
    await completeSetup(launched.page);
    await launched.app.close();
    const database = readFileSync(dataFile(launched.userData, 'boutique.db'));
    expect(database.subarray(0, 16).toString('latin1')).not.toContain('SQLite format 3');
    for (const file of ['boutique.db', 'boutique.db-wal']) {
      let content: Buffer;
      try {
        content = readFileSync(dataFile(launched.userData, file));
      } catch {
        continue;
      }
      expect(content.includes(Buffer.from(ADMIN.shopName)), file).toBe(false);
      expect(content.includes(Buffer.from('$argon2id$')), file).toBe(false);
    }
    const key = readFileSync(dataFile(launched.userData, 'boutique.key'));
    expect(key.length).toBeGreaterThan(32);
    const escrow = readFileSync(dataFile(launched.userData, 'boutique.key.recovery'), 'utf8');
    expect(JSON.parse(escrow)).toMatchObject({
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: { algorithm: 'argon2id' },
    });
    removeUserData(launched.userData);
    launched = null;
  });
});

test.describe('connexion', () => {
  test('refuse un mauvais mot de passe puis bloque après plusieurs échecs', async () => {
    launched = await launchApp(createUserData());
    const { page } = launched;
    await completeSetup(page);
    await failLogin(page, ADMIN.username, 'mauvais-mot-de-passe');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Identifiant ou mot de passe incorrect.' }),
    ).toBeVisible();
    await failLogin(page, 'inconnu', 'mauvais-mot-de-passe');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Identifiant ou mot de passe incorrect.' }),
    ).toBeVisible();
    await failLogin(page, ADMIN.username, 'mauvais-mot-de-passe');
    await failLogin(page, ADMIN.username, 'mauvais-mot-de-passe');
    await login(page, ADMIN.username, ADMIN.password);
    await expect(page.getByRole('alert').filter({ hasText: 'Trop de tentatives' })).toBeVisible();
  });

  test('applique les rôles : un vendeur ne voit ni n’appelle la gestion des comptes', async () => {
    launched = await launchReady();
    const { page } = launched;
    await createSeller(page);
    await checkAccessibility(page, 'Utilisateurs');
    await logout(page);

    await login(page, SELLER.username, SELLER.temporary);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choisissez votre mot de passe' }),
    ).toBeVisible();
    await checkAccessibility(page, 'Changement imposé');
    await page.getByLabel('Mot de passe actuel').fill(SELLER.temporary);
    await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(SELLER.password);
    await page.getByLabel('Confirmez le nouveau mot de passe').fill(SELLER.password);
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();

    await expect(nav(page)).toBeVisible();
    await expect(nav(page).getByRole('button', { name: 'Utilisateurs' })).toHaveCount(0);
    await expect(nav(page).getByRole('button', { name: 'Journal d’audit' })).toHaveCount(0);
    const denied = await page.evaluate(async () => ({
      users: await window.api.invoke('users:list'),
      audit: await window.api.invoke('audit:verify'),
    }));
    expect(denied.users).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(denied.audit).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  test('ouvre la caisse par code PIN avec les seuls droits de caisse', async () => {
    launched = await launchReady();
    const { page } = launched;
    await nav(page).getByRole('button', { name: 'Mon compte' }).click();
    await page.getByLabel('Nouveau code PIN').fill('4071');
    await page.getByLabel('Votre mot de passe (pour confirmer)').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Enregistrer le code PIN' }).click();
    await expect(page.getByText('Code PIN enregistré.', { exact: true })).toBeVisible();
    await logout(page);

    await page.getByRole('tab', { name: 'Code PIN (caisse)' }).click();
    const pinPanel = page.getByRole('tabpanel', { name: 'Code PIN (caisse)' });
    await pinPanel.getByLabel('Identifiant').fill(ADMIN.username);
    await pinPanel.getByLabel('Code PIN', { exact: true }).fill('4071');
    await pinPanel.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Caisse (PIN)')).toBeVisible();
    await expect(nav(page).getByRole('button', { name: 'Utilisateurs' })).toHaveCount(0);
    const session = await page.evaluate(() => window.api.invoke('session:get'));
    expect(session).toMatchObject({
      ok: true,
      data: { method: 'pin', permissions: expect.not.arrayContaining(['user.manage']) as unknown },
    });
  });
});

test.describe('verrouillage', () => {
  test('verrouille après inactivité puis se déverrouille avec le mot de passe', async () => {
    launched = await launchReady({ BOUTIQUE_TEST_IDLE_SECONDS: '3' });
    const { page } = launched;
    await expect(page.getByRole('heading', { level: 1, name: 'Session verrouillée' })).toBeVisible({
      timeout: 8000,
    });
    await checkAccessibility(page, 'Verrouillage');
    const blocked = await page.evaluate(() => window.api.invoke('users:list'));
    expect(blocked).toMatchObject({ ok: false, error: { code: 'SESSION_LOCKED' } });
    await page.getByLabel('Mot de passe', { exact: true }).fill('faux-mot-de-passe');
    await page.getByRole('button', { name: 'Déverrouiller' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'incorrect' })).toBeVisible();
    await page.getByLabel('Mot de passe', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Déverrouiller' }).click();
    await expect(nav(page)).toBeVisible();
  });

  test('verrouille à la demande avec Ctrl+L', async () => {
    launched = await launchReady();
    const { page } = launched;
    await page.keyboard.press('Control+l');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Session verrouillée' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Changer d’utilisateur' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
  });
});

test.describe('récupération', () => {
  test('rouvre la base avec la clé de récupération si la clé protégée est perdue', async () => {
    const first = await launchReady();
    await first.app.close();
    unlinkSync(dataFile(first.userData, 'boutique.key'));

    launched = await launchApp(first.userData);
    const { page } = launched;
    await expect(
      page.getByRole('heading', { level: 1, name: 'Base de données verrouillée' }),
    ).toBeVisible();
    await checkAccessibility(page, 'Base verrouillée');
    await page.getByLabel('Clé de récupération').fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH');
    await page.getByRole('button', { name: 'Déverrouiller la base' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'incorrecte' })).toBeVisible();
    await page.getByLabel('Clé de récupération').fill(first.recoveryKey.toLowerCase());
    await page.getByRole('button', { name: 'Déverrouiller la base' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
    await login(page, ADMIN.username, ADMIN.password);
    await expect(nav(page)).toBeVisible();
  });

  test('réinitialise le mot de passe administrateur et remet une nouvelle clé', async () => {
    launched = await launchApp(createUserData());
    const { page } = launched;
    const recoveryKey = await completeSetup(page);
    await page.getByRole('button', { name: 'Mot de passe administrateur oublié ?' }).click();
    await checkAccessibility(page, 'Récupération');
    await page.getByLabel('Identifiant administrateur').fill(ADMIN.username);
    await page.getByLabel('Clé de récupération').fill(recoveryKey);
    await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('Recolte-Mil-2027');
    await page.getByLabel('Confirmez le nouveau mot de passe').fill('Recolte-Mil-2027');
    await page.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
    const nextKey = page.getByTestId('recovery-key');
    await expect(nextKey).toBeVisible();
    expect(await nextKey.textContent()).not.toBe(recoveryKey);
    await page.getByLabel('J’ai recopié la clé et je la garde en lieu sûr').check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await login(page, ADMIN.username, 'Recolte-Mil-2027');
    await expect(nav(page)).toBeVisible();
  });
});

test('trace les actions dans le journal d’audit et en vérifie l’intégrité', async () => {
  launched = await launchReady();
  const { page } = launched;
  await createSeller(page);
  await nav(page).getByRole('button', { name: 'Journal d’audit' }).click();
  await expect(page.getByRole('cell', { name: 'Utilisateur créé' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Installation terminée' })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier l’intégrité' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Journal intact' })).toBeVisible();
});
