# Projet : gestion de boutique multi-familles (téléphones, accessoires, électronique, électroménager, énergie solaire) - application Windows

## Mission
Construire une application de bureau COMPLÈTE, propre et sécurisée : produits multi-marques et multi-familles, stock, inventaire,
devis, ventes (caisse), clients, fournisseurs, garantie, rapports. Installable par un setup.exe, 100 % hors ligne, sans latence.

## Familles de produits (section 4.12 du cahier des charges)
- Quatre familles de premier niveau : Téléphonie, Électronique et audio (téléviseurs, amplificateurs de musique), Électroménager,
  Énergie solaire (panneaux, régulateurs de charge, batteries, onduleurs). Catégories modifiables par l'administrateur.
- Caractéristiques techniques par catégorie via des ATTRIBUTS configurables (Wc, V, A, Ah, W, pouces...), jamais en dur dans le code.
- Mode de suivi PAR PRODUIT : `none`, `serial` (numéro de série) ou `imei`. Un article suivi ne se vend qu'avec son unité exacte.
- Garantie par produit (de quelques mois à plusieurs années), recherche de garantie par numéro de série, SAV simplifié (réclamations).
- KITS (ex. kit solaire) : produit composé ; à la vente, éclatement en composants avec décrément du stock de chacun, tout ou rien.
- SERVICES (livraison, installation) : lignes sans stock. Pas de planning de chantier ni d'atelier de réparation (hors périmètre).
- DEVIS/proforma convertibles en vente, réservation facultative du stock ; acomptes et ventes à ÉCHÉANCIER ; LIVRAISONS avec statut.
- Stock multi-emplacements (magasin, dépôt) et rapports par famille.

## Source de vérité
`docs/CAHIER_DES_CHARGES.md` : A = interface, B = sécurité, C = décisions techniques, E = base de données.
Ne le charge pas en entier à chaque fois : lis la section utile à la tâche en cours (grep sur « Annexe »).
En cas de conflit entre ce fichier et le cahier des charges, le cahier des charges prévaut.
Interdits : fonctionnalité hors périmètre, TODO, écran factice, donnée de démonstration dans le code de production.

## Stack (figée ; tout changement doit être justifié dans docs/DECISIONS.md)
- Electron + Node.js LTS + TypeScript strict (jamais de `any`)
- React 18, Vite, Tailwind CSS, shadcn/ui (Radix), lucide-react
- Zustand, React Hook Form, Zod, TanStack Table + Virtual, Recharts
- SQLite chiffré : better-sqlite3-multiple-ciphers (SQLCipher), mode WAL, migrations SQL dans `/db/migrations`
- Argon2id, node-thermal-printer (ESC/POS), pdfmake, exceljs, JsBarcode ou bwip-js
- electron-builder (NSIS) et electron-updater
- Tests : Vitest (métier, base de données), Playwright (bout en bout Electron)
- Versions figées. Vérifie qu'une bibliothèque existe et que son API est bien celle que tu utilises avant de l'employer
  (lis sa documentation ou ses types dans node_modules, ne devine pas).
- Les modules natifs doivent être recompilés pour Electron (`electron-builder install-app-deps`).

## Architecture
- `/src/main` : services métier, dépôts de données, IPC, sécurité, impression, sauvegardes
- `/src/preload` : unique pont `contextBridge`, API typée et minimale
- `/src/renderer` : interface uniquement ; aucun accès à Node, au disque ni à la base
- `/src/shared` : types, schémas Zod, droits des rôles, constantes
- `/db/migrations`, `/docs`, `/tests`
- Chaîne obligatoire : UI -> IPC validé (Zod) -> services métier -> dépôts -> SQLite
- Toute modification de stock passe par UNE fonction de mouvement de stock, dans une transaction
- Une vente = panier + paiements + mouvements de stock en une seule transaction (tout ou rien)
- Montants en entiers (plus petite unité de la devise). Devise configurable, par défaut FCFA sans décimales
- Aucun appel réseau dans le parcours de vente. Interface en français (i18n prête pour l'anglais)

## Base de données (détail : Annexe E)
- Tables `STRICT`. À chaque ouverture : `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`
- snake_case, tables au pluriel, `id INTEGER PRIMARY KEY`, dates ISO 8601 UTC, booléens 0/1 avec CHECK, énumérations avec CHECK
- Aucun DELETE sur les données métier (archivage logique). Clés étrangères en `ON DELETE RESTRICT`
- Les règles d'intégrité vivent DANS la base (CHECK, UNIQUE, clés étrangères, triggers), pas seulement dans le code :
  - `stock_levels` mis à jour uniquement par trigger depuis `stock_movements`, jamais négatif
  - `stock_movements`, `payments`, `audit_log` immuables (UPDATE et DELETE refusés)
  - ventes terminées ou annulées non modifiables ; un IMEI ne se vend qu'une fois ; retour <= quantité vendue
  - `audit_log` chaîné par SHA-256, avec fonction de vérification de la chaîne
- Soldes clients et fournisseurs : vues, jamais stockés. Prix, coût et taxe figés dans les lignes de vente
- Familles : `products.product_type` (phone, accessory, electronics, appliance, solar, part, service, kit), `tracking_mode`
  (none, serial, imei), `is_stocked` ; `phone` impose `imei` ; `service` et `kit` n'ont pas de stock propre
- `serial_units.serial_number` (unique, IMEI 1 pour un téléphone), `imei2` facultatif, `warranty_end` ; Luhn seulement en mode `imei`
- Attributs : `attribute_definitions` (par catégorie, héritage aux sous-catégories) et `product_attribute_values` (indexés pour filtrer)
- Kits : `kit_components` ; vente = lignes de composants (`sale_lines.parent_line_id`, `line_type`), seuls les composants font des
  mouvements de stock ; un kit ne contient pas de kit
- Devis : `quotes`, `quote_lines` ; échéances : `sale_installments` ; livraisons : `deliveries` ; garantie : `warranty_claims`
- Vues supplémentaires : `v_sales_by_family`, `v_overdue_installments`, `v_open_quotes`, `v_warranty_expiring`, `v_stock_by_location`
- Index de E.5 et table FTS5 `products_fts`. Numérotation des factures sans trou (`invoice_sequences`)
- Migrations numérotées et IMMUABLES : ne jamais modifier une migration appliquée, en créer une nouvelle
- Sauvegarde automatique avant chaque migration ; `PRAGMA integrity_check` au démarrage

## Sécurité (non négociable, détail : Annexe B)
- Electron : `contextIsolation` ON, `nodeIntegration` OFF, `sandbox` ON, CSP stricte, aucun contenu distant,
  navigation externe et nouvelles fenêtres bloquées, DevTools désactivés en production
- Canaux IPC listés ; chaque entrée validée par Zod ; permissions vérifiées dans les services (pas seulement dans l'UI)
- SQL toujours paramétré ; données affichées échappées
- Base chiffrée, clé protégée par DPAPI (`safeStorage`), jamais en clair, jamais dans les logs
- Argon2id, limitation des tentatives, PIN vendeur, verrouillage après inactivité
- Prix d'achat et marges invisibles aux vendeurs, y compris dans les exports et les vues
- Ne jamais désactiver une règle de sécurité, un test ou un contrôle pour « faire passer »

## Interface (détail : Annexe A)
- Un seul design system : couleur principale + couleurs sémantiques (vert succès, orange alerte, rouge erreur, bleu info),
  police Inter, grille de 8 px, thèmes clair et sombre, animations < 200 ms
- Chaque écran gère les états chargement (squelettes), vide (avec action proposée) et erreur (avec solution)
- Confirmation pour toute action destructrice ; messages d'erreur clairs en français
- Caisse : entièrement au clavier et au scanner, raccourcis F2 (nouvelle vente), F4 (encaisser), F8 (attente), Échap (annuler)
- Écrans en plus : Devis, Fiche produit technique (attributs, composition d'un kit, numéros de série), Échéancier clients,
  Livraisons, Garantie et SAV
- WCAG AA, navigation clavier complète, adaptation dès 1366x768

## Performance
Démarrage < 3 s ; recherche produit < 100 ms avec 50 000 produits ; ajout au panier < 50 ms ; validation d'une vente < 500 ms.
Listes virtualisées, pagination et recherche côté base, rapports lourds hors du thread de l'interface.

## Commandes
`npm run dev` | `build` | `typecheck` | `lint` | `test` | `test:e2e` | `seed` | `dist`

## Méthode de travail
- Une phase à la fois. Avant d'écrire du code : plan court (fichiers, dépendances, critères de validation).
- Teste ce que tu écris : lance les tests et l'application, ne suppose jamais qu'un code fonctionne sans l'avoir exécuté.
- Fin de phase : `typecheck`, `lint`, tests unitaires et e2e verts, application démarrable, `npm audit` sans faille
  critique, commit (Conventional Commits), mise à jour de `PROGRESS.md` (fait, reste, décisions), résumé, puis arrêt.
- Commits fréquents et atomiques pendant la phase, jamais de gros commit final unique.
- Ambiguïté mineure : choisis l'option la plus sûre et la plus simple, note-la dans `docs/DECISIONS.md`, continue.
- Interromps-moi uniquement pour une décision qui change le schéma de données, la sécurité, la stack ou le périmètre.
- Aucune dépendance hors liste sans justification dans `docs/DECISIONS.md`. Aucun secret dans le dépôt.
- Fonctions courtes, erreurs explicites, aucune exception silencieuse, noms clairs.

## Plan de réalisation
1. Squelette Electron + React + TS, lint/format, design system, thèmes, layout, navigation
2. Base chiffrée : migrations complètes de l'Annexe E, triggers, vues, seed système, tests de base ;
   puis assistant de premier lancement, authentification, rôles, journal d'audit
3. Familles, catégories, attributs techniques, produits, variantes, IMEI et numéros de série, kits, import/export, étiquettes
4. Stock multi-emplacements (mouvements, entrées/sorties, transferts, alertes, valorisation) et fournisseurs
5. Caisse, paiements, crédits et échéanciers, devis, kits et services à la vente, livraisons, clients, tickets, factures, clôture de caisse
6. Inventaire, puis garantie et SAV simplifié (réclamations par numéro de série)
7. Tableau de bord, rapports par famille, exports
8. Sauvegarde/restauration, paramètres, anti-fraude
9. Durcissement sécurité, optimisation, tests de bout en bout, seed de démonstration (20 marques, 2 000 produits,
   5 000 ventes), test de charge (50 000 produits, 100 000 ventes, 500 000 mouvements)
10. Packaging (setup.exe NSIS, désinstallation propre, signature configurable) et documentation :
    GUIDE_UTILISATEUR.md, GUIDE_TECHNIQUE.md, BASE_DE_DONNEES.md (diagramme Mermaid), rapport final exigence par exigence

## Définition de « terminé » pour une phase
Fonctionnalités du cahier des charges de la phase livrées ; tests unitaires et e2e verts ; aucune erreur `typecheck`/`lint` ;
sécurité vérifiée (sous-agent `security-reviewer` si disponible) ; application démarrable ; `PROGRESS.md` à jour.

## Limites connues (à signaler, ne pas simuler)
Tu ne peux pas tester l'imprimante thermique, le lecteur de codes-barres ni la signature de code avec un vrai certificat :
implémente-les derrière des interfaces testables (simulateur d'imprimante, saisie clavier) et note dans `PROGRESS.md`
ce qui reste à valider sur le matériel réel.
