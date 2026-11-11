import { create } from 'zustand';
import { DEFAULT_ROUTE, type RouteName } from '../app/routes';

const MAX_HISTORY = 50;

/** Paramètres d'un écran (par exemple le produit affiché par la fiche produit). */
export interface RouteParams {
  productId?: number;
  supplierId?: number;
  saleId?: number;
  customerId?: number;
  quoteId?: number;
  /** Écran Stock ouvert sur les articles sous le seuil d'alerte. */
  lowStock?: boolean;
}

interface HistoryEntry {
  route: RouteName;
  params: RouteParams;
}

export interface RouterState {
  current: RouteName;
  params: RouteParams;
  history: HistoryEntry[];
  navigate: (route: RouteName, params?: RouteParams) => void;
  back: () => void;
  /** Retour à l'écran d'accueil sans historique (changement d'utilisateur). */
  reset: () => void;
}

function sameParams(a: RouteParams, b: RouteParams): boolean {
  return (
    a.productId === b.productId &&
    a.supplierId === b.supplierId &&
    a.lowStock === b.lowStock &&
    a.saleId === b.saleId &&
    a.customerId === b.customerId &&
    a.quoteId === b.quoteId
  );
}

/** Routeur en mémoire : l'application n'a pas d'URL visible, seulement une pile d'écrans. */
export function createRouterStore(initial: RouteName = DEFAULT_ROUTE) {
  return create<RouterState>()((set) => ({
    current: initial,
    params: {},
    history: [],
    navigate: (route, params = {}) =>
      set((state) =>
        route === state.current && sameParams(params, state.params)
          ? state
          : {
              current: route,
              params,
              history: [...state.history, { route: state.current, params: state.params }].slice(
                -MAX_HISTORY,
              ),
            },
      ),
    reset: () => set({ current: initial, params: {}, history: [] }),
    back: () =>
      set((state) => {
        const previous = state.history.at(-1);
        return previous === undefined
          ? state
          : {
              current: previous.route,
              params: previous.params,
              history: state.history.slice(0, -1),
            };
      }),
  }));
}

export const useRouter = createRouterStore();
