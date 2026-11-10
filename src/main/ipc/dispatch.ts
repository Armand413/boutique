import type { z } from 'zod';
import { isIpcChannel, type IpcChannel } from '@shared/ipc/channels';
import { ipcContract, type IpcOutput } from '@shared/ipc/contract';
import { AppError, type IpcResult } from '@shared/ipc/errors';
import { logger } from '../logging/logger';

export type IpcHandler<C extends IpcChannel> = (
  input: z.output<(typeof ipcContract)[C]['input']>,
) => Promise<IpcOutput<C>> | IpcOutput<C>;

export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> };

const VALIDATION_MESSAGE = 'Les données envoyées sont invalides.';
const INTERNAL_MESSAGE =
  'Une erreur interne est survenue. Réessayez ; si elle persiste, redémarrez l’application.';

async function runHandler<C extends IpcChannel>(
  channel: C,
  rawInput: unknown,
  handlers: IpcHandlers,
): Promise<IpcResult<IpcOutput<C>>> {
  const contract = ipcContract[channel];
  const input = contract.input.safeParse(rawInput);
  if (!input.success) {
    logger.warn('Entrée IPC refusée', {
      channel,
      issues: input.error.issues.map((i) => i.path.join('.')),
    });
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: VALIDATION_MESSAGE } };
  }
  const handler = handlers[channel] as IpcHandler<C>;
  const result = await handler(input.data as z.output<(typeof ipcContract)[C]['input']>);
  const output = contract.output.safeParse(result);
  if (!output.success) {
    logger.error('Sortie IPC non conforme au contrat', { channel });
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } };
  }
  return { ok: true, data: output.data as IpcOutput<C> };
}

/** Point d'entrée unique de tous les appels IPC : validation, exécution, traduction des erreurs. */
export async function dispatchIpc(
  channel: unknown,
  rawInput: unknown,
  handlers: IpcHandlers,
): Promise<IpcResult<unknown>> {
  if (!isIpcChannel(channel)) {
    logger.warn('Canal IPC inconnu', { channel: String(channel) });
    return { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: 'Opération inconnue.' } };
  }
  try {
    return await runHandler(channel, rawInput, handlers);
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    logger.error('Erreur non gérée dans un service', { channel, error });
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } };
  }
}
