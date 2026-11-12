import { execFileSync } from 'node:child_process';
import electronPath from 'electron';
import { test } from '@playwright/test';
import {
  ADMIN,
  completeSetup,
  createUserData,
  launchApp,
  login,
  nav,
  removeUserData,
} from './fixtures';

/** Le paquet `electron` exporte, sous Node, le chemin de l'exécutable. */
const electronBinary = electronPath as unknown as string;

/**
 * Captures d'écran de contrôle visuel (ignorées sans BOUTIQUE_CAPTURES : `npx playwright test --grep @captures`).
 * Le dossier de sortie est passé par BOUTIQUE_CAPTURES.
 */
test('@captures écrans de la phase 2', async () => {
  const output = process.env.BOUTIQUE_CAPTURES;
  test.skip(output === undefined, 'BOUTIQUE_CAPTURES non défini');
  const launched = await launchApp(createUserData());
  const { page } = launched;
  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: `${output}/1-assistant.png` });
    await completeSetup(page);
    await page.screenshot({ path: `${output}/2-connexion.png` });
    await login(page, ADMIN.username, ADMIN.password);
    await nav(page).getByRole('button', { name: 'Utilisateurs' }).click();
    await page.getByRole('cell', { name: ADMIN.fullName, exact: true }).waitFor();
    await page.screenshot({ path: `${output}/3-utilisateurs.png` });
    await nav(page).getByRole('button', { name: 'Journal d’audit' }).click();
    await page.getByRole('cell', { name: 'Connexion', exact: true }).first().waitFor();
    await page.screenshot({ path: `${output}/4-audit.png` });
    await page.keyboard.press('Control+l');
    await page.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
    await page.screenshot({ path: `${output}/5-verrouillage.png` });
  } finally {
    await launched.app.close();
    removeUserData(launched.userData);
  }
});

/**
 * Illustrations du guide utilisateur (`docs/images`), sur les données de démonstration :
 * `BOUTIQUE_CAPTURES=docs/images npx playwright test --grep @guide` (après `npm run test:e2e`, qui construit le bundle).
 */
test('@guide écrans du guide utilisateur', async () => {
  const output = process.env.BOUTIQUE_CAPTURES;
  test.skip(output === undefined, 'BOUTIQUE_CAPTURES non défini');
  test.setTimeout(6 * 60_000);
  const userData = createUserData();
  const seeded = execFileSync(electronBinary, ['out-demo/seed-main.js', '--user-data', userData], {
    encoding: 'utf8',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
    ),
    timeout: 4 * 60_000,
  });
  const password = /Compte administrateur : demo \/ (\S+)/.exec(seeded)?.[1] ?? '';
  const launched = await launchApp(userData);
  const { page } = launched;
  const shot = async (name: string) => {
    // Les notifications de connexion (alertes de stock, sauvegardes) masqueraient l'écran.
    const notifications = page.getByRole('region', { name: /Notifications/ });
    for (const close of await notifications.getByRole('button', { name: 'Fermer' }).all()) {
      await close.click().catch(() => undefined);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output ?? ''}/${name}.png` });
  };
  const open = async (module: string, heading = module) => {
    await nav(page).getByRole('button', { name: module, exact: true }).click();
    await page.getByRole('heading', { level: 1, name: heading }).waitFor();
  };
  try {
    await page.setViewportSize({ width: 1366, height: 768 });
    await shot('connexion');
    await login(page, 'demo', password);
    await page.getByRole('heading', { level: 1, name: 'Tableau de bord' }).waitFor();
    await page
      .getByText(/\d vente\(s\)/)
      .first()
      .waitFor();
    await shot('tableau-de-bord');
    await open('Caisse');
    const opening = page.getByRole('button', { name: 'Ouvrir la caisse' });
    if (await opening.isVisible()) {
      await page.getByLabel('Fond de caisse').fill('50000');
      await opening.click();
    }
    const search = page.getByLabel('Rechercher ou scanner un article');
    for (const term of ['câble', 'coque', 'écouteurs']) {
      await search.fill(term);
      await page.waitForTimeout(300);
      await search.press('Enter');
    }
    await shot('caisse');
    await page.keyboard.press('F4');
    await page.waitForTimeout(400);
    await shot('encaissement');
    await page.keyboard.press('Escape');
    await open('Produits');
    await page
      .getByText(/article/)
      .first()
      .waitFor();
    await shot('produits');
    await open('Stock');
    await shot('stock');
    await open('Inventaire', 'Inventaires');
    await shot('inventaire');
    await open('Ventes');
    await shot('ventes');
    await open('Clients');
    await shot('clients');
    await open('Garantie et SAV');
    await shot('garantie');
    await open('Rapports');
    await page.getByText('Marge brute').waitFor();
    await shot('rapports');
    await open('Paramètres');
    await shot('parametres');
    await page.getByRole('button', { name: /^Sauvegardes/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Sauvegardes' }).waitFor();
    await shot('sauvegardes');
    await nav(page).getByRole('button', { name: 'Paramètres', exact: true }).click();
    await page.getByRole('button', { name: /^Mise à jour/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Mise à jour' }).waitFor();
    await shot('mise-a-jour');
  } finally {
    await launched.app.close();
    removeUserData(userData);
  }
});
