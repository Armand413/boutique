import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';
import { PRODUCTION_CSP } from './csp';
import { logger } from '../logging/logger';

export const APP_SCHEME = 'app';
export const APP_HOST = 'renderer';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** À appeler avant l'événement `ready` de l'application. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

/** Résout un chemin d'URL dans `root` ; null s'il tente d'en sortir. */
export function resolveInsideRoot(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = normalize(join(root, decoded));
  const rel = relative(root, candidate);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return candidate;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EISDIR')
  );
}

function notFound(): Response {
  return new Response('Introuvable', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

/** Sert l'interface compilée depuis `rendererRoot`, avec les en-têtes de sécurité. */
export function handleAppScheme(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST || request.method !== 'GET') return notFound();
    const filePath = resolveInsideRoot(
      rendererRoot,
      url.pathname === '/' ? '/index.html' : url.pathname,
    );
    if (filePath === null) return notFound();
    const mime = MIME_TYPES[extname(filePath).toLowerCase()];
    if (mime === undefined) return notFound();
    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Security-Policy': PRODUCTION_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Referrer-Policy': 'no-referrer',
        },
      });
    } catch (error) {
      if (!isMissingFile(error)) {
        logger.error("Lecture d'une ressource de l'interface impossible", {
          path: url.pathname,
          error,
        });
      }
      return notFound();
    }
  });
}
