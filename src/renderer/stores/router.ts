import { create } from 'zustand';
import { DEFAULT_ROUTE, type RouteName } from '../app/routes';

const MAX_HISTORY = 50;

export interface RouterState {
  current: RouteName;
  history: RouteName[];
  navigate: (route: RouteName) => void;
  back: () => void;
  /** Retour à l'écran d'accueil sans historique (changement d'utilisateur). */
  reset: () => void;
}

/** Routeur en mémoire : l'application n'a pas d'URL visible, seulement une pile d'écrans. */
export function createRouterStore(initial: RouteName = DEFAULT_ROUTE) {
  return create<RouterState>()((set) => ({
    current: initial,
    history: [],
    navigate: (route) =>
      set((state) =>
        route === state.current
          ? state
          : { current: route, history: [...state.history, state.current].slice(-MAX_HISTORY) },
      ),
    reset: () => set({ current: initial, history: [] }),
    back: () =>
      set((state) => {
        const previous = state.history.at(-1);
        return previous === undefined
          ? state
          : { current: previous, history: state.history.slice(0, -1) };
      }),
  }));
}

export const useRouter = createRouterStore();
