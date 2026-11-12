import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export interface MainWindowOptions {
  preloadPath: string;
  allowDevTools: boolean;
}

/** Taille souhaitée de la fenêtre, et taille minimale (l'interface s'ajuste en dessous, D92). */
const PREFERRED = { width: 1366, height: 768 };
const MINIMUM = { width: 800, height: 560 };

/**
 * Taille de départ : la zone de travail de l'écran (sans la barre des tâches) quand elle est plus
 * petite que la taille souhaitée, par exemple un écran 1366 × 768 en mise à l'échelle 125 %.
 */
export function initialSize(workArea: { width: number; height: number }): {
  width: number;
  height: number;
  maximize: boolean;
} {
  const width = Math.min(PREFERRED.width, workArea.width);
  const height = Math.min(PREFERRED.height, workArea.height);
  return {
    width: Math.max(Math.min(MINIMUM.width, workArea.width), width),
    height: Math.max(Math.min(MINIMUM.height, workArea.height), height),
    maximize: workArea.width <= PREFERRED.width || workArea.height <= PREFERRED.height,
  };
}

/** Fenêtre principale avec les réglages de sécurité imposés (B.5). */
export function createMainWindow({ preloadPath, allowDevTools }: MainWindowOptions): BrowserWindow {
  const size = initialSize(screen.getPrimaryDisplay().workAreaSize);
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: Math.min(MINIMUM.width, size.width),
    minHeight: Math.min(MINIMUM.height, size.height),
    show: false,
    title: 'Bouba Store',
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
  // Petit écran : la fenêtre occupe toute la zone de travail pour que tout tienne. Agrandie au
  // moment de l'afficher (agrandir une fenêtre cachée l'afficherait trop tôt sous Windows).
  if (size.maximize) window.once('ready-to-show', () => window.maximize());
  return window;
}

export function preloadPathFrom(mainDirectory: string): string {
  return join(mainDirectory, '../preload/index.cjs');
}
