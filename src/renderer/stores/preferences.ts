import { create } from 'zustand';
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesPatch,
} from '@shared/schemas/preferences';
import { errorMessage, invoke } from '../lib/ipc';

type Status = 'loading' | 'ready' | 'error';

interface PreferencesState {
  status: Status;
  error: string | null;
  preferences: Preferences;
  load: () => Promise<void>;
  /** Enregistre une modification ; lève une erreur si l'enregistrement échoue. */
  update: (patch: PreferencesPatch) => Promise<void>;
}

export const usePreferences = create<PreferencesState>()((set) => ({
  status: 'loading',
  error: null,
  preferences: DEFAULT_PREFERENCES,
  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const preferences = await invoke('preferences:get');
      set({ status: 'ready', preferences });
    } catch (error) {
      set({ status: 'error', error: errorMessage(error) });
    }
  },
  update: async (patch) => {
    const preferences = await invoke('preferences:set', patch);
    set({ preferences });
  },
}));
