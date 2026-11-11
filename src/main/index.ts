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
import { createAuthorizer } from './ipc/authorize';
import { registerIpc } from './ipc/register';
import { createHandlers } from './ipc/handlers';
import { safeStorageProtector } from './security/safe-storage';
import { PreferencesService } from './services/preferences-service';
import { AppRuntime } from './system/runtime';
import { electronFileDialogs } from './files/file-dialogs';

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

/** Tests de bout en bout uniquement : délai d'inactivité court, ignoré dans l'application installée. */
function testIdleLockOverride(): { idleLockSecondsOverride?: number } {
  const seconds = Number(process.env.BOUTIQUE_TEST_IDLE_SECONDS);
  if (app.isPackaged || !Number.isInteger(seconds) || seconds <= 0) return {};
  return { idleLockSecondsOverride: seconds };
}

const FIRST_BACKUP_DELAY_MS = 2 * 60_000;
const BACKUP_CHECK_INTERVAL_MS = 60 * 60_000;

/** Sauvegarde automatique (4.10) : vérifiée deux minutes après le démarrage, puis toutes les heures. */
function scheduleAutomaticBackups(runtime: AppRuntime): void {
  const run = (): void => {
    runtime.runAutomaticBackup().catch((error: unknown) => {
      logger.error('Sauvegarde automatique impossible', {
        message: error instanceof Error ? error.message : 'inconnue',
      });
    });
  };
  setTimeout(run, FIRST_BACKUP_DELAY_MS).unref();
  setInterval(run, BACKUP_CHECK_INTERVAL_MS).unref();
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

  const runtime = new AppRuntime({
    dataDirectory: join(app.getPath('userData'), 'donnees'),
    protector: safeStorageProtector,
    dialogs: electronFileDialogs,
    appVersion: app.getVersion(),
    ...testIdleLockOverride(),
  });
  const status = await runtime.start();
  logger.info('Base de données', { state: status.state });
  app.on('will-quit', () => runtime.close());
  scheduleAutomaticBackups(runtime);

  const preferences = new PreferencesService(join(app.getPath('userData'), 'preferences.json'));
  registerIpc(createHandlers({ preferences, runtime }), createAuthorizer(runtime), trustedOrigins);

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
