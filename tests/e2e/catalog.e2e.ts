import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import {
  ADMIN,
  launchReady,
  login,
  logout,
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

/** Les fenêtres d'ouverture et d'enregistrement de fichiers renvoient les chemins du test. */
async function stubFileDialogs(paths: { open?: string; save?: string }): Promise<void> {
  await launched.app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: files.open === undefined,
        filePaths: files.open === undefined ? [] : [files.open],
      });
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: files.save === undefined, filePath: files.save ?? '' });
  }, paths);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openProducts(page: Page): Promise<void> {
  await nav(page).getByRole('button', { name: 'Produits' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Produits' })).toBeVisible();
}

async function moreAction(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name }).click();
}

async function toastShown(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

async function importCsv(page: Page, lines: string[]): Promise<void> {
  const file = join(launched.userData, 'import.csv');
  writeFileSync(file, `\uFEFF${lines.join('\n')}\n`);
  await stubFileDialogs({ open: file });
  await moreAction(page, 'Importer (Excel ou CSV)');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Choisir un fichier' }).click();
  await expect(dialog.getByText(/prêts à importer/)).toBeVisible();
  await dialog.getByRole('button', { name: /^Importer \d+ produit/ }).click();
  await toastShown(page, /Import terminé/);
}

test('l’administrateur organise le catalogue et crée un produit technique', async () => {
  const { page, userData } = launched;
  await openProducts(page);
  await expect(page.getByText('Aucun produit', { exact: true })).toBeVisible();
  await checkAccessibility(page, 'Produits (vide)');

  await moreAction(page, 'Marques');
  await page.getByRole('button', { name: 'Nouvelle marque' }).first().click();
  await page.getByRole('dialog').getByLabel('Nom de la marque *').fill('Jinko');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Marque enregistrée.');
  await expect(page.getByRole('cell', { name: 'Jinko', exact: true })).toBeVisible();
  await checkAccessibility(page, 'Marques');

  await openProducts(page);
  await moreAction(page, 'Catégories et caractéristiques');
  await page.getByRole('button', { name: 'Ajouter une sous-catégorie à Énergie solaire' }).click();
  await page.getByRole('dialog').getByLabel('Nom *').fill('Panneaux');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Catégorie enregistrée.');
  await page.getByRole('button', { name: 'Nouvelle caractéristique' }).click();
  const attributeDialog = page.getByRole('dialog');
  await attributeDialog.getByLabel('Libellé *').fill('Puissance crête');
  await expect(attributeDialog.getByLabel('Code *')).toHaveValue('puissance_crete');
  await attributeDialog.getByLabel('Unité (Wc, V, A, Ah, W, pouces…)').fill('Wc');
  await attributeDialog.getByLabel('Obligatoire sur la fiche produit').check();
  await attributeDialog.getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Caractéristique enregistrée.');
  await expect(page.getByRole('cell', { name: 'puissance_crete' })).toBeVisible();
  await checkAccessibility(page, 'Catégories');

  await openProducts(page);
  await page.getByRole('button', { name: 'Nouveau produit' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nom du produit *').fill('Panneau 400 Wc');
  await choose(page, 'Catégorie *', 'Énergie solaire › Panneaux');
  await choose(page, 'Marque', 'Jinko');
  await choose(page, 'Type *', 'Énergie solaire');
  await checkAccessibility(page, 'Nouveau produit');
  await form.getByLabel('Prix de vente *').fill('95 000');
  await form.getByRole('button', { name: 'Créer' }).click();
  await expect(form.getByText('Champ obligatoire.')).toBeVisible();
  await form.getByLabel('Puissance crête (Wc) *').fill('400');
  await form.getByLabel('Prix d’achat').fill('70000');
  await form.getByRole('button', { name: 'Créer' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Panneau 400 Wc' })).toBeVisible();
  await expect(page.getByText('400 Wc', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /70\s000\sFCFA/ })).toBeVisible();
  await checkAccessibility(page, 'Fiche produit');

  await page.getByRole('button', { name: 'Ajouter une variante' }).click();
  const variantForm = page.getByRole('dialog');
  await choose(page, 'État', 'Occasion');
  await variantForm.getByLabel('Prix de vente *').fill('60000');
  await variantForm.getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Variante enregistrée.');
  await expect(page.getByRole('cell', { name: 'Occasion', exact: true })).toBeVisible();

  const labels = join(userData, 'etiquettes.pdf');
  await stubFileDialogs({ save: labels });
  await page.getByRole('button', { name: 'Étiquettes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Créer le PDF' }).click();
  await toastShown(page, 'Étiquettes enregistrées.');
  expect(readFileSync(labels).subarray(0, 5).toString()).toBe('%PDF-');

  await openProducts(page);
  await expect(page.getByText('2 article(s)')).toBeVisible();
  await choose(page, 'Famille ou catégorie', 'Énergie solaire › Panneaux');
  await page.getByLabel('Puissance crête (Wc) minimum').fill('500');
  await expect(page.getByText('Aucun résultat', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await page.getByLabel('Rechercher un produit').fill('jinko pann');
  await expect(page.getByText('2 article(s)')).toBeVisible();
  await checkAccessibility(page, 'Produits');

  const exported = join(userData, 'catalogue.xlsx');
  await stubFileDialogs({ save: exported });
  await moreAction(page, 'Exporter en Excel');
  await toastShown(page, 'Catalogue exporté : 2 lignes.');
  expect(existsSync(exported)).toBe(true);

  await page.getByRole('button', { name: 'Ouvrir la fiche de Panneau 400 Wc' }).first().click();
  await page.getByRole('button', { name: 'Archiver' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archiver' }).click();
  await toastShown(page, 'Produit archivé.');
  await openProducts(page);
  await expect(page.getByText('Aucun produit', { exact: true })).toBeVisible();
});

test('importe un fichier CSV, compose un kit et retrouve un produit par Ctrl+K', async () => {
  const { page } = launched;
  await openProducts(page);
  await importCsv(page, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente',
    'Câble USB-C;Téléphonie;Accessoire;0011;2 500',
    'Coque silicone;Téléphonie;Accessoire;0022;1500',
  ]);
  await expect(page.getByText('2 article(s)')).toBeVisible();

  await page.getByRole('button', { name: 'Nouveau produit' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nom du produit *').fill('Kit recharge');
  await choose(page, 'Type *', 'Kit');
  await form.getByLabel('Prix de vente *').fill('3500');
  await form.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kit recharge' })).toBeVisible();
  await expect(page.getByText('Ce kit n’a encore aucun composant.')).toBeVisible();

  await page.getByRole('button', { name: 'Modifier la composition' }).click();
  const kit = page.getByRole('dialog');
  await kit.getByLabel('Ajouter un composant').fill('câble');
  await kit.getByRole('button', { name: 'Ajouter Câble USB-C' }).click();
  await kit.getByRole('button', { name: 'Quantité +1 : Câble USB-C' }).click();
  await checkAccessibility(page, 'Composition du kit');
  await kit.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Composition enregistrée.');
  await expect(page.getByText('Somme des composants : 5 000', { exact: false })).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /Écran, produit/ }).fill('0022');
  await expect(page.getByRole('option', { name: /Coque silicone/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Coque silicone' })).toBeVisible();
});

test('le vendeur consulte le catalogue sans prix d’achat ni modification', async () => {
  const { page } = launched;
  await openProducts(page);
  await importCsv(page, [
    'Nom;Catégorie;Type;Prix de vente;Prix d’achat',
    'Écouteurs;Téléphonie;Accessoire;5000;3100',
  ]);
  await expect(page.getByRole('columnheader', { name: 'Prix d’achat' })).toBeVisible();

  await nav(page).getByRole('button', { name: 'Utilisateurs' }).click();
  await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom complet').fill('Awa Vendeuse');
  await dialog.getByLabel('Identifiant').fill('awa');
  await dialog.getByLabel('Mot de passe provisoire').fill('Provisoire-2026');
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await toastShown(page, 'Utilisateur créé.');
  await logout(page);

  await login(page, 'awa', 'Provisoire-2026');
  await page.getByLabel('Mot de passe actuel').fill('Provisoire-2026');
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('Mangue-Sucree-77');
  await page.getByLabel('Confirmez le nouveau mot de passe').fill('Mangue-Sucree-77');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();

  await openProducts(page);
  await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Écouteurs' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Prix d’achat' })).toHaveCount(0);
  await expect(page.getByText('3 100')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nouveau produit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ouvrir la fiche de Écouteurs' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Écouteurs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Achat / coût moyen' })).toHaveCount(0);

  const refused = await page.evaluate(() =>
    window.api.invoke('products:create', {
      name: 'Pirate',
      brandId: null,
      categoryId: 1,
      model: null,
      description: null,
      productType: 'accessory',
      trackingMode: 'none',
      taxRateId: null,
      reorderLevel: 0,
      warrantyMonths: 0,
      weightKg: null,
      attributes: [],
      variants: [
        {
          sku: '',
          barcode: null,
          color: null,
          storageGb: null,
          ramGb: null,
          condition: 'new',
          salePrice: 1,
          minSalePrice: 0,
          isActive: true,
        },
      ],
    }),
  );
  expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await logout(page);
  await login(page, ADMIN.username, ADMIN.password);
});
