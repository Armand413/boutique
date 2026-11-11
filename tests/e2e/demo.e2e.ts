import { execFileSync } from 'node:child_process';
import electronPath from 'electron';
import { expect, test } from '@playwright/test';
import { checkAccessibility } from './a11y';
import {
  createUserData,
  launchApp,
  login,
  nav,
  removeUserData,
  type LaunchedApp,
} from './fixtures';
import { openModule } from './helpers';

/** Le paquet `electron` exporte, sous Node, le chemin de l'exécutable. */
const electronBinary = electronPath as unknown as string;
let launched: LaunchedApp | null = null;
let userData = '';

test.afterEach(async () => {
  await launched?.app.close();
  removeUserData(userData);
});

test('les données de démonstration s’ouvrent dans l’application (2 000 produits, 5 000 ventes)', async () => {
  test.setTimeout(5 * 60_000);
  userData = createUserData();
  const output = execFileSync(electronBinary, ['out-demo/seed-main.js', '--user-data', userData], {
    encoding: 'utf8',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE'),
    ),
    timeout: 4 * 60_000,
  });
  const password = /Compte administrateur : demo \/ (\S+)/.exec(output)?.[1] ?? '';
  expect(password).not.toBe('');
  expect(output).toMatch(/Terminé : .*"products":20\d\d/);

  launched = await launchApp(userData);
  await login(launched.page, 'demo', password);
  await expect(nav(launched.page)).toBeVisible();
  await expect(
    launched.page.getByRole('heading', { level: 1, name: 'Tableau de bord' }),
  ).toBeVisible();
  await expect(launched.page.getByText(/\d[\d\s]* vente\(s\)/).first()).toBeVisible();
  await checkAccessibility(launched.page, 'Tableau de bord (démonstration)');
  await openModule(launched.page, 'Produits');
  await expect(launched.page.getByText(/2[\s\u00a0\u202f]?00\d article/).first()).toBeVisible();
  await openModule(launched.page, 'Rapports');
  await expect(launched.page.getByText('Marge brute')).toBeVisible();
});
