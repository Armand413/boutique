import { create } from 'zustand';
import { setDateFormat } from '@shared/format/date';
import { setActiveCurrency } from '@shared/format/money';
import type { PublicSettings } from '@shared/schemas/settings';
import { invoke } from '../lib/ipc';

interface PublicSettingsState {
  settings: PublicSettings | null;
  /** Change à chaque rechargement : les écrans se redessinent avec la devise et les dates. */
  version: number;
  load: () => Promise<void>;
}

/** Devise, format de date et nom de la boutique, appliqués à l'affichage dès la connexion (4.11). */
export const usePublicSettings = create<PublicSettingsState>()((set, get) => ({
  settings: null,
  version: 0,
  load: async () => {
    const settings = await invoke('settings:public');
    setActiveCurrency(settings.currency);
    setDateFormat(settings.dateFormat);
    set({ settings, version: get().version + 1 });
  },
}));
