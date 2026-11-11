import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import { launchReady, removeUserData, type LaunchedApp } from './fixtures';
import { importCsv, openModule, stubFileDialogs, toastShown } from './helpers';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchReady();
});

test.afterEach(async () => {
  await launched.app.close();
  removeUserData(launched.userData);
});

const IMEI_A = '490154203237518';
const IMEI_B = '356938035643809';

type Call = (channel: string, input?: unknown) => Promise<unknown>;

/** Appelle un canal IPC depuis la page, comme le ferait l'interface. */
async function ipc<T>(page: Page, channel: string, input?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel: name, input: payload }) => {
      const response = (await window.api.invoke(
        name as Parameters<typeof window.api.invoke>[0],
        payload,
      )) as { ok: boolean; data?: unknown; error?: { message: string } };
      if (!response.ok) throw new Error(response.error?.message ?? name);
      return response.data;
    },
    { channel, input },
  ) as Promise<T>;
}

async function stockOf(page: Page, name: string): Promise<number> {
  const search = await ipc<{ rows: { name: string; stock: number }[] }>(page, 'products:search', {
    status: 'active',
    sort: 'name',
    offset: 0,
    limit: 10,
  });
  return search.rows.find((row) => row.name === name)?.stock ?? -1;
}

/** Catalogue (import CSV) puis réception fournisseur : 10 câbles et deux téléphones suivis par IMEI. */
async function seedShop(page: Page): Promise<void> {
  await openModule(page, 'Produits');
  await importCsv(launched.app, page, launched.userData, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente;Prix minimum;Garantie (mois)',
    'Câble USB-C;Téléphonie;Accessoire;0011;2500;2000;0',
    'Galaxy A15;Téléphonie;Téléphone;;120000;0;12',
  ]);
  const result = await page.evaluate(
    async ({ imeis }) => {
      const call: Call = async (channel, input) => {
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
          {
            variantId: id('Galaxy A15'),
            quantity: 2,
            unitCost: 90000,
            serials: imeis.map((serialNumber) => ({ serialNumber, imei2: null })),
          },
        ],
      });
      return 'ok';
    },
    { imeis: [IMEI_A, IMEI_B] },
  );
  expect(result).toBe('ok');
}

async function scanInventory(page: Page, code: string): Promise<void> {
  const input = page.getByLabel('Scanner un code-barres, une référence ou un numéro de série');
  await input.fill(code);
  await input.press('Enter');
}

test('inventaire : scan, comptage, écarts, validation, ajustement du stock et rapports', async () => {
  const { page, app, userData } = launched;
  await seedShop(page);

  await openModule(page, 'Inventaire');
  await expect(page.getByText('Aucun inventaire', { exact: true })).toBeVisible();
  await checkAccessibility(page, 'Inventaires (vide)');
  await page.getByRole('button', { name: 'Nouvel inventaire' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nom *').fill('Inventaire de novembre');
  await checkAccessibility(page, 'Nouvel inventaire');
  await form.getByRole('button', { name: 'Ouvrir l’inventaire' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Inventaire de novembre' }),
  ).toBeVisible();
  await expect(page.getByText('Comptage (étape en cours)')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Attendu' })).toHaveCount(0);

  await scanInventory(page, '0011');
  await expect(page.getByRole('status').getByText('Câble USB-C : 1')).toBeVisible();
  await expect(page.getByLabel('Quantité comptée de Câble USB-C')).toHaveValue('1');
  await scanInventory(page, IMEI_A);
  await expect(page.getByText(`appareil ${IMEI_A} compté (1)`)).toBeVisible();
  await expect(page.getByText('1 appareil(s) scanné(s)')).toBeVisible();
  await scanInventory(page, 'INCONNU-42');
  await expect(page.getByLabel('Quantité comptée de Câble USB-C')).toHaveValue('1');
  const count = page.getByLabel('Quantité comptée de Câble USB-C');
  await count.fill('8');
  await count.press('Enter');
  await expect(count).toHaveValue('8');
  await checkAccessibility(page, 'Inventaire (comptage)');

  await page.getByRole('button', { name: 'Terminer le comptage' }).click();
  await expect(page.getByText('Écarts (étape en cours)')).toBeVisible();
  await expect(page.getByText(/^2 écart\(s\) · valeur : −?-?\d/)).toBeVisible();
  await expect(page.getByText(`Non scannés : ${IMEI_B}`)).toBeVisible();
  await expect(page.getByRole('row', { name: /Câble USB-C/ })).toContainText('-2');
  await checkAccessibility(page, 'Inventaire (écarts)');

  const pdf = join(userData, 'inventaire.pdf');
  await stubFileDialogs(app, { save: pdf });
  await page.getByRole('button', { name: 'Rapport PDF' }).click();
  await toastShown(page, 'Rapport enregistré.');
  expect(existsSync(pdf)).toBe(true);
  const xlsx = join(userData, 'inventaire.xlsx');
  await stubFileDialogs(app, { save: xlsx });
  await page.getByRole('button', { name: 'Rapport Excel' }).click();
  await expect.poll(() => existsSync(xlsx)).toBe(true);

  await page.getByRole('button', { name: 'Valider l’inventaire' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Valider l’inventaire' }).click();
  await toastShown(page, 'Inventaire validé : stock ajusté.');
  await expect(page.getByText('Validé', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Valider l’inventaire' })).toHaveCount(0);
  expect(await stockOf(page, 'Câble USB-C')).toBe(8);
  expect(await stockOf(page, 'Galaxy A15')).toBe(1);

  await openModule(page, 'Inventaire');
  const row = page.getByRole('row', { name: /Inventaire de novembre/ });
  await expect(row).toContainText('Validé');
  await expect(row).toContainText('2 / 2');
  await checkAccessibility(page, 'Inventaires (historique)');
});

test('garantie : recherche par IMEI, réclamation ouverte, envoyée au fournisseur puis clôturée', async () => {
  const { page } = launched;
  await seedShop(page);

  await openModule(page, 'Caisse');
  await page.getByLabel('Fond de caisse').fill('0');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await toastShown(page, 'Caisse ouverte.');
  const search = page.getByLabel('Rechercher ou scanner un article');
  await search.fill(IMEI_A);
  await search.press('Enter');
  await toastShown(page, `Unité ${IMEI_A} ajoutée.`);
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();
  await page.keyboard.press('F4');
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Espèces reçues').fill('120000');
  await pay.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(
    page.getByRole('heading', { name: /^Vente FAC-\d{4}-000001 enregistrée/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openModule(page, 'Garantie et SAV');
  await checkAccessibility(page, 'Garantie (recherche)');
  await page.getByLabel('Numéro de série ou IMEI').fill(IMEI_B);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page.getByText('Appareil non vendu (En stock).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir une réclamation' })).toHaveCount(0);

  await page.getByLabel('Numéro de série ou IMEI').fill(IMEI_A);
  await page.getByLabel('Numéro de série ou IMEI').press('Enter');
  await expect(
    page.getByText(/^Sous garantie jusqu’au \d{4}-\d{2}-\d{2} \(\d+ j restants\)/),
  ).toBeVisible();
  await expect(page.getByText(/facture FAC-\d{4}-000001/)).toBeVisible();
  await expect(page.getByText('Aucune réclamation.')).toBeVisible();

  await page.getByRole('button', { name: 'Ouvrir une réclamation' }).click();
  const claim = page.getByRole('dialog');
  await expect(claim.getByRole('heading', { name: `Réclamation pour ${IMEI_A}` })).toBeVisible();
  await claim.getByLabel('Panne constatée *').fill('L’écran ne s’allume plus');
  await checkAccessibility(page, 'Ouverture de réclamation');
  await claim.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Réclamation ouverte.');
  await expect(page.getByRole('cell', { name: 'L’écran ne s’allume plus' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir une réclamation' })).toBeVisible();

  await page.getByRole('tab', { name: 'Réclamations en cours' }).click();
  const open = page.getByRole('tabpanel');
  await expect(open.getByText('Reçue', { exact: true })).toBeVisible();
  await checkAccessibility(page, 'Réclamations en cours');
  await open.getByRole('button', { name: `Mettre à jour la réclamation de ${IMEI_A}` }).click();
  const update = page.getByRole('dialog');
  await expect(update.getByRole('combobox', { name: 'Nouvel état' })).toHaveText(
    'Envoyée au fournisseur',
  );
  await update.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Réclamation mise à jour.');
  await expect(open.getByText('Envoyée au fournisseur', { exact: true })).toBeVisible();

  await open.getByRole('button', { name: `Mettre à jour la réclamation de ${IMEI_A}` }).click();
  await page.getByRole('combobox', { name: 'Nouvel état' }).click();
  await page.getByRole('option', { name: 'Clôturée', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Indiquez la solution ou le motif du refus avant de clôturer.'),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByLabel('Solution ou motif du refus')
    .fill('Écran remplacé par le fournisseur');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Réclamation mise à jour.');
  await expect(open.getByText('Aucune réclamation en cours.')).toBeVisible();

  await page.getByRole('tab', { name: 'Garanties qui expirent (30 jours)' }).click();
  await expect(page.getByText('Aucune garantie ne se termine dans les 30 jours.')).toBeVisible();
  await checkAccessibility(page, 'Garanties qui expirent');
});
