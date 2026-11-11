import { BrowserWindow, dialog } from 'electron';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Fenêtres d'ouverture et d'enregistrement, ouvertes par le processus principal :
 * l'interface ne choisit jamais elle-même un chemin sur le disque (B.5).
 */
export interface FileDialogs {
  openFile(options: { title: string; filters: FileFilter[] }): Promise<string | null>;
  saveFile(options: {
    title: string;
    defaultName: string;
    filters: FileFilter[];
  }): Promise<string | null>;
}

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

export const electronFileDialogs: FileDialogs = {
  async openFile({ title, filters }) {
    const window = parentWindow();
    const options = { title, filters, properties: ['openFile' as const] };
    const result =
      window === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  async saveFile({ title, defaultName, filters }) {
    const window = parentWindow();
    const options = { title, defaultPath: defaultName, filters };
    const result =
      window === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(window, options);
    return result.canceled || result.filePath === '' ? null : result.filePath;
  },
};
