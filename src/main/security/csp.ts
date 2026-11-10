/**
 * Politique de sécurité du contenu (B.5). Aucune ressource distante n'est autorisée.
 * `style-src 'unsafe-inline'` : nécessaire aux balises <style> injectées par Radix
 * (verrouillage du défilement des fenêtres modales) ; aucun script en ligne n'est permis.
 */
const PRODUCTION_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self'",
  "manifest-src 'none'",
];

export const PRODUCTION_CSP = PRODUCTION_DIRECTIVES.join('; ');

/**
 * En développement uniquement : le rechargement à chaud de React injecte un script en ligne
 * et dialogue avec le serveur Vite local par WebSocket.
 */
export function developmentCsp(devServerUrl: string): string {
  const origin = new URL(devServerUrl).origin;
  const ws = origin.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: blob: ${origin}`,
    `font-src 'self' ${origin}`,
    `connect-src 'self' ${origin} ${ws}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
