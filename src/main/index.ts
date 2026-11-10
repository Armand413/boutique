import { app, BrowserWindow, Menu, session } from 'electron';
import { join } from 'node:path';
import { initLogger, logger } from './logging/logger';
import {
  APP_ENTRY_URL,
  APP_ORIGIN,
  handleAppScheme,
  registerAppSchemePrivileges,
} from './security/protocol';
import { developmentCsp } from './security/csp';
import { installSecurityGuards } from './security/guards';
import { createMainWindow, preloadPathFrom } from './security/window';
import { registerIpc } from './ipc/register';
import { createHandlers } from './ipc/handlers';
import { PreferencesService } from './services/preferences-service';

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const isDevelopment = devServerUrl !== undefined;

configureUserDataForTests();
app.enableSandbox();
registerAppSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      logger.error('Démarrage impossible', { error });
      app.exit(1);
    });
}

/** Tests de bout en bout uniquement : dossier de données isolé (jamais dans l'application installée). */
function configureUserDataForTests(): void {
  const testDirectory = process.env.BOUTIQUE_TEST_USER_DATA;
  if (!app.isPackaged && testDirectory !== undefined && testDirectory !== '') {
    app.setPath('userData', testDirectory);
  }
}

function focusMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

async function start(): Promise<void> {
  initLogger(join(app.getPath('userData'), 'logs'), isDevelopment ? 'debug' : 'info');
  logger.info('Démarrage', { version: app.getVersion(), electron: process.versions.electron });

  const devOrigin = isDevelopment ? new URL(devServerUrl).origin : null;
  const trustedOrigins = devOrigin === null ? [APP_ORIGIN] : [APP_ORIGIN, devOrigin];
  const networkOrigins =
    devOrigin === null ? trustedOrigins : [...trustedOrigins, devOrigin.replace(/^http/, 'ws')];
  installSecurityGuards({ navigation: trustedOrigins, network: networkOrigins });
  handleAppScheme(join(__dirname, '../renderer'));
  if (isDevelopment) applyDevelopmentCsp(devServerUrl);

  const preferences = new PreferencesService(join(app.getPath('userData'), 'preferences.json'));
  registerIpc(createHandlers({ preferences }), trustedOrigins);

  if (!isDevelopment) Menu.setApplicationMenu(null);
  const window = createMainWindow({
    preloadPath: preloadPathFrom(__dirname),
    allowDevTools: isDevelopment,
  });
  window.once('ready-to-show', () => {
    window.show();
    logger.info('Fenêtre affichée', { startupMs: Math.round(process.uptime() * 1000) });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Processus d’interface arrêté', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  await window.loadURL(isDevelopment ? devServerUrl : APP_ENTRY_URL);
}

function applyDevelopmentCsp(url: string): void {
  const csp = developmentCsp(url);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}
