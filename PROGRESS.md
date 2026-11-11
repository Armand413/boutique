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

## Phase 2 — Base chiffrée, authentification, rôles, audit : terminée (11/11/2026)

### Fait

- **Base** : 6 migrations (`db/migrations`, générées depuis `db/templates` par `scripts/build-migrations.mjs`) couvrant
  toute l'Annexe E : 39 tables `STRICT`, 92 triggers, 57 index explicites, `products_fts` (FTS5), 14 vues. Règles portées par la base :
  stock tenu par trigger, jamais négatif, sans écriture directe ; mouvements, paiements, retours et audit immuables ;
  aucune suppression des données métier ; IMEI (Luhn) et numéros uniques ; cycle de vie des unités ; ventes figées après
  validation avec contrôle des totaux, paiements, unités suivies et plafond de crédit ; retours limités ; factures sans
  trou ; kits sans imbrication ; attributs typés et hérités ; catégories sur trois niveaux ; dernier administrateur protégé.
- **Chiffrement** : SQLCipher v4 (AES-256), clé brute de 256 bits protégée par DPAPI (`safeStorage`) et séquestrée sous la
  clé de récupération (AES-256-GCM, Argon2id). Réglages imposés à chaque ouverture, `integrity_check` au démarrage,
  `optimize` à la fermeture, copie chiffrée avant toute migration (enregistrée dans `backup_log`), empreintes des migrations
  vérifiées. Le module natif (N-API) fonctionne tel quel sous Electron : aucune recompilation nécessaire.
- **Seed système** idempotent : rôles et permissions repris de `src/shared/permissions.ts`, quatre familles, taxes
  (Exonéré, TVA 18 %), emplacement « Magasin », paramètres par défaut.
- **Audit** : journal chaîné SHA-256 ; la fonction d'empreinte n'existe que sur la connexion de l'application (écriture
  impossible depuis un autre outil) ; vérification au démarrage (alerte) et à la demande.
- **Authentification** : Argon2id (64 Mio, 3 passes), règles de mot de passe (longueur, liste embarquée de mots de passe
  courants, identifiant interdit), délai croissant puis blocage, message identique pour identifiant inconnu et mauvais
  secret, PIN de caisse limité aux droits de caisse, session tenue par le processus principal et verrouillée après
  inactivité, mot de passe provisoire à changer, récupération du compte administrateur par clé (renouvelée après usage).
- **IPC** : chaque canal déclare son accès (public, session, permission) ; contrôle dans le dispatcher **et** dans les
  services ; violations de règles de la base traduites en messages lisibles.
- **Écrans** : assistant de premier lancement, clé de récupération (affichage unique), base verrouillée, connexion
  (mot de passe ou PIN), récupération administrateur, changement imposé, verrouillage (Ctrl+L), Utilisateurs, Journal
  d'audit, Mon compte (mot de passe, PIN). Menus et écrans filtrés par les permissions. Textes fr/en.

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 0 erreur                                                                                      |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                     |
| `npm test`          | 146 tests verts (dont 54 sur la base : chaque contrainte de l'E.8, chiffrement, audit altéré) |
| `npm run test:e2e`  | 21 tests verts sur l'application compilée (+ 1 capture d'écran ignorée hors demande)          |
| WCAG AA             | axe-core, clair et sombre : assistant, clé, connexion, récupération, verrouillage, 5 écrans   |
| Démarrage           | fenêtre à ~0,6 s, écran de connexion en < 3 s (test e2e) ; migrations initiales en 80 ms      |
| `npm audit`         | 0 en production ; 15 modérées en dev (D13), aucune critique                                   |

### Corrigé pendant la phase

- Trigger d'attributs inopérant (`x NOT IN (…, NULL)` jamais vrai) : un attribut d'une autre catégorie était accepté.
- Fonction SQL d'audit enregistrée avec une arité nulle (paramètres `...args`).
- Connexion à la base laissée ouverte quand le démarrage échouait après l'ouverture.
- Course possible entre deux installations ou deux récupérations simultanées (séquestre écrasé par une clé jamais vue).

### Reste à valider / limites

- DPAPI testé sur ce poste uniquement (e2e réel) ; à valider sur le poste du client, y compris après changement de mot de
  passe Windows.
- Le séquestre `boutique.key.recovery` devra être inclus dans les sauvegardes (phase 8).
- La suppression des **dernières** lignes du journal d'audit n'est pas détectable par la seule chaîne (D19) : ancrage
  prévu avec les sauvegardes (phase 8).
- Sous-agent `security-reviewer` indisponible : revue sécurité faite à la main (voir corrections ci-dessus) et par les
  tests ; plafonds de remise par rôle (phase 5) et alertes anti-fraude (phase 8) restent à faire.
- Réglage du délai de verrouillage dans l'interface : phase 8 (paramètres) ; valeur par défaut 5 min.

## Phase 3 — Catalogue : à faire

Familles, catégories, attributs techniques, produits, variantes, IMEI et numéros de série, kits, import/export, étiquettes.
