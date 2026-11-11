import type { z } from 'zod';
import { isIpcChannel, type IpcChannel } from '@shared/ipc/channels';
import { ipcContract, type IpcAccess, type IpcOutput } from '@shared/ipc/contract';
import { AppError, type IpcResult } from '@shared/ipc/errors';
import type { Session } from '../auth/session';
import { toAppError } from '../db/errors';
import { logger } from '../logging/logger';

export interface IpcContext {
  /** Session contrôlée par `authorize` ; null pour un canal public. */
  session: Session | null;
}

export type IpcHandler<C extends IpcChannel> = (
  input: z.output<(typeof ipcContract)[C]['input']>,
  context: IpcContext,
) => Promise<IpcOutput<C>> | IpcOutput<C>;

export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> };

/** Vérifie l'accès d'un canal ; lève une AppError s'il est refusé. */
export type Authorize = (access: IpcAccess) => Session | null;

const VALIDATION_MESSAGE = 'Les données envoyées sont invalides.';
const INTERNAL_MESSAGE =
  'Une erreur interne est survenue. Réessayez ; si elle persiste, redémarrez l’application.';

async function runHandler<C extends IpcChannel>(
  channel: C,
  rawInput: unknown,
  handlers: IpcHandlers,
  authorize: Authorize,
): Promise<IpcResult<IpcOutput<C>>> {
  const contract = ipcContract[channel];
  const session = authorize(contract.access);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) {
    logger.warn('Entrée IPC refusée', {
      channel,
      issues: input.error.issues.map((i) => i.path.join('.')),
    });
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: VALIDATION_MESSAGE } };
  }
  const handler = handlers[channel] as IpcHandler<C>;
  const result = await handler(input.data as z.output<(typeof ipcContract)[C]['input']>, {
    session,
  });
  const output = contract.output.safeParse(result);
  if (!output.success) {
    logger.error('Sortie IPC non conforme au contrat', { channel });
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } };
  }
  return { ok: true, data: output.data as IpcOutput<C> };
}

/** Point d'entrée unique de tous les appels IPC : accès, validation, exécution, traduction des erreurs. */
export async function dispatchIpc(
  channel: unknown,
  rawInput: unknown,
  handlers: IpcHandlers,
  authorize: Authorize,
): Promise<IpcResult<unknown>> {
  if (!isIpcChannel(channel)) {
    logger.warn('Canal IPC inconnu', { channel: String(channel) });
    return { ok: false, error: { code: 'UNKNOWN_CHANNEL', message: 'Opération inconnue.' } };
  }
  try {
    return await runHandler(channel, rawInput, handlers, authorize);
  } catch (error) {
    const appError = error instanceof AppError ? error : toAppError(error);
    if (appError !== null) {
      if (appError.code === 'FORBIDDEN') logger.warn('Accès refusé', { channel });
      return { ok: false, error: { code: appError.code, message: appError.message } };
    }
    logger.error('Erreur non gérée dans un service', { channel, error });
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } };
  }
}
