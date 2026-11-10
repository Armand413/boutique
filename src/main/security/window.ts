import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export interface MainWindowOptions {
  preloadPath: string;
  allowDevTools: boolean;
}

/** Fenêtre principale avec les réglages de sécurité imposés (B.5). */
export function createMainWindow({ preloadPath, allowDevTools }: MainWindowOptions): BrowserWindow {
  return new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Boutique Gestion',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: allowDevTools,
      spellcheck: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });
}

export function preloadPathFrom(mainDirectory: string): string {
  return join(mainDirectory, '../preload/index.cjs');
}
