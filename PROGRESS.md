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

## Phase 3 — Catalogue : terminée (11/11/2026)

### Fait

- **Référentiels** : familles et catégories sur trois niveaux, marques, caractéristiques techniques par catégorie
  (texte, nombre, liste de choix, oui/non ; unité, obligatoire, filtrable) héritées par les sous-catégories.
  Modification réservée à l'administrateur (D34), consultation pour tous les rôles du catalogue.
- **Produits** : ajout rapide et modification (type, suivi, garantie, taxe, seuil, poids, description, caractéristiques
  contrôlées par type et obligation), archivage et restauration avec confirmation, photo (PNG/JPEG/WebP vérifiés).
  Variantes (couleur, stockage, RAM, état, codes, prix, prix minimum) ; référence générée si vide (D37).
  Téléphone toujours en IMEI ; services et kits sans stock ; type figé dès le premier mouvement.
- **Kits** : composition (recherche des composants, quantités), somme des composants comparée au prix du kit ; ni kit
  dans un kit, ni changement de type d'un kit composé ou d'un composant.
- **Droits** : contrôlés dans les services ; prix d'achat et coût moyen retirés des réponses, de la recherche et des
  exports sans `cost.view` ; changement de prix soumis à `price.edit` et journalisé (ancien / nouveau).
- **Recherche** : plein texte sans accents par préfixes, code-barres ou référence exacts en tête (lecteur), filtres par
  famille (descendance comprise), marque, état, stock bas et caractéristiques (min / max / valeur), tri, pagination
  côté base. Tableau virtualisé (TanStack Table + Virtual) chargé par pages de 100.
- **Ctrl+K** : produits et appareils (IMEI 1, IMEI 2 ou numéro de série exact) en plus des écrans.
- **Import / export** Excel et CSV : mêmes colonnes, analyse avant confirmation, tout ou rien, erreurs par ligne (D36).
- **Étiquettes** : PDF Code 128, planche A4 ou rouleau, par variante ou par unité suivie (D39).
- **Écrans** : Produits, Fiche produit technique, Catégories et caractéristiques, Marques, dialogues (produit, variante,
  kit, étiquettes, import). États chargement / vide / erreur, textes fr/en.
- Journal d'audit : chaque création, modification, archivage, import, export et génération d'étiquettes.

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 0 erreur                                                                                          |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                         |
| `npm test`          | 191 tests verts (45 pour le catalogue, dont la recherche sur 50 000 produits < 100 ms)            |
| `npm run test:e2e`  | 24 tests verts sur l'application compilée (+ 1 capture ignorée hors demande)                      |
| WCAG AA             | axe-core clair et sombre : Produits (vide et rempli), fiche, catégories, marques, formulaire, kit |
| `npm audit`         | 0 en production (uuid forcé, D33) ; 15 modérées en dev (D13), aucune critique                     |

### Corrigé pendant la phase

- Recherche plein texte réévaluée pour chaque variante : 116 s sur 50 000 produits, ramenée à quelques ms (D42).
- Première page sans filtre au-delà de 100 ms (tri de lignes complètes) : tri des seuls identifiants.
- Formulaire produit bloqué après une première erreur sur une caractéristique obligatoire.
- Liste de définitions de la fiche et zone de recherche non conformes WCAG (trouvé par axe-core).

### Reste à valider / limites

- Impression réelle des étiquettes (imprimante d'étiquettes et lecteur de codes-barres) : à valider sur le matériel.
- Saisie des IMEI et numéros de série : avec les réceptions de marchandise, phase 4 (D35).
- Le chunk JavaScript de l'interface atteint ~1,4 Mo : découpage prévu en phase 9.
- Sous-agent `security-reviewer` indisponible : revue faite à la main et par les tests (droits par rôle et par PIN,
  masquage des coûts, refus d'un appel IPC direct par un vendeur, fichiers choisis uniquement par le processus principal).

## Phase 4 — Stock multi-emplacements et fournisseurs : terminée (11/11/2026)

### Fait

- **Schéma** : migration 0007 (D43), accord du client : états « rendu au fournisseur » et « sorti du stock » des unités
  suivies ; table `serial_units` recréée sans couper les clés étrangères, testée sur une base existante.
- **Mouvement de stock unique** (`applyMovement`, D44) : seul point d'écriture, dans la transaction de l'opération ;
  coût moyen pondéré et dernier prix d'achat recalculés à chaque achat.
- **Entrées de marchandise** : bon `BR-AAAA-NNNNN`, lignes, prix d'achat, IMEI / numéros de série (un par article,
  IMEI 2 facultatif), paiement immédiat facultatif ; tout ou rien (D45).
- **Sorties** (perte, casse, vol, usage interne) et **ajustements** avec motif obligatoire ; un appareil suivi sort à
  l'unité et peut être réintégré s'il est retrouvé. **Transferts** entre emplacements (sortie et entrée liées),
  **retours fournisseur**.
- **Emplacements** (magasin, dépôt…) : un par défaut, désactivation refusée tant qu'il reste du stock.
- **Consultation** : état par variante et par emplacement (recherche, famille, emplacement, stock bas, pagination côté
  base), historique des mouvements (date, article, numéro, quantité, stock après, coût, motif, document, utilisateur),
  valorisation au coût moyen et au prix de vente, par emplacement et par famille.
- **Fournisseurs** : fiche, historique des entrées (détail du bon et des numéros), paiements, reste dû (vue
  `v_supplier_balances`) ; paiement plafonné au solde (D48).
- **Alertes de stock bas** : indicateur permanent dans l'en-tête et notification à l'ouverture de session (D50).
- **Droits** (D47) contrôlés dans les services ; coûts masqués sans `cost.view` (état, historique, valorisation).
- Écrans : Stock (3 onglets), Entrée de marchandise (au scanner), Emplacements, Fournisseurs, Fiche fournisseur ;
  dialogue commun sortie / transfert / retour. Textes fr/en.

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` | 0 erreur                                                                                                                                   |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                                                                  |
| `npm test`          | 208 tests verts (dont 13 pour le stock et 2 pour la migration 0007)                                                                        |
| `npm run test:e2e`  | 26 tests verts sur l’application compilée (+ 1 capture ignorée hors demande)                                                               |
| WCAG AA             | axe-core clair et sombre : Stock (vide, état, mouvements, valorisation), emplacements, entrée de marchandise, fiche fournisseur, transfert |
| `npm audit`         | 0 en production ; 15 modérées en dev (D13), aucune critique                                                                                |

### Corrigé pendant la phase

- Un accessoire de la famille Téléphonie héritait du suivi IMEI : la réception exigeait des IMEI pour des câbles (D49).
- Indicateur d'alertes non rafraîchi après une opération sur le même écran.
- Tableaux défilants inaccessibles au clavier (WCAG `scrollable-region-focusable`).
- Test de migration figé sur 6 migrations.

### Reste à valider / limites

- Lecteur de codes-barres réel sur l'écran d'entrée (testé par saisie clavier + Entrée).
- Avoirs fournisseurs non gérés : un retour ne réduit pas le solde (D48).
- Ventes, retours clients et inventaire créeront leurs mouvements par `applyMovement` (phases 5 et 6).

## Phase 5 — Caisse, ventes, clients, devis, échéances, livraisons : terminée (11/11/2026)

### Fait

- **Décisions du client** : prix TTC (D51), plafonds de remise 10 % / 30 % / libre (D52), annulation seulement pendant
  la session de caisse (D53). Migration 0008 qui porte ces deux dernières règles dans la base.
- **Vente en une transaction** (D54) : kits éclatés en composants, services sans stock, une ligne par unité suivie avec
  fin de garantie, remise par ligne et globale répartie, plafonds par rôle et prix minimum, paiements mixtes, crédit
  avec échéances et plafond client, livraison, facture sans trou, conversion de devis. Validation < 500 ms (test).
- **Caisse** au clavier et au scanner : F2, F4, F8, Échap, signal sonore ; recherche par nom, code-barres, référence,
  IMEI ou numéro de série ; choix des unités au scanner ; client trouvé ou créé à la volée ; monnaie à rendre ;
  paniers en attente (D56) ; ouverture avec fond, entrées et sorties d'espèces avec motif, clôture avec totaux par
  moyen de paiement et écart.
- **Documents** : ticket ESC/POS 58/80 mm (imprimante réseau ou simulateur, D55) et PDF ; facture A4 avec TVA comprise,
  bon de garantie, bon de livraison, devis.
- **Ventes** : historique filtré, détail (numéros, garanties, paiements, échéances, retours, marge avec `cost.view`),
  réimpression, retour article par article (remise en stock ou rebut, remboursement ou avoir, D58), annulation.
- **Clients** : fiche, historique, dette, remboursement imputé aux ventes et échéances les plus anciennes.
- **Devis** : création, envoi, acceptation, réservation des unités, expiration automatique, PDF, conversion (D57).
- **Échéancier** (en retard, à venir, toutes) et **Livraisons** (à livrer, livrées, annulées).
- Droits contrôlés dans les services ; journal d'audit de chaque vente, annulation, retour, paiement et mouvement
  d'espèces.

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 0 erreur                                                                                        |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                       |
| `npm test`          | 229 tests verts (21 pour les ventes et les documents)                                           |
| `npm run test:e2e`  | 29 tests verts sur l’application compilée (+ 1 capture ignorée hors demande)                    |
| WCAG AA             | axe-core clair et sombre : caisse (vide, panier), encaissement, clôture, détail de vente, devis |
| `npm audit`         | 0 en production ; 15 modérées en dev (D13), aucune critique                                     |

### Corrigé pendant la phase

- Le gérant contournait son plafond de remise par sa permission de dérogation (D52).
- Une unité vendue doit recevoir état, ligne de vente et date en une seule écriture (contrainte de la base).
- Le choix du client depuis l'encaissement effaçait les montants saisis.
- Contrôles d'accessibilité instables pendant les transitions de couleurs (D59).
- Tests e2e fragiles sous charge : assistant d'installation rempli avant d'être prêt, notification déjà disparue.

### Reste à valider / limites

- Imprimante thermique réelle (ESC/POS) et tiroir-caisse : simulateur seulement (D55) ; adresse de l'imprimante et
  plafonds de remise à régler dans les Paramètres (phase 8).
- Lecteur de codes-barres réel : testé par saisie clavier + Entrée.
- Une annulation n'efface pas les paiements par carte ou mobile money déjà comptés dans la session : le remboursement de
  ces moyens se fait hors caisse (seules les espèces sortent du tiroir).

## Phase 6 — Inventaire, garantie et SAV : terminée (11/11/2026)

### Fait

- Migration 0009 : appareils scannés pendant un inventaire (`inventory_unit_scans`), règles portées par triggers (D60).
- Inventaire (`src/main/inventory`) : périmètre complet, par marque ou par famille/catégorie, un emplacement par session,
  quantités attendues figées ; comptage au scanner (numéro de série d'abord, puis code-barres ou référence) ou à la main ;
  mise à zéro explicite des non-comptés ; fin de comptage, reprise, revue des écarts (quantité et valeur au coût moyen
  pour qui a `cost.view`) ; validation en une transaction : mouvements `inventory`, appareils manquants sortis du stock,
  appareils retrouvés remis en stock ; double contrôle paramétrable ; annulation sans ajustement (D61).
- Rapport d'inventaire PDF et Excel (écarts, valeur, signataires).
- Garantie et SAV (`src/main/warranty`) : recherche par numéro de série ou IMEI (vente, facture, client, fin de garantie,
  jours restants, historique), ouverture de réclamation (alerte hors garantie), étapes jusqu'à la clôture avec solution,
  fournisseur associé, liste des réclamations en cours, garanties qui expirent sous 30 jours (D62).
- Écrans : Inventaires (historique, création), assistant d'inventaire en étapes (scan, comptage, écarts, validation,
  rapports) et Garantie et SAV (recherche, réclamations en cours, garanties qui expirent).
- 17 canaux IPC validés par Zod, droits vérifiés dans les services (`inventory.manage`, `inventory.validate`,
  `warranty.manage`).

### Vérifications de fin de phase

| Contrôle            | Résultat                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | 0 erreur                                                                                                                                                 |
| `npm run lint`      | 0 erreur, 0 avertissement                                                                                                                                |
| `npm test`          | 237 tests verts (8 pour l’inventaire et la garantie)                                                                                                     |
| `npm run test:e2e`  | 31 tests verts sur l’application compilée (+ 1 capture ignorée hors demande)                                                                             |
| WCAG AA             | axe-core clair et sombre : inventaires (vide, historique), nouvel inventaire, comptage, écarts, garantie (recherche, réclamation, en cours, expirations) |
| `npm audit`         | 0 faille en production, aucune critique                                                                                                                  |

### Corrigé pendant la phase

- La mise à jour d'une réclamation effaçait son fournisseur (identifiant absent du schéma renvoyé).
- Le champ de quantité ne suivait pas les scans d'un article non suivi.
- Bouton vert de validation sous le contraste AA en taille normale (D63).

### Reste à valider / limites

- Lecteur de codes-barres réel : testé par saisie clavier + Entrée.
- Le double contrôle de l'inventaire se règle dans les Paramètres (phase 8) ; désactivé par défaut.

## Phase 7 — Tableau de bord, rapports par famille, exports : à faire

Tableau de bord, rapports (ventes par famille, marges, stock, crédits, garanties), exports PDF et Excel.
