import { create } from 'zustand';
import type { ProductType, TrackingMode } from '@shared/catalog/constants';
import type { CartLine, Customer, Discount } from '@shared/schemas/sales';

export interface PosComponent {
  variantId: number;
  name: string;
  /** Nombre d'unités à choisir (quantité du kit × quantité du composant). */
  required: number;
  serialUnitIds: number[];
  serialNumbers: string[];
}

export interface PosLine {
  key: string;
  variantId: number;
  name: string;
  variantLabel: string;
  sku: string;
  productType: ProductType;
  trackingMode: TrackingMode;
  quantity: number;
  discount: Discount | null;
  serialUnitIds: number[];
  serialNumbers: string[];
  /** Kit : composants suivis dont il faut choisir les unités. */
  components: PosComponent[];
  /** Pour recalculer `required` quand la quantité du kit change. */
  componentQuantities: Record<number, number>;
  quoteLineId?: number;
}

export interface NewLine {
  variantId: number;
  name: string;
  variantLabel: string;
  sku: string;
  productType: ProductType;
  trackingMode: TrackingMode;
  components?: { variantId: number; name: string; quantity: number }[];
}

interface PosState {
  lines: PosLine[];
  customer: Customer | null;
  globalDiscount: Discount | null;
  heldSaleId: number | null;
  quote: { id: number; number: string } | null;
  add: (line: NewLine, unit?: { id: number; serialNumber: string }) => void;
  setQuantity: (key: string, quantity: number) => void;
  setDiscount: (key: string, discount: Discount | null) => void;
  setUnits: (key: string, ids: number[], serials: string[]) => void;
  setComponentUnits: (key: string, variantId: number, ids: number[], serials: string[]) => void;
  remove: (key: string) => void;
  setCustomer: (customer: Customer | null) => void;
  setGlobalDiscount: (discount: Discount | null) => void;
  load: (state: {
    lines: PosLine[];
    customer: Customer | null;
    heldSaleId: number | null;
    quote: { id: number; number: string } | null;
  }) => void;
  clear: () => void;
}

let nextKey = 0;
export function lineKey(): string {
  nextKey += 1;
  return `ligne-${String(nextKey)}`;
}

function componentsFor(
  line: NewLine,
  quantity: number,
): { components: PosComponent[]; quantities: Record<number, number> } {
  const quantities: Record<number, number> = {};
  const components = (line.components ?? []).map((component) => {
    quantities[component.variantId] = component.quantity;
    return {
      variantId: component.variantId,
      name: component.name,
      required: component.quantity * quantity,
      serialUnitIds: [],
      serialNumbers: [],
    };
  });
  return { components, quantities };
}

/** Panier de la caisse, tenu dans l'interface ; les montants font foi côté processus principal. */
export const usePos = create<PosState>()((set) => ({
  lines: [],
  customer: null,
  globalDiscount: null,
  heldSaleId: null,
  quote: null,
  add: (line, unit) =>
    set((state) => {
      const tracked =
        line.trackingMode !== 'none' &&
        line.productType !== 'kit' &&
        line.productType !== 'service';
      const existing = state.lines.find(
        (candidate) =>
          candidate.variantId === line.variantId && candidate.quoteLineId === undefined,
      );
      if (existing !== undefined && unit !== undefined && existing.serialUnitIds.includes(unit.id))
        return state;
      if (existing !== undefined && (!tracked || unit !== undefined)) {
        return {
          lines: state.lines.map((candidate) => {
            if (candidate !== existing) return candidate;
            const quantity =
              tracked && unit !== undefined && candidate.serialUnitIds.length < candidate.quantity
                ? candidate.quantity
                : candidate.quantity + 1;
            return {
              ...candidate,
              quantity,
              serialUnitIds:
                unit === undefined
                  ? candidate.serialUnitIds
                  : [...candidate.serialUnitIds, unit.id],
              serialNumbers:
                unit === undefined
                  ? candidate.serialNumbers
                  : [...candidate.serialNumbers, unit.serialNumber],
              components: candidate.components.map((component) => ({
                ...component,
                required: (candidate.componentQuantities[component.variantId] ?? 0) * quantity,
              })),
            };
          }),
        };
      }
      const { components, quantities } = componentsFor(line, 1);
      return {
        lines: [
          ...state.lines,
          {
            key: lineKey(),
            variantId: line.variantId,
            name: line.name,
            variantLabel: line.variantLabel,
            sku: line.sku,
            productType: line.productType,
            trackingMode: line.trackingMode,
            quantity: 1,
            discount: null,
            serialUnitIds: unit === undefined ? [] : [unit.id],
            serialNumbers: unit === undefined ? [] : [unit.serialNumber],
            components,
            componentQuantities: quantities,
          },
        ],
      };
    }),
  setQuantity: (key, quantity) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.key !== key
          ? line
          : {
              ...line,
              quantity: Math.max(1, Math.min(10_000, quantity)),
              serialUnitIds: line.serialUnitIds.slice(0, quantity),
              serialNumbers: line.serialNumbers.slice(0, quantity),
              components: line.components.map((component) => {
                const required = (line.componentQuantities[component.variantId] ?? 0) * quantity;
                return {
                  ...component,
                  required,
                  serialUnitIds: component.serialUnitIds.slice(0, required),
                  serialNumbers: component.serialNumbers.slice(0, required),
                };
              }),
            },
      ),
    })),
  setDiscount: (key, discount) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.key === key ? { ...line, discount } : line)),
    })),
  setUnits: (key, ids, serials) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.key === key
          ? {
              ...line,
              quantity: Math.max(ids.length, 1),
              serialUnitIds: ids,
              serialNumbers: serials,
            }
          : line,
      ),
    })),
  setComponentUnits: (key, variantId, ids, serials) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.key !== key
          ? line
          : {
              ...line,
              components: line.components.map((component) =>
                component.variantId === variantId
                  ? { ...component, serialUnitIds: ids, serialNumbers: serials }
                  : component,
              ),
            },
      ),
    })),
  remove: (key) => set((state) => ({ lines: state.lines.filter((line) => line.key !== key) })),
  setCustomer: (customer) => set({ customer }),
  setGlobalDiscount: (globalDiscount) => set({ globalDiscount }),
  load: (next) => set({ ...next, globalDiscount: null }),
  clear: () =>
    set({ lines: [], customer: null, globalDiscount: null, heldSaleId: null, quote: null }),
}));

/** Lignes envoyées au processus principal. */
export function cartLines(lines: readonly PosLine[]): CartLine[] {
  return lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    discount: line.discount,
    ...(line.serialUnitIds.length > 0 ? { serialUnitIds: line.serialUnitIds } : {}),
    ...(line.components.length > 0
      ? {
          components: line.components.map((component) => ({
            variantId: component.variantId,
            serialUnitIds: component.serialUnitIds,
          })),
        }
      : {}),
    ...(line.quoteLineId === undefined ? {} : { quoteLineId: line.quoteLineId }),
  }));
}
