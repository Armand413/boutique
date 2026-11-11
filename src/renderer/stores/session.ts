import { create } from 'zustand';
import type { SessionInfo, SetupInput, SystemStatus } from '@shared/schemas/auth';
import { errorMessage, invoke, onSessionInvalidated } from '../lib/ipc';

interface SessionState {
  loading: boolean;
  loadError: string | null;
  status: SystemStatus | null;
  session: SessionInfo | null;
  /** Clé de récupération à faire noter (après l'installation ou une récupération). */
  pendingRecoveryKey: string | null;
  refresh: () => Promise<void>;
  completeSetup: (input: SetupInput) => Promise<void>;
  acknowledgeRecoveryKey: () => void;
  unlockDatabase: (recoveryKey: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  loginWithPin: (username: string, pin: string) => Promise<void>;
  recoverAdmin: (username: string, recoveryKey: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: (secret: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** État du poste vu par l'interface : statut de la base et session ouverte dans le processus principal. */
export const useSession = create<SessionState>()((set, get) => ({
  loading: true,
  loadError: null,
  status: null,
  session: null,
  pendingRecoveryKey: null,
  refresh: async () => {
    try {
      const status = await invoke('system:getStatus');
      const session = status.state === 'ready' ? await invoke('session:get') : null;
      set({ loading: false, loadError: null, status, session });
    } catch (error) {
      set({ loading: false, loadError: errorMessage(error) });
    }
  },
  completeSetup: async (input) => {
    const { recoveryKey } = await invoke('setup:complete', input);
    set({ pendingRecoveryKey: recoveryKey });
    await get().refresh();
  },
  acknowledgeRecoveryKey: () => set({ pendingRecoveryKey: null }),
  unlockDatabase: async (recoveryKey) => {
    const status = await invoke('system:unlockDatabase', { recoveryKey });
    set({ status });
    await get().refresh();
  },
  login: async (username, password) => {
    set({ session: await invoke('auth:login', { username, password }) });
  },
  loginWithPin: async (username, pin) => {
    set({ session: await invoke('auth:loginPin', { username, pin }) });
  },
  recoverAdmin: async (username, recoveryKey, newPassword) => {
    const result = await invoke('auth:recoverAdmin', { username, recoveryKey, newPassword });
    set({ pendingRecoveryKey: result.recoveryKey });
  },
  changePassword: async (currentPassword, newPassword) => {
    set({ session: await invoke('auth:changePassword', { currentPassword, newPassword }) });
  },
  lock: async () => {
    set({ session: await invoke('session:lock') });
  },
  unlock: async (secret) => {
    set({ session: await invoke('session:unlock', { secret }) });
  },
  logout: async () => {
    await invoke('auth:logout');
    set({ session: null });
  },
}));

onSessionInvalidated(() => {
  void useSession.getState().refresh();
});
