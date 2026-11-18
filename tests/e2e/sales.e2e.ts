import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import { launchReady, nav, removeUserData, type LaunchedApp } from './fixtures';
import {
  importCsv,
  openModule,
  pickArticle,
  SCAN_LABEL,
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

const year = String(new Date().getFullYear());

/** Catalogue et stock de départ : import CSV puis réception fournisseur par les canaux de l'application. */
async function seedShop(page: Page): Promise<void> {
  await openModule(page, 'Produits');
  await importCsv(launched.app, page, launched.userData, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente;Prix minimum',
    'Câble USB-C;Téléphonie;Accessoire;0011;2500;2000',
    'Galaxy A15;Téléphonie;Téléphone;;120000;0',
    'Installation;Énergie solaire;Service;;25000;0',
  ]);
  const result = await page.evaluate(async () => {
    const call = async (channel: string, input?: unknown): Promise<unknown> => {
      const response = (await window.api.invoke(
        channel as Parameters<typeof window.api.invoke>[0],
        input,
      )) as {
        ok: boolean;
        data?: unknown;
        error?: { message: string };
      };
      if (!response.ok) throw new Error(response.error?.message ?? channel);
      return response.data;
    };
    const search = (await call('products:search', {
      status: 'active',
      sort: 'name',
      offset: 0,
      limit: 10,
    })) as {
      rows: { variantId: number; name: string }[];
    };
    const id = (name: string) => search.rows.find((row) => row.name === name)?.variantId ?? 0;
    const locations = (await call('locations:list')) as { id: number }[];
    await call('receipts:create', {
      supplierId: null,
      locationId: locations[0]?.id,
      receivedOn: '2026-11-11',
      notes: null,
      payment: null,
      lines: [
        { variantId: id('Câble USB-C'), quantity: 10, unitCost: 1000 },
        // Plus de suivi unitaire (D93) : le téléphone entre en stock par quantité.
        { variantId: id('Galaxy A15'), quantity: 1, unitCost: 90000 },
      ],
    });
    return 'ok';
  });
  expect(result).toBe('ok');
}

async function openTill(page: Page, float = '10000'): Promise<void> {
  await openModule(page, 'Caisse');
  await expect(page.getByText('Caisse fermée', { exact: true })).toBeVisible();
  await page.getByLabel('Fond de caisse').fill(float);
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await toastShown(page, 'Caisse ouverte.');
}

async function scan(page: Page, code: string): Promise<void> {
  const search = page.getByLabel(SCAN_LABEL);
  await search.fill(code);
  await search.press('Enter');
}

test('vente complète : scan, listes, service, attente, encaissement, retour et clôture', async () => {
  const { page, app, userData } = launched;
  await seedShop(page);
  await openTill(page);
  await checkAccessibility(page, 'Caisse (vide)');

  await scan(page, '0011');
  await expect(page.getByText('Câble USB-C', { exact: true })).toBeVisible();
  await scan(page, '0011');
  await expect(page.getByLabel('Quantité de Câble USB-C')).toHaveValue('2');
  await pickArticle(page, page, 'Téléphonie', 'Galaxy A15');
  await expect(page.getByText('Galaxy A15', { exact: true })).toBeVisible();
  await pickArticle(page, page, 'Énergie solaire', 'Installation');
  // Prix négocié (D92) : 2 250 au lieu de 2 500, soit 500 de moins sur les deux câbles.
  await page.getByLabel('Prix convenu pour Câble USB-C').fill('2250');
  await expect(page.getByTestId('pos-total')).toHaveText(/149\s500/);
  await checkAccessibility(page, 'Caisse (panier)');

  await page.keyboard.press('F8');
  await toastShown(page, 'Panier mis en attente.');
  await expect(page.getByText('Choisissez un article dans les listes ou scannez-le')).toBeVisible();
  await page.getByRole('button', { name: 'Paniers en attente (1)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByTestId('pos-total')).toHaveText(/149\s500/);
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();

  await page.keyboard.press('F4');
  const pay = page.getByRole('dialog');
  await expect(pay.getByText(/Total à payer : 149\s500/)).toBeVisible();
  await pay.getByLabel('Espèces reçues').fill('150000');
  await expect(pay.getByText('Monnaie à rendre : 500')).toBeVisible();
  await checkAccessibility(page, 'Encaissement');
  await pay.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(
    page.getByRole('heading', { name: `Vente FAC-${year}-000001 enregistrée` }),
  ).toBeVisible();
  await expect(page.getByText('Rendre 500')).toBeVisible();
  await page.getByRole('button', { name: 'Imprimer le ticket' }).click();
  await toastShown(page, /simulateur/);
  const invoice = join(userData, 'facture.pdf');
  await stubFileDialogs(app, { save: invoice });
  await page.getByRole('button', { name: 'Facture PDF' }).click();
  await toastShown(page, 'Document enregistré.');
  expect(existsSync(invoice)).toBe(true);
  await page.getByRole('button', { name: 'Nouvelle vente (F2)' }).click();
  await expect(page.getByText('Choisissez un article dans les listes ou scannez-le')).toBeVisible();

  await scan(page, '0011');
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();
  await page.keyboard.press('F4');
  await page.getByRole('dialog').getByLabel('Espèces reçues').fill('1000');
  await expect(page.getByRole('dialog').getByText(/Reste à payer : 1\s500/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Choisir un client' }).click();
  const customerDialog = page.getByRole('dialog', { name: 'Choisir un client' });
  await customerDialog.getByLabel('Rechercher un client (nom ou téléphone)').fill('Aya Koné');
  await customerDialog.getByRole('button', { name: 'Nouveau client' }).click();
  await customerDialog.getByLabel('Téléphone', { exact: true }).fill('0707070707');
  await customerDialog.getByRole('button', { name: 'Créer et choisir' }).click();
  await expect(page.getByRole('dialog').getByText('Aya Koné')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Espèces reçues')).toHaveValue('1000');
  await page.getByRole('dialog').getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('dialog').getByText(/plafond de crédit/i)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
  await page.keyboard.press('F2');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Nouvelle vente' }).click();

  await openModule(page, 'Ventes');
  await page.getByRole('button', { name: `Ouvrir la vente FAC-${year}-000001` }).click();
  await expect(page.getByText('Galaxy A15').first()).toBeVisible();
  await checkAccessibility(page, 'Détail de la vente');
  await page.getByRole('main').getByRole('button', { name: 'Retour', exact: true }).click();
  const returnDialog = page.getByRole('dialog');
  await returnDialog.getByLabel('Quantité rendue de Câble USB-C').fill('1');
  await returnDialog.getByLabel('Motif du retour *').fill('Câble défectueux');
  await expect(returnDialog.getByText(/À rembourser : 2\s250/)).toBeVisible();
  await returnDialog.getByRole('button', { name: 'Enregistrer le retour' }).click();
  await toastShown(page, 'Retour enregistré.');

  await openModule(page, 'Caisse');
  await page.getByRole('button', { name: 'Clôturer la caisse' }).click();
  const close = page.getByRole('dialog');
  await expect(close.getByText('Espèces attendues')).toBeVisible();
  await close.getByLabel('Espèces comptées').fill('157250');
  await expect(close.getByText('Écart : 0')).toBeVisible();
  await checkAccessibility(page, 'Clôture');
  await close.getByRole('button', { name: 'Clôturer' }).click();
  await toastShown(page, /Caisse clôturée/);
  await expect(page.getByText('Caisse fermée', { exact: true })).toBeVisible();
});

test('devis réservé, envoyé puis converti en vente', async () => {
  const { page } = launched;
  await seedShop(page);
  await openTill(page, '0');

  await openModule(page, 'Devis');
  await page.getByRole('button', { name: 'Nouveau devis' }).first().click();
  await pickArticle(page, page, 'Téléphonie', 'Câble USB-C');
  await page.getByLabel('Quantité de Câble USB-C').fill('3');
  // Création directe, sans recherche préalable : nom et téléphone saisis dans le formulaire.
  await page.getByRole('button', { name: 'Choisir un client' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nouveau client' }).click();
  await page.getByRole('dialog').getByLabel('Nom complet *').fill('Kouamé');
  await page.getByRole('dialog').getByLabel('Téléphone', { exact: true }).fill('0505050505');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer et choisir' }).click();
  await expect(page.getByRole('button', { name: 'Kouamé' })).toBeVisible();
  await checkAccessibility(page, 'Devis');
  await page.getByRole('button', { name: 'Enregistrer le devis' }).click();
  await toastShown(page, 'Devis enregistré.');
  await expect(page.getByRole('heading', { name: `Devis DEV-${year}-00001` })).toBeVisible();
  await page.getByRole('button', { name: 'Marquer comme envoyé' }).click();
  await expect(page.getByText('Envoyé', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en vente' }).click();

  await expect(page.getByText(`Vente depuis le devis DEV-${year}-00001`)).toBeVisible();
  await expect(page.getByTestId('pos-total')).toHaveText(/7\s500/);
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();
  await page.keyboard.press('F4');
  await page.getByRole('dialog').getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('heading', { name: /Vente FAC-.* enregistrée/ })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle vente (F2)' }).click();

  await openModule(page, 'Devis');
  await expect(page.getByText('Aucun devis', { exact: true })).toBeVisible();
});

test('le vendeur vend dans son plafond de remise et ne peut pas annuler', async () => {
  const { page } = launched;
  await seedShop(page);
  await signInAsNewSeller(page);
  await expect(nav(page).getByRole('button', { name: 'Caisse' })).toBeVisible();
  await openTill(page, '0');
  await scan(page, '0011');
  await page.getByLabel('Prix convenu pour Câble USB-C').fill('2125');
  await expect(page.getByText(/au-delà de votre plafond \(10 %\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeDisabled();
  await page.getByLabel('Prix convenu pour Câble USB-C').fill('2250');
  await expect(page.getByRole('button', { name: /^Encaisser/ })).toBeEnabled();
  await page.keyboard.press('F4');
  await page.getByRole('dialog').getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('heading', { name: /Vente FAC-.* enregistrée/ })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle vente (F2)' }).click();
  await openModule(page, 'Ventes');
  await page
    .getByRole('button', { name: /^Ouvrir la vente FAC-/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Annuler la vente' })).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Retour', exact: true }),
  ).toHaveCount(0);
});

test('recherche d’un article par son nom à la caisse, au clavier ou à la souris (D99)', async () => {
  const { page } = launched;
  await seedShop(page);
  await openTill(page);
  const search = page.getByRole('combobox', { name: /Rechercher un article/ });
  await search.fill('câble');
  const suggestions = page.getByRole('listbox', { name: 'Articles trouvés' });
  await expect(suggestions.getByRole('option', { name: /Câble USB-C/ })).toBeVisible();
  await checkAccessibility(page, 'Caisse (suggestions)');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByLabel('Quantité de Câble USB-C')).toHaveValue('1');
  await expect(search).toHaveValue('');

  await search.fill('galax');
  await suggestions.getByRole('option', { name: /Galaxy A15/ }).click();
  await expect(page.getByText('Galaxy A15', { exact: true })).toBeVisible();
  await expect(suggestions).toHaveCount(0);
});
