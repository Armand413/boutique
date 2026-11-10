import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { developmentCsp, PRODUCTION_CSP } from '../../../src/main/security/csp';
import { isTrustedOrigin, loggableUrl, originOf } from '../../../src/main/security/guards';
import { resolveInsideRoot } from '../../../src/main/security/protocol';

vi.mock('electron', () => ({ app: {}, session: {}, protocol: {} }));

describe('CSP de production', () => {
  const directives = new Map(
    PRODUCTION_CSP.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values] as const;
    }),
  );

  it('interdit tout par défaut, et tout script en ligne', () => {
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('n’autorise aucune origine distante', () => {
    expect(PRODUCTION_CSP).not.toMatch(/https?:|wss?:|\*/);
  });

  it('limite la CSP de développement au serveur local', () => {
    const csp = developmentCsp('http://localhost:5173/');
    expect(csp).toContain('ws://localhost:5173');
    expect(csp).not.toContain('https:');
  });
});

describe('origines de confiance', () => {
  const trusted = ['app://renderer'];

  it('accepte uniquement l’origine exacte', () => {
    expect(isTrustedOrigin('app://renderer/index.html', trusted)).toBe(true);
    expect(isTrustedOrigin('app://renderer.evil/index.html', trusted)).toBe(false);
    expect(isTrustedOrigin('https://example.com', trusted)).toBe(false);
    expect(isTrustedOrigin('file:///C:/Windows/win.ini', trusted)).toBe(false);
    expect(isTrustedOrigin('pas une url', trusted)).toBe(false);
    expect(isTrustedOrigin('', trusted)).toBe(false);
  });

  it('reconnaît le serveur de développement local', () => {
    const dev = ['app://renderer', 'http://localhost:5173'];
    expect(isTrustedOrigin('http://localhost:5173/src/main.tsx', dev)).toBe(true);
    expect(isTrustedOrigin('http://localhost:5174/', dev)).toBe(false);
  });

  it('retire paramètres et fragment des URL journalisées', () => {
    expect(loggableUrl('ws://localhost:5173/?token=abc#x')).toBe('ws://localhost:5173/');
    expect(loggableUrl('https://example.com/a/b?session=1')).toBe('https://example.com/a/b');
    expect(loggableUrl('data:text/html,secret')).toBe('data:[contenu masqué]');
    expect(loggableUrl('pas une url')).toBe('[url invalide]');
  });

  it('ne fabrique jamais d’origine sans hôte', () => {
    expect(originOf('app:///index.html')).toBeNull();
    expect(originOf('data:text/html,<p>')).toBeNull();
    expect(originOf('app://renderer/x')).toBe('app://renderer');
  });
});

describe('résolution des fichiers de l’interface', () => {
  const root = join('C:', 'app', 'renderer');

  it('résout un fichier de l’interface', () => {
    expect(resolveInsideRoot(root, '/assets/index.js')).toBe(join(root, 'assets', 'index.js'));
  });

  it('refuse toute sortie du dossier', () => {
    expect(resolveInsideRoot(root, '/../main/index.js')).toBeNull();
    expect(resolveInsideRoot(root, '/%2e%2e/%2e%2e/secret.db')).toBeNull();
    expect(resolveInsideRoot(root, '/..%5c..%5csecret.db')).toBeNull();
    expect(resolveInsideRoot(root, '/index.html%00.js')).toBeNull();
    expect(resolveInsideRoot(root, '/%E0%A4%A')).toBeNull();
    expect(resolveInsideRoot(root, '/')).toBeNull();
  });
});
