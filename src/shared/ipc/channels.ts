/**
 * Liste exhaustive des canaux IPC autorisés.
 * Ce fichier ne dépend de rien : il est embarqué tel quel dans le preload (bac à sable).
 */
export const IPC_CHANNELS = ['app:getInfo', 'preferences:get', 'preferences:set'] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value);
}
