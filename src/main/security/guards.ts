import { app, session, type WebContents } from 'electron';
import { logger } from '../logging/logger';

/** Origines autorisées à afficher l'interface : `app://renderer` et, en dev, le serveur Vite. */
export function isTrustedOrigin(url: string, trustedOrigins: readonly string[]): boolean {
  const origin = originOf(url);
  return origin !== null && trustedOrigins.includes(origin);
}

/**
 * Origine `schéma://hôte[:port]`. L'URL de Node renvoie « null » pour un schéma non spécial
 * comme `app:` : on la reconstruit, mais uniquement s'il y a un hôte (jamais pour file:, data:...).
 */
export function originOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== 'null') return parsed.origin;
  if (parsed.host === '') return null;
  return `${parsed.protocol}//${parsed.host}`;
}

/** URL sans paramètres ni fragment, pour ne jamais écrire de jeton dans le journal (B.3). */
export function loggableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const origin = originOf(url);
    // Sans hôte (data:, blob:, javascript:...), le « chemin » est le contenu : on ne garde que le schéma.
    return origin === null ? `${parsed.protocol}[contenu masqué]` : `${origin}${parsed.pathname}`;
  } catch {
    return '[url invalide]';
  }
}

export interface SecurityOrigins {
  /** Origines qui peuvent afficher l'interface et appeler l'IPC. */
  navigation: readonly string[];
  /** Origines joignables par le réseau : les mêmes, plus le WebSocket de Vite en dev. */
  network: readonly string[];
}

function hardenWebContents(contents: WebContents, trustedOrigins: readonly string[]): void {
  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('Ouverture de fenêtre bloquée', { url: loggableUrl(url) });
    return { action: 'deny' };
  });
  const blockNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (!isTrustedOrigin(url, trustedOrigins)) {
      event.preventDefault();
      logger.warn('Navigation bloquée', { url: loggableUrl(url) });
    }
  };
  contents.on('will-navigate', blockNavigation);
  contents.on('will-redirect', blockNavigation);
  contents.on('will-frame-navigate', (event) => {
    if (!isTrustedOrigin(event.url, trustedOrigins)) {
      event.preventDefault();
      logger.warn('Navigation de cadre bloquée', { url: loggableUrl(event.url) });
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn('Balise webview refusée');
  });
}

/**
 * Règles globales (B.5) : aucune permission accordée, aucune requête réseau sortante,
 * aucune navigation ni fenêtre en dehors de l'interface.
 */
export function installSecurityGuards(origins: SecurityOrigins): void {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn('Permission refusée', { permission });
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*', 'file://*/*'] },
    (details, callback) => {
      const allowed = isTrustedOrigin(details.url, origins.network);
      if (!allowed) logger.warn('Requête sortante bloquée', { url: loggableUrl(details.url) });
      callback({ cancel: !allowed });
    },
  );
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, origins.navigation);
  });
}
