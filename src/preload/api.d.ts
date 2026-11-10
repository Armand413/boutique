import type { IpcChannel } from '../shared/ipc/channels';

export interface PreloadApi {
  invoke(channel: IpcChannel, input?: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    readonly api: PreloadApi;
  }
}
