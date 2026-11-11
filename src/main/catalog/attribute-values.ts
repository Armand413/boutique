import { AppError } from '@shared/ipc/errors';
import type { AttributeDefinition, AttributeValue } from '@shared/schemas/catalog';

export interface StoredAttributeValue {
  attributeId: number;
  valueText: string | null;
  valueNumber: number | null;
}

/** Convertit une valeur saisie selon le type de l'attribut ; message d'erreur sinon. */
export function storeValue(
  definition: AttributeDefinition,
  value: AttributeValue,
): StoredAttributeValue | string {
  const base = { attributeId: definition.id };
  switch (definition.valueType) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ...base, valueText: null, valueNumber: value }
        : `« ${definition.label} » attend un nombre.`;
    case 'boolean':
      return typeof value === 'boolean'
        ? { ...base, valueText: null, valueNumber: value ? 1 : 0 }
        : `« ${definition.label} » attend oui ou non.`;
    case 'choice':
      return typeof value === 'string' && (definition.choices ?? []).includes(value)
        ? { ...base, valueText: value, valueNumber: null }
        : `« ${definition.label} » : choisissez une valeur de la liste.`;
    case 'text':
      return typeof value === 'string'
        ? { ...base, valueText: value, valueNumber: null }
        : `« ${definition.label} » attend un texte.`;
  }
}

export function readValue(
  definition: AttributeDefinition,
  stored: StoredAttributeValue,
): AttributeValue {
  if (definition.valueType === 'boolean') return stored.valueNumber === 1;
  if (definition.valueType === 'number') return stored.valueNumber ?? 0;
  return stored.valueText ?? '';
}

/**
 * Valeurs d'attributs d'un produit, contrôlées contre les attributs applicables à sa catégorie :
 * attribut connu, valeur du bon type, attributs obligatoires renseignés.
 */
export function resolveAttributeValues(
  applicable: readonly AttributeDefinition[],
  inputs: readonly { attributeId: number; value: AttributeValue }[],
): StoredAttributeValue[] {
  const byId = new Map(applicable.map((definition) => [definition.id, definition]));
  const seen = new Set<number>();
  const stored: StoredAttributeValue[] = [];
  for (const input of inputs) {
    const definition = byId.get(input.attributeId);
    if (definition === undefined) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Un attribut ne correspond pas à la catégorie choisie.',
      );
    }
    if (seen.has(input.attributeId)) {
      throw new AppError('VALIDATION_ERROR', `« ${definition.label} » est renseigné deux fois.`);
    }
    seen.add(input.attributeId);
    const result = storeValue(definition, input.value);
    if (typeof result === 'string') throw new AppError('VALIDATION_ERROR', result);
    stored.push(result);
  }
  const missing = applicable.filter(
    (definition) => definition.isRequired && !seen.has(definition.id),
  );
  if (missing.length > 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Caractéristiques obligatoires à renseigner : ${missing.map((d) => d.label).join(', ')}.`,
    );
  }
  return stored;
}
