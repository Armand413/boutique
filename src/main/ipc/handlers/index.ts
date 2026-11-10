import { app } from 'electron';
import type { IpcHandlers } from '../dispatch';
import type { PreferencesService } from '../../services/preferences-service';

export interface HandlerDependencies {
  preferences: PreferencesService;
}

export function createHandlers({ preferences }: HandlerDependencies): IpcHandlers {
  return {
    'app:getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      isPackaged: app.isPackaged,
    }),
    'preferences:get': () => preferences.get(),
    'preferences:set': (patch) => preferences.update(patch),
  };
}
