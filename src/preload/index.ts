import { contextBridge, ipcRenderer } from 'electron';
import { isIpcChannel, type IpcChannel } from '../shared/ipc/channels';

/**
 * Unique pont entre l'interface et le processus principal (C.2).
 * Seuls les canaux listés passent ; la validation des données a lieu côté principal.
 */
const api = Object.freeze({
  invoke(channel: IpcChannel, input?: unknown): Promise<unknown> {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: 'Opération inconnue.' },
      });
    }
    return ipcRenderer.invoke(channel, input);
  },
});

contextBridge.exposeInMainWorld('api', api);
