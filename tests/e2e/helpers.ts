import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { login, logout, nav } from './fixtures';

/** Les fenêtres d'ouverture et d'enregistrement de fichiers renvoient les chemins du test. */
export async function stubFileDialogs(
  app: ElectronApplication,
  paths: { open?: string; save?: string },
): Promise<void> {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: files.open === undefined,
        filePaths: files.open === undefined ? [] : [files.open],
      });
    dialog.showSaveDialog = () =>
      Promise.resolve({ canceled: files.save === undefined, filePath: files.save ?? '' });
  }, paths);
}

export async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function openModule(page: Page, name: string): Promise<void> {
  await nav(page).getByRole('button', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

export async function moreAction(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name }).click();
}

export async function toastShown(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

/** Import CSV depuis l'écran Produits (fenêtre d'ouverture simulée). */
export async function importCsv(
  app: ElectronApplication,
  page: Page,
  userData: string,
  lines: string[],
): Promise<void> {
  const file = join(userData, 'import.csv');
  writeFileSync(file, `\uFEFF${lines.join('\n')}\n`);
  await stubFileDialogs(app, { open: file });
  await moreAction(page, 'Importer (Excel ou CSV)');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Choisir un fichier' }).click();
  await expect(dialog.getByText(/prêts à importer/)).toBeVisible();
  await dialog.getByRole('button', { name: /^Importer \d+ produit/ }).click();
  await toastShown(page, /Import terminé/);
}

/** Crée un vendeur, puis s'y connecte en changeant son mot de passe provisoire. */
export async function signInAsNewSeller(page: Page): Promise<void> {
  await openModule(page, 'Utilisateurs');
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
  await expect(nav(page)).toBeVisible();
}
