import { expect, test } from '@playwright/test';
import { checkAccessibility } from './a11y';
import { launchReady, nav, removeUserData, type LaunchedApp } from './fixtures';
import {
  choose,
  enableModules,
  importCsv,
  openModule,
  pickArticle,
  signInAsNewSeller,
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

test('réception fournisseur, transfert, sortie, paiement et alertes de stock', async () => {
  const { app, page, userData } = launched;
  await enableModules(page, ['Fournisseurs']);
  await checkAccessibility(page, 'Modules');
  await openModule(page, 'Produits');
  await importCsv(app, page, userData, [
    'Nom;Catégorie;Type;Prix de vente;Seuil d’alerte',
    'Câble USB-C;Téléphonie;Accessoire;2500;5',
    'Galaxy A15;Téléphonie;Téléphone;120000;0',
  ]);

  await openModule(page, 'Stock');
  await expect(page.getByRole('button', { name: 'Alertes de stock : 1' })).toBeVisible();
  await expect(page.getByText('2 article(s)')).toBeVisible();
  await expect(page.getByRole('row', { name: /Câble USB-C/ }).getByText('Stock bas')).toBeVisible();
  await checkAccessibility(page, 'Stock (vide)');

  await page.getByRole('button', { name: 'Emplacements' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Emplacements' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvel emplacement' }).click();
  await page.getByRole('dialog').getByLabel('Nom *').fill('Dépôt');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Emplacement enregistré.');
  await expect(page.getByRole('cell', { name: 'Dépôt', exact: true })).toBeVisible();
  await checkAccessibility(page, 'Emplacements');

  await openModule(page, 'Fournisseurs');
  await expect(page.getByText('Aucun fournisseur', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau fournisseur' }).first().click();
  await page.getByRole('dialog').getByLabel('Nom *').fill('Grossiste Adjamé');
  await page.getByRole('dialog').getByLabel('Téléphone').fill('0700000000');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Grossiste Adjamé' })).toBeVisible();

  await page.getByRole('button', { name: 'Nouvelle entrée' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Entrée de marchandise' }),
  ).toBeVisible();
  await pickArticle(page, page, 'Téléphonie', 'Câble USB-C');
  await page.getByLabel('Quantité reçue de Câble USB-C').fill('10');
  await page.getByLabel('Prix d’achat unitaire de Câble USB-C').fill('1000');
  await pickArticle(page, page, 'Téléphonie', 'Galaxy A15');
  await page.getByLabel('Quantité reçue de Galaxy A15').fill('2');
  await page.getByLabel('Prix d’achat unitaire de Galaxy A15').fill('90 000');
  await page.getByLabel('Montant payé').fill('50000');
  await expect(page.getByText('Total : 190 000')).toBeVisible();
  await checkAccessibility(page, 'Entrée de marchandise');
  await page.getByRole('button', { name: 'Valider l’entrée' }).click();
  await toastShown(page, /Entrée BR-\d{4}-00001 enregistrée/);
  await expect(page.getByRole('heading', { level: 1, name: 'Grossiste Adjamé' })).toBeVisible();
  await expect(page.getByText('Reste dû : 140 000')).toBeVisible();
  await checkAccessibility(page, 'Fiche fournisseur');

  await page.getByRole('button', { name: /^Voir le bon BR-/ }).click();
  await expect(page.getByRole('dialog').getByText('Galaxy A15').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();

  await page.getByRole('button', { name: 'Enregistrer un paiement' }).click();
  await page.getByRole('dialog').getByLabel('Montant *').fill('40000');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer un paiement' }).click();
  await expect(page.getByText('Reste dû : 100 000')).toBeVisible();

  await openModule(page, 'Stock');
  await expect(page.getByRole('button', { name: /Alertes de stock/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Transfert' }).click();
  let dialog = page.getByRole('dialog');
  await pickArticle(page, dialog, 'Téléphonie', 'Galaxy A15');
  // Sans suivi unitaire (D93) : on transfère une quantité.
  await dialog.getByLabel('Quantité').fill('1');
  await checkAccessibility(page, 'Transfert');
  await dialog.getByRole('button', { name: 'Transférer' }).click();
  await toastShown(page, 'Transfert enregistré.');

  await page.getByRole('button', { name: 'Sortie ou ajustement' }).click();
  dialog = page.getByRole('dialog');
  await pickArticle(page, dialog, 'Téléphonie', 'Câble USB-C');
  await choose(page, 'Nature', 'Casse');
  await dialog.getByLabel('Quantité').fill('7');
  await dialog.getByRole('button', { name: 'Enregistrer le mouvement' }).click();
  await expect(dialog.getByText('Motif trop court.')).toBeVisible();
  await dialog.getByLabel('Motif *').fill('Câbles abîmés à la livraison');
  await dialog.getByRole('button', { name: 'Enregistrer le mouvement' }).click();
  await toastShown(page, 'Mouvement enregistré.');

  const cableRow = page.getByRole('row', { name: /Câble USB-C/ });
  await expect(cableRow.getByRole('cell').nth(3)).toHaveText(/Stock bas\s*3/);
  const phoneRow = page.getByRole('row', { name: /Galaxy A15/ });
  await expect(phoneRow.getByRole('cell').nth(1)).toHaveText('1');
  await expect(phoneRow.getByRole('cell').nth(2)).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Alertes de stock : 1' })).toBeVisible();
  await checkAccessibility(page, 'Stock');

  await page.getByRole('tab', { name: 'Mouvements' }).click();
  await expect(page.getByRole('cell', { name: 'Casse', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Transfert reçu', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Câbles abîmés/ })).toBeVisible();
  await checkAccessibility(page, 'Mouvements');
  await page.getByRole('tab', { name: 'Valorisation' }).click();
  await expect(page.getByText('Valeur au coût d’achat').first()).toBeVisible();
  await checkAccessibility(page, 'Valorisation');

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Écran, produit/ }).fill('Galaxy');
  await expect(page.getByRole('option', { name: /Galaxy A15/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Alertes de stock : 1' }).click();
  await expect(page.getByRole('checkbox', { name: 'Sous le seuil d’alerte' })).toBeChecked();
});

test('le vendeur consulte le stock sans coûts ni opérations', async () => {
  const { app, page, userData } = launched;
  await openModule(page, 'Produits');
  await importCsv(app, page, userData, [
    'Nom;Catégorie;Type;Prix de vente',
    'Coque;Téléphonie;Accessoire;1500',
  ]);
  await signInAsNewSeller(page);
  await expect(nav(page).getByRole('button', { name: 'Fournisseurs' })).toHaveCount(0);
  await openModule(page, 'Stock');
  await expect(page.getByRole('button', { name: 'Entrée de marchandise' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sortie ou ajustement' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Valorisation' }).click();
  await expect(page.getByText('Valeur au prix de vente').first()).toBeVisible();
  await expect(page.getByText('Valeur au coût d’achat')).toHaveCount(0);
  const refused = await page.evaluate(() =>
    window.api.invoke('stock:exit', {
      variantId: 1,
      locationId: 1,
      type: 'theft',
      direction: 'out',
      quantity: 1,
      reason: 'Pirate',
    }),
  );
  expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
