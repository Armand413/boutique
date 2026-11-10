import type { IpcChannel } from '@shared/ipc/channels';
import type { IpcInput, IpcOutput } from '@shared/ipc/contract';
import type { IpcErrorCode, IpcResult } from '@shared/ipc/errors';

/** Erreur renvoyée par le processus principal, avec un message prêt à afficher. */
export class IpcClientError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = 'IpcClientError';
    this.code = code;
  }
}

function isIpcResult(value: unknown): value is IpcResult<unknown> {
  return (
    typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
  );
}

type InvokeArgs<C extends IpcChannel> = IpcInput<C> extends undefined ? [] : [input: IpcInput<C>];

/** Appel typé d'un canal IPC : renvoie les données ou lève une IpcClientError. */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<IpcOutput<C>> {
  const result: unknown = await window.api.invoke(channel, args[0]);
  if (!isIpcResult(result)) {
    throw new IpcClientError('INTERNAL_ERROR', 'Réponse inattendue du processus principal.');
  }
  if (!result.ok) throw new IpcClientError(result.error.code, result.error.message);
  return result.data as IpcOutput<C>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
