import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkAccessibility } from './a11y';
import {
  ADMIN,
  createUserData,
  launchApp,
  launchReady,
  login,
  nav,
  removeUserData,
  type LaunchedApp,
} from './fixtures';
import { choose, importCsv, openModule, stubFileDialogs, toastShown } from './helpers';

let launched: LaunchedApp;
const others: LaunchedApp[] = [];
const BACKUP_PASSWORD = 'Coffre-Fort-Abidjan-9';

test.beforeEach(async () => {
  launched = await launchReady();
});

test.afterEach(async () => {
  for (const other of others.splice(0)) {
    await other.app.close();
    removeUserData(other.userData);
  }
  await launched.app.close();
  removeUserData(launched.userData);
});

async function openSection(page: Page, name: string): Promise<void> {
  await openModule(page, 'Paramètres');
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function setBackupPassword(page: Page): Promise<void> {
  await openSection(page, 'Sauvegardes');
  await expect(page.getByText('Aucun mot de passe : les sauvegardes sont arrêtées.')).toBeVisible();
  await page.getByLabel('Votre mot de passe de connexion').fill(ADMIN.password);
  await page.getByLabel('Nouveau mot de passe des sauvegardes').fill(BACKUP_PASSWORD);
  await page.getByLabel('Confirmez le mot de passe des sauvegardes').fill(BACKUP_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await toastShown(page, 'Mot de passe des sauvegardes enregistré.');
  await expect(page.getByText('Mot de passe défini.')).toBeVisible();
}

async function backupTo(app: LaunchedApp, file: string): Promise<void> {
  await stubFileDialogs(app.app, { save: file });
  await app.page.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
  await toastShown(app.page, 'Sauvegarde enregistrée.');
  expect(existsSync(file)).toBe(true);
}

async function restoreFrom(page: Page, withSession: boolean): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Choisir le fichier de sauvegarde' }).click();
  await expect(dialog.getByText(/Sauvegarde du .* · Boutique du Plateau/)).toBeVisible();
  await dialog.getByLabel('Mot de passe de la sauvegarde').fill(BACKUP_PASSWORD);
  if (withSession) await dialog.getByLabel('Votre mot de passe de connexion').fill(ADMIN.password);
  await checkAccessibility(page, 'Restauration');
  await dialog.getByRole('button', { name: 'Restaurer', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible({
    timeout: 20_000,
  });
}

test('paramètres : identité, devise et factures, taxes, impression et sécurité', async () => {
  const { page } = launched;
  await openModule(page, 'Paramètres');
  await checkAccessibility(page, 'Paramètres');

  await openSection(page, 'Boutique');
  await page.getByLabel('Adresse', { exact: true }).fill('Rue du Commerce, Plateau');
  await page.getByLabel('Téléphone').fill('27 20 21 22 23');
  await page.getByLabel('Mentions légales (RCCM, NIF…)').fill('RCCM CI-ABJ-2026-B-0042');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Paramètres enregistrés.');
  await checkAccessibility(page, 'Paramètres boutique');

  await openSection(page, 'Devise, dates et factures');
  await page.getByLabel('Préfixe des factures').fill('btq');
  await expect(page.getByText(/Exemple : BTQ-\d{4}-000123/)).toBeVisible();
  await choose(page, 'Format des dates', 'aaaa-mm-jj (2026-12-31)');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Paramètres enregistrés.');
  await checkAccessibility(page, 'Paramètres régionaux');

  await openSection(page, 'Taux de taxe');
  await page.getByRole('button', { name: 'Nouveau taux' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom *').fill('TVA réduite');
  await dialog.getByLabel('Taux (%)').fill('9');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('row', { name: /TVA réduite/ })).toContainText('9 %');
  await checkAccessibility(page, 'Taux de taxe');

  await openSection(page, 'Impression');
  await page.getByRole('button', { name: 'Imprimer un ticket d’essai' }).click();
  await toastShown(page, 'Ticket d’essai écrit par le simulateur.');
  await choose(page, 'Imprimante de tickets', 'Imprimante réseau ESC/POS');
  await expect(page.getByLabel('Adresse IP ou nom')).toBeVisible();
  await checkAccessibility(page, 'Impression');

  await openSection(page, 'Sécurité et anti-fraude');
  await page.getByLabel('Vendeur (%)').fill('5');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await toastShown(page, 'Paramètres enregistrés.');
  await checkAccessibility(page, 'Sécurité');

  await openModule(page, 'Produits');
  await importCsv(launched.app, page, launched.userData, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente',
    'Câble USB-C;Téléphonie;Accessoire;0011;2500',
  ]);
  const invoice = await page.evaluate(async () => {
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
      limit: 5,
    })) as {
      rows: { variantId: number }[];
    };
    const locations = (await call('locations:list')) as { id: number }[];
    await call('stock:exit', {
      variantId: search.rows[0]?.variantId,
      locationId: locations[0]?.id,
      type: 'adjustment',
      direction: 'in',
      quantity: 2,
      reason: 'Stock initial',
    });
    await call('cash:open', { openingFloat: 0 });
    const sale = (await call('sales:checkout', {
      customerId: null,
      lines: [{ variantId: search.rows[0]?.variantId, quantity: 1, discount: null }],
      globalDiscount: null,
      payments: [{ method: 'cash', amount: 2500, reference: null }],
      installments: null,
      delivery: null,
    })) as { invoiceNumber: string };
    return sale.invoiceNumber;
  });
  expect(invoice).toMatch(/^BTQ-\d{4}-000001$/);
});

test('sauvegarde externe puis restauration depuis les paramètres', async () => {
  const { page } = launched;
  await setBackupPassword(page);
  await checkAccessibility(page, 'Sauvegardes');
  const file = join(launched.userData, 'cle-usb.bgsauv');
  await backupTo(launched, file);
  expect(readFileSync(file).subarray(0, 8).toString('ascii')).toBe('BGSAUV01');
  await expect(page.getByRole('row', { name: /cle-usb\.bgsauv/ })).toContainText('Externe');

  await openSection(page, 'Boutique');
  await page.getByLabel('Nom de la boutique *').fill('Nom provisoire');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastShown(page, 'Paramètres enregistrés.');

  await openSection(page, 'Sauvegardes');
  await stubFileDialogs(launched.app, { open: file });
  await page.getByRole('button', { name: 'Restaurer une sauvegarde' }).click();
  await restoreFrom(page, true);
  await login(page, ADMIN.username, ADMIN.password);
  await expect(nav(page)).toBeVisible();
  await openSection(page, 'Boutique');
  await expect(page.getByLabel('Nom de la boutique *')).toHaveValue('Boutique du Plateau');
});

test('restauration sur un poste neuf depuis l’assistant de premier lancement', async () => {
  await setBackupPassword(launched.page);
  const file = join(launched.userData, 'externe.bgsauv');
  await backupTo(launched, file);

  const fresh = await launchApp(createUserData());
  others.push(fresh);
  await expect(fresh.page.getByRole('heading', { level: 1, name: 'Bienvenue' })).toBeVisible();
  await stubFileDialogs(fresh.app, { open: file });
  await fresh.page.getByRole('button', { name: 'Restaurer une sauvegarde' }).click();
  await restoreFrom(fresh.page, false);
  await login(fresh.page, ADMIN.username, ADMIN.password);
  await expect(nav(fresh.page)).toBeVisible();
  await expect(
    fresh.page.getByRole('heading', { level: 1, name: 'Tableau de bord' }),
  ).toBeVisible();
});

test('activités sensibles : remise inhabituelle signalée à l’administrateur', async () => {
  const { page } = launched;
  await openModule(page, 'Produits');
  await importCsv(launched.app, page, launched.userData, [
    'Nom;Catégorie;Type;Code-barres;Prix de vente',
    'Coque;Téléphonie;Accessoire;0099;10000',
  ]);
  await page.evaluate(async () => {
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
      limit: 5,
    })) as {
      rows: { variantId: number }[];
    };
    const locations = (await call('locations:list')) as { id: number }[];
    const variantId = search.rows[0]?.variantId;
    await call('stock:exit', {
      variantId,
      locationId: locations[0]?.id,
      type: 'adjustment',
      direction: 'in',
      quantity: 5,
      reason: 'Stock initial',
    });
    await call('cash:open', { openingFloat: 0 });
    await call('sales:checkout', {
      customerId: null,
      lines: [{ variantId, quantity: 1, discount: { type: 'percent', value: 4000 } }],
      globalDiscount: null,
      payments: [{ method: 'cash', amount: 6000, reference: null }],
      installments: null,
      delivery: null,
    });
  });
  await openModule(page, 'Tableau de bord');
  await expect(
    page.getByRole('button', { name: /^1\s*Activités sensibles \(7 jours\)/ }),
  ).toBeVisible();
  await openModule(page, 'Rapports');
  await choose(page, 'Rapport', 'Activités sensibles');
  await expect(page.getByRole('row', { name: /Remise inhabituelle/ })).toContainText(
    'Coque : 40 %',
  );
  await checkAccessibility(page, 'Activités sensibles');
});
