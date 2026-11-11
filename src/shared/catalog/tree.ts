import type { AttributeDefinition, Category } from '../schemas/catalog';
import type { Condition } from './constants';

type CategoryNode = Pick<Category, 'id' | 'parentId' | 'name'>;

/** Chaîne des catégories de la famille jusqu'à `categoryId` inclus. */
export function categoryChain<T extends CategoryNode>(
  categories: readonly T[],
  categoryId: number,
): T[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const chain: T[] = [];
  let cursor = byId.get(categoryId);
  while (cursor !== undefined && !chain.includes(cursor)) {
    chain.unshift(cursor);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return chain;
}

export function categoryPath(categories: readonly CategoryNode[], categoryId: number): string {
  return categoryChain(categories, categoryId)
    .map((category) => category.name)
    .join(' › ');
}

/** `categoryId` et toute sa descendance (filtre par famille ou catégorie). */
export function descendantIds(categories: readonly CategoryNode[], categoryId: number): number[] {
  const result = [categoryId];
  // Le parcours inclut les identifiants ajoutés en cours de boucle (descendance complète).
  for (const parent of result) {
    for (const category of categories) {
      if (category.parentId === parent && !result.includes(category.id)) result.push(category.id);
    }
  }
  return result;
}

/**
 * Attributs applicables à une catégorie : les siens et ceux de ses ancêtres (héritage, 4.12),
 * du plus général au plus précis, puis par ordre d'affichage.
 */
export function effectiveAttributes(
  categories: readonly CategoryNode[],
  attributes: readonly AttributeDefinition[],
  categoryId: number,
  options: { includeInactive?: boolean } = {},
): AttributeDefinition[] {
  const chain = categoryChain(categories, categoryId).map((category) => category.id);
  return attributes
    .filter(
      (attribute) =>
        chain.includes(attribute.categoryId) &&
        (options.includeInactive === true || attribute.isActive),
    )
    .sort(
      (a, b) =>
        chain.indexOf(a.categoryId) - chain.indexOf(b.categoryId) ||
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label, 'fr'),
    );
}

const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  new: 'Neuf',
  refurbished: 'Reconditionné',
  used: 'Occasion',
};

export interface VariantLabelParts {
  color: string | null;
  storageGb: number | null;
  ramGb: number | null;
  condition: Condition;
}

/** Libellé court d'une variante : « Noir · 128 Go / 6 Go RAM · Occasion ». */
export function variantLabel(variant: VariantLabelParts): string {
  const parts: string[] = [];
  if (variant.color !== null) parts.push(variant.color);
  const memory = [
    variant.storageGb === null ? null : `${String(variant.storageGb)} Go`,
    variant.ramGb === null ? null : `${String(variant.ramGb)} Go RAM`,
  ].filter((part): part is string => part !== null);
  if (memory.length > 0) parts.push(memory.join(' / '));
  if (variant.condition !== 'new') parts.push(CONDITION_LABELS[variant.condition]);
  return parts.join(' · ');
}
