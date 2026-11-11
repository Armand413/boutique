/** Énumérations du catalogue, identiques aux CHECK de la base (migration 0002). */
export const PRODUCT_TYPES = [
  'phone',
  'accessory',
  'electronics',
  'appliance',
  'solar',
  'part',
  'service',
  'kit',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const TRACKING_MODES = ['none', 'serial', 'imei'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const CONDITIONS = ['new', 'refurbished', 'used'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const ATTRIBUTE_VALUE_TYPES = ['text', 'number', 'choice', 'boolean'] as const;
export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number];

export const SERIAL_STATUSES = [
  'in_stock',
  'reserved',
  'sold',
  'returned',
  'defective',
  'supplier_returned',
  'written_off',
] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

/** Profondeur maximale de l'arbre : famille > catégorie > sous-catégorie (trigger de la base). */
export const MAX_CATEGORY_DEPTH = 3;

/** Un service ou un kit n'a pas de stock propre (E.2). */
export function isStockedType(type: ProductType): boolean {
  return type !== 'service' && type !== 'kit';
}

/**
 * Modes de suivi permis pour un type : un téléphone est toujours suivi par IMEI,
 * un service ou un kit jamais.
 */
export function allowedTrackingModes(type: ProductType): readonly TrackingMode[] {
  if (type === 'phone') return ['imei'];
  if (!isStockedType(type)) return ['none'];
  return TRACKING_MODES;
}

/**
 * Mode de suivi retenu pour un type, en partant du mode souhaité ou de celui de la catégorie.
 * L'IMEI proposé par une famille (Téléphonie) ne vaut que pour les téléphones : un accessoire de
 * cette famille n'est pas suivi par défaut.
 */
export function coerceTrackingMode(type: ProductType, wanted: TrackingMode): TrackingMode {
  if (wanted === 'imei' && type !== 'phone') return 'none';
  const allowed = allowedTrackingModes(type);
  return allowed.includes(wanted) ? wanted : (allowed[0] ?? 'none');
}

export const SEARCH_PAGE_MAX = 200;
