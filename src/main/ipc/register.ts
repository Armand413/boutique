import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channels';
import { dispatchIpc, type Authorize, type IpcHandlers } from './dispatch';
import { isTrustedOrigin } from '../security/guards';
import { logger } from '../logging/logger';

/** Enregistre chaque canal listé ; refuse tout appel qui ne vient pas de l'interface de confiance. */
export function registerIpc(
  handlers: IpcHandlers,
  authorize: Authorize,
  trustedOrigins: readonly string[],
): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, rawInput: unknown) => {
      const senderUrl = event.senderFrame?.url ?? '';
      if (!isTrustedOrigin(senderUrl, trustedOrigins) || event.senderFrame?.parent !== null) {
        logger.warn('Appel IPC refusé : origine non autorisée', { channel });
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Opération non autorisée.' } };
      }
      return dispatchIpc(channel, rawInput, handlers, authorize);
    });
  }
}
