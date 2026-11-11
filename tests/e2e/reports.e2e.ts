import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import { launchReady, nav, removeUserData, type LaunchedApp } from './fixtures';
import {
  choose,
  importCsv,
  openModule,
  signInAsNewSeller,
  stubFileDialogs,
  toastShown,
} from './helpers';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchReady();
});

test.afterEach(async () => {
  await launched.app.close();
  removeUserData(launched.userData);
});

/** Catalogue importé puis 10 câbles reçus (coût 1 000) par les canaux de l'application. */
async function seedShop(page: Page): Promise<void> {
  await openModule(page, 'Produits');
  await importCsv(launched.app, page, launched.userData, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente;Seuil d’alerte',
    'Câble USB-C;Téléphonie;Accessoire;0011;2500;5',
    'Panneau 200 Wc;Énergie solaire;Solaire;0022;90000;0',
  ]);
  const result = await page.evaluate(async () => {
    const call = async (channel: string, input?: unknown): Promise<unknown> => {
      const response = (await window.api.invoke(
        channel as Parameters<typeof window.api.invoke>[0],
        input,
      )) as { ok: boolean; data?: unknown; error?: { message: string } };
      if (!response.ok) throw new Error(response.error?.message ?? channel);
      return response.data;
    };
    const search = (await call('products:search', {
      status: 'active',
      sort: 'name',
      offset: 0,
      limit: 10,
    })) as { rows: { variantId: number; name: string }[] };
    const id = (name: string) => search.rows.find((row) => row.name === name)?.variantId ?? 0;
    const supplier = (await call('suppliers:save', {
      name: 'Grossiste',
      phone: null,
      email: null,
      address: null,
      notes: null,
      isActive: true,
    })) as { id: number };
    const locations = (await call('locations:list')) as { id: number }[];
    await call('receipts:create', {
      supplierId: supplier.id,
      locationId: locations[0]?.id,
      receivedOn: '2026-11-11',
      notes: null,
      payment: null,
      lines: [
        { variantId: id('Câble USB-C'), quantity: 10, unitCost: 1000 },
        { variantId: id('Panneau 200 Wc'), quantity: 2, unitCost: 60000 },
      ],
    });
    return 'ok';
  });
  expect(result).toBe('ok');
}

/** Vente de 6 câbles au comptant depuis la caisse (15 000), laissant le câble en alerte. */
async function sellCables(page: Page): Promise<void> {
  await openModule(page, 'Caisse');
  await page.getByLabel('Fond de caisse').fill('0');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await toastShown(page, 'Caisse ouverte.');
  const search = page.getByLabel('Rechercher ou scanner un article');
  await search.fill('0011');
  await search.press('Enter');
  await page.getByLabel('Quantité de Câble USB-C').fill('6');
  await page.getByLabel('Quantité de Câble USB-C').press('Tab');
  await expect(page.getByTestId('pos-total')).toHaveText(/15\s000/);
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();
  await page.keyboard.press('F4');
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Espèces reçues').fill('15000');
  await pay.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(
    page.getByRole('heading', { name: /^Vente FAC-\d{4}-000001 enregistrée/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('tableau de bord et rapports : ventes, marges, stock, caisse et exports', async () => {
  const { page, app, userData } = launched;
  await seedShop(page);
  await sellCables(page);

  await openModule(page, 'Tableau de bord');
  const today = page
    .getByRole('region', { name: 'Tableau de bord' })
    .locator('div', { hasText: 'Aujourd’hui' })
    .first();
  await expect(today).toContainText(/15\s000/);
  await expect(today).toContainText('1 vente(s)');
  await expect(today).toContainText(/Bénéfice estimé : 9\s000/);
  await expect(page.getByRole('button', { name: /^1\s*Produits en alerte/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^FAC-\d{4}-000001$/ })).toBeVisible();
  await expect(page.getByText('Ventes des 30 derniers jours')).toBeVisible();
  await checkAccessibility(page, 'Tableau de bord');
  await page.getByRole('button', { name: 'Nouvelle vente' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Caisse' })).toBeVisible();

  await openModule(page, 'Rapports');
  await expect(page.getByRole('cell', { name: /15\s000/ }).first()).toBeVisible();
  await expect(page.getByText('Marge brute')).toBeVisible();
  await checkAccessibility(page, 'Rapports (ventes par jour)');
  await choose(page, 'Regrouper par', 'Famille');
  const row = page.getByRole('row', { name: /Téléphonie/ });
  await expect(row).toContainText(/15\s000/);
  await expect(row).toContainText(/9\s000/);

  for (const [label, file] of [
    ['PDF', 'ventes.pdf'],
    ['Excel', 'ventes.xlsx'],
    ['CSV', 'ventes.csv'],
  ] as const) {
    const path = join(userData, file);
    await stubFileDialogs(app, { save: path });
    await page.getByRole('button', { name: `Exporter le rapport en ${label}` }).click();
    await toastShown(page, 'Rapport enregistré.');
    await expect.poll(() => existsSync(path)).toBe(true);
  }

  await choose(page, 'Rapport', 'Valorisation du stock');
  await expect(page.getByRole('row', { name: /Énergie solaire/ })).toContainText(/120\s000/);
  await checkAccessibility(page, 'Rapports (stock)');
  await choose(page, 'Rapport', 'Produits les plus et les moins vendus');
  await choose(page, 'Classement', 'Les moins vendus');
  await expect(page.getByRole('row', { name: /Panneau 200 Wc/ })).toBeVisible();
  await choose(page, 'Rapport', 'Journal des mouvements de stock');
  await expect(page.getByRole('cell', { name: 'Vente', exact: true })).toBeVisible();
  await choose(page, 'Rapport', 'Rapport de caisse');
  await expect(page.getByText('Sessions de caisse')).toBeVisible();
  await checkAccessibility(page, 'Rapports (caisse)');
  await choose(page, 'Rapport', 'Créances clients et dettes fournisseurs');
  await expect(page.getByRole('row', { name: /Grossiste/ })).toContainText('Fournisseur');
});

test('vendeur : tableau de bord sans bénéfice, rapports inaccessibles', async () => {
  const { page } = launched;
  await seedShop(page);
  await signInAsNewSeller(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  await expect(page.getByText(/Bénéfice estimé/)).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: 'Rapports' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Entrée de stock' })).toHaveCount(0);
  const denied = await page.evaluate(async () => {
    const response = (await window.api.invoke('reports:run', { kind: 'balances' })) as {
      ok: boolean;
      error?: { code: string };
    };
    return response.ok ? 'ok' : (response.error?.code ?? '');
  });
  expect(denied).toBe('FORBIDDEN');
  await checkAccessibility(page, 'Tableau de bord (vendeur)');
});
