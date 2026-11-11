import { useCallback } from 'react';
import {
  ATTRIBUTE_VALUE_TYPES,
  CONDITIONS,
  PRODUCT_TYPES,
  TRACKING_MODES,
  allowedTrackingModes,
  type ProductType,
} from '@shared/catalog/constants';
import { categoryPath } from '@shared/catalog/tree';
import { DEFAULT_CURRENCY, parseMoney } from '@shared/format/money';
import type { Permission } from '@shared/permissions';
import type { AttributeDefinition, AttributeValue, Category } from '@shared/schemas/catalog';
import type { SelectOption } from '../../components/ui/radix';
import type { Translate } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { useSession } from '../../stores/session';

/** Permission de la session courante (affichage seulement : le service contrôle à nouveau). */
export function useCan(permission: Permission): boolean {
  return useSession((state) => state.session?.permissions.includes(permission) ?? false);
}

/** Référentiels du catalogue (catégories, marques, taxes, attributs, emplacements). */
export function useCatalogReferences() {
  const loader = useCallback(() => invoke('catalog:references'), []);
  return useRemote(loader);
}

export function typeOptions(t: Translate): SelectOption[] {
  return PRODUCT_TYPES.map((type) => ({ value: type, label: t(`type.${type}`) }));
}

export function trackingOptions(t: Translate, type?: ProductType): SelectOption[] {
  const modes = type === undefined ? TRACKING_MODES : allowedTrackingModes(type);
  return modes.map((mode) => ({ value: mode, label: t(`tracking.${mode}`) }));
}

export function conditionOptions(t: Translate): SelectOption[] {
  return CONDITIONS.map((condition) => ({ value: condition, label: t(`condition.${condition}`) }));
}

export function valueTypeOptions(t: Translate): SelectOption[] {
  return ATTRIBUTE_VALUE_TYPES.map((type) => ({ value: type, label: t(`valueType.${type}`) }));
}

/** Catégories en arbre aplati : chemin complet en libellé, actives seulement (sauf `keep`). */
export function categoryOptions(categories: readonly Category[], keep?: number): SelectOption[] {
  return treeOrder(categories)
    .filter((category) => category.isActive || category.id === keep)
    .map((category) => ({
      value: String(category.id),
      label: categoryPath(categories, category.id),
    }));
}

/** Familles puis leurs descendantes, dans l'ordre d'affichage. */
export function treeOrder(categories: readonly Category[]): Category[] {
  const ordered: Category[] = [];
  const visit = (parentId: number | null): void => {
    for (const category of categories.filter((candidate) => candidate.parentId === parentId)) {
      ordered.push(category);
      visit(category.id);
    }
  };
  visit(null);
  return ordered;
}

/** Valeur affichée d'une caractéristique, avec son unité. */
export function formatAttribute(
  t: Translate,
  definition: AttributeDefinition,
  value: AttributeValue,
): string {
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  const text = typeof value === 'number' ? value.toLocaleString('fr-FR') : value;
  return definition.unit === null ? text : `${text} ${definition.unit}`;
}

/** Saisie d'un entier positif facultatif : '' → null ; invalide → undefined. */
export function parseOptionalInt(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** Saisie d'un montant : '' → null ; invalide → undefined. */
export function parseOptionalMoney(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const value = parseMoney(text);
  return value === null || value < 0 ? undefined : value;
}

/** Montant prérempli dans un champ (unités de la devise, relu par parseMoney). */
export function moneyText(amount: number | null): string {
  if (amount === null) return '';
  const { decimals } = DEFAULT_CURRENCY;
  return decimals === 0
    ? String(amount)
    : (amount / 10 ** decimals).toFixed(decimals).replace('.', ',');
}
