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
