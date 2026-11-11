import { create } from 'zustand';

interface StockEventsState {
  /** Incrémenté après chaque opération de stock (entrée, sortie, transfert, retour). */
  version: number;
  changed: () => void;
}

/** Signal « le stock a changé » : rafraîchit les indicateurs (alertes de l'en-tête) sans recharger l'écran. */
export const useStockEvents = create<StockEventsState>()((set) => ({
  version: 0,
  changed: () => set((state) => ({ version: state.version + 1 })),
}));
