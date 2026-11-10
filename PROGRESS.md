# Avancement

## Phase 1 — Squelette Electron + React + TS : terminée (10/11/2026)

### Fait

- Electron 45 + electron-vite 6 (Vite 8), React 18, TypeScript 6 strict, Tailwind 4, Radix, lucide-react, Zustand, Zod.
- Sécurité (B.5) : `contextIsolation`, `sandbox`, `nodeIntegration` désactivé ; protocole `app://renderer` avec en-têtes
  de sécurité et CSP stricte ; réseau sortant, nouvelles fenêtres, navigation externe, webview et permissions refusés ;
  DevTools et menu désactivés en production ; instance unique.
- IPC : canaux listés, entrée et sortie validées par Zod, origine de l'appelant vérifiée, erreurs traduites sans détail
  technique. Preload minimal (`window.api.invoke`).
- Journal technique : fichiers quotidiens, 14 jours gardés, secrets masqués, URL sans paramètres.
- Interface : design system (tokens, thèmes clair/sombre/système, Inter, grille de 8 px), layout (barre latérale,
  en-tête avec fil d'Ariane, palette Ctrl+K, lien d'évitement), états chargement/vide/erreur, notifications.
  Écrans : Paramètres, Apparence (thème, taille du texte, langue), À propos. i18n fr/en.
- Outillage : ESLint (typescript-eslint strict typé, react-hooks, interdiction de Node dans l'interface), Prettier,
  Vitest, Playwright.

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 0 erreur (projets node, web, e2e)                                                                                     |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                                             |
| `npm test`          | 57 tests, tous verts                                                                                                  |
| `npm run test:e2e`  | 10 tests sur l'application compilée, tous verts (sécurité, IPC, persistance, WCAG AA clair/sombre, clavier, F8 libre) |
| Démarrage           | ~1 s jusqu'au premier écran (build), 1,1 s en dev (exigence < 3 s)                                                    |
| `npm run dev`       | démarre, rechargement à chaud actif, aucune requête bloquée                                                           |
| `npm audit`         | 0 en production ; 15 modérées en dev (voir D13), aucune critique                                                      |

### Corrigé pendant la phase

- Erreur de syntaxe dans `protocol.ts` qui cassait le build.
- **Origine `app://` jamais reconnue** : en production, tous les appels IPC étaient refusés (D2).
- `parseMoney` refusait toute saisie à décimales (`\d` perdu dans le gabarit de l'expression régulière).
- F8 intercepté par les notifications Radix (D6) ; WebSocket Vite bloqué en dev (D4).

### Reste à valider / limites

- Sous-agent `security-reviewer` non disponible dans cet environnement : la revue sécurité repose sur les tests
  unitaires et e2e ci-dessus.
- Le chunk JavaScript de l'interface fait ~780 ko (non découpé) : à surveiller en phase 9 (optimisation).

## Phase 2 — Base chiffrée, authentification, rôles, audit : à faire

Prochaine étape : migrations complètes de l'Annexe E (tables STRICT, triggers, vues, FTS5), ouverture SQLCipher avec
clé protégée par DPAPI (`safeStorage`), recompilation du module natif pour Electron, seed système, tests de base ;
puis assistant de premier lancement, authentification Argon2id, PIN vendeur, rôles et journal d'audit chaîné.
