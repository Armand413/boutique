import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Contrôle WCAG 2.1 AA de l'écran affiché, en thème clair puis sombre. */
export async function checkAccessibility(page: Page, screen: string): Promise<void> {
  // Animations réduites (gérées par l'application) : les couleurs sont mesurées une fois la
  // transition de thème terminée, jamais à mi-chemin.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
    await page.waitForTimeout(50);
    const result = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${screen}/${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
      ),
    ).toEqual([]);
  }
}
