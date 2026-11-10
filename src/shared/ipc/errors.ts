/** Codes d'erreur renvoyés à l'interface : jamais de pile ni de détail technique. */
export const IPC_ERROR_CODES = [
  'VALIDATION_ERROR',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNKNOWN_CHANNEL',
  'INTERNAL_ERROR',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcError {
  code: IpcErrorCode;
  /** Message en français, compréhensible par l'utilisateur. */
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

/** Erreur métier levée par les services ; son message est destiné à l'utilisateur. */
export class AppError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
