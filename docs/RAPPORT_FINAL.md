# Rapport final — exigence par exigence

Bilan de la réalisation face au cahier des charges (`docs/CAHIER_DES_CHARGES.md`), au 12/11/2026, version 0.1.0.
Chaque ligne renvoie à ce qui la prouve : test automatisé, mesure ou décision (D…, dans [DECISIONS.md](DECISIONS.md)).

**Légende** : **Livré** — fait et vérifié par des tests ; **Partiel** — fait en partie, l'écart est expliqué ;
**À valider** — fait derrière une interface testable, à confirmer sur le matériel ou avec le client ;
**Non livré** — hors de la version livrée, avec la raison.

## Synthèse

| Domaine                                       | Livré | Partiel | À valider | Non livré |
| --------------------------------------------- | ----- | ------- | --------- | --------- |
| Objectifs mesurables (1.3)                    | 4     | 0       | 1         | 0         |
| Rôles (section 3)                             | 4     | 0       | 0         | 0         |
| Exigences fonctionnelles (4.1 à 4.12)         | 75    | 1       | 1         | 1         |
| Exigences non fonctionnelles (5.1 à 5.6)      | 16    | 0       | 3         | 0         |
| Interface (Annexe A)                          | 15    | 0       | 2         | 0         |
| Sécurité (Annexe B)                           | 23    | 0       | 2         | 1         |
| Base de données (Annexe E)                    | 12    | 0       | 0         | 0         |
| Déploiement et livrables (sections 9, 11, 12) | 13    | 0       | 1         | 1         |

Une ligne « Livré / À valider » compte comme « À valider » : le logiciel est fait, la vérification sur le matériel
ou sur le poste du client reste à faire.

Vérifications finales : typecheck et lint sans erreur ; 273 tests unitaires ; 39 tests de bout en bout sur
l'application compilée, plus le test de l'application **installée** par le setup.exe (`npm run test:packaged`) ; test
de charge vert sur 50 000 produits, 98 746 ventes et 522 361 mouvements ; `npm audit` sans faille en production.

## 1. Objectifs mesurables (1.3)

| Objectif                               | Statut    | Preuve                                                                                                                                    |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche produit < 100 ms             | Livré     | 10,8 ms au pire sur 50 000 produits (test de charge) ; test unitaire < 100 ms                                                             |
| 100 % hors ligne                       | Livré     | aucun appel réseau : réseau sortant bloqué par l'application (test e2e `shell`)                                                           |
| Écart de stock réduit après inventaire | Livré     | ajustements générés à la validation, rapport d'écarts (tests `inventory`)                                                                 |
| Installation < 5 min sans compétence   | À valider | assistant en quelques clics, par utilisateur, sans droit d'administrateur ; installation silencieuse testée ; à chronométrer à la recette |
| Chaque téléphone retrouvable par IMEI  | Livré     | recherche Ctrl+K, caisse, garantie (IMEI 1 et 2) ; tests `catalog`, `warranty`                                                            |

## 2. Rôles (section 3)

| Exigence                                                                         | Statut | Preuve                                                                |
| -------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Administrateur : accès total                                                     | Livré  | `ROLE_PERMISSIONS.admin` = toutes les permissions                     |
| Gérant : produits, stock, inventaires, rapports, sans utilisateurs ni paramètres | Livré  | refus testé canal par canal (`tests/unit/security/intrusion.test.ts`) |
| Vendeur : caisse, stock en lecture, encaissement ; ni prix d'achat ni bénéfice   | Livré  | aucun champ de coût ou de marge dans ses réponses (test d'intrusion)  |
| Actions sensibles tracées (utilisateur, date, heure)                             | Livré  | journal d'audit chaîné ; prix, annulations, ajustements, exports      |

## 3. Exigences fonctionnelles (section 4)

### 4.1 Produits

| Exigence                                                                                                                                                     | Statut | Preuve / remarque                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| Création, modification, archivage sans suppression                                                                                                           | Livré  | archivage et restauration ; trigger `no_delete`                  |
| Tous les champs listés (nom, marque, modèle, catégorie, sous-catégorie, description, code-barres, SKU, prix d'achat et de vente, taxe, seuil, photo, statut) | Livré  | fiche produit et variante ; photo PNG/JPEG/WebP vérifiée         |
| Quatre familles, pièces et services, catégories modifiables par l'administrateur                                                                             | Livré  | seed système ; écran Catégories et caractéristiques (D34)        |
| Marques modifiables                                                                                                                                          | Livré  | écran Marques                                                    |
| Variantes (couleur, stockage, RAM, état), stock et prix propres                                                                                              | Livré  | `product_variants`, `stock_levels` par variante                  |
| Étiquettes avec code-barres                                                                                                                                  | Livré  | PDF Code 128, A4 ou rouleau (D39) ; impression réelle : voir 5.5 |
| Import Excel/CSV et export du catalogue                                                                                                                      | Livré  | analyse avant confirmation, tout ou rien (D36) ; e2e `catalog`   |

### 4.2 IMEI et numéros de série

| Exigence                                                                                              | Statut | Preuve                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Un ou deux IMEI par téléphone, numéro de série pour les articles de valeur, mode de suivi par produit | Livré  | `tracking_mode`, `serial_units`, `imei2`                                 |
| Unicité IMEI et numéro de série                                                                       | Livré  | index uniques, contrôle croisé IMEI 1 / IMEI 2, Luhn (tests `db/schema`) |
| Recherche d'un appareil (stock, vente, client, date)                                                  | Livré  | Garantie et SAV, Ctrl+K                                                  |
| Liaison à la vente                                                                                    | Livré  | `serial_units.sale_line_id`, une ligne par unité                         |
| Garantie restante sur la fiche de vente, durée par produit                                            | Livré  | `warranty_end` figée à la vente ; détail de la vente, bon de garantie    |

### 4.3 Stock

| Exigence                                                                  | Statut  | Preuve / remarque                                                               |
| ------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| Entrées fournisseur avec bon, quantités, prix, date                       | Livré   | bons `BR-AAAA-NNNNN` (D45)                                                      |
| Sorties : ventes, retours fournisseur, pertes, casse, vols, usage interne | Livré   | motif obligatoire (contrainte de la base)                                       |
| Retours clients : réintégration ou rebut, avec motif                      | Livré   | retour article par article (D58)                                                |
| Transferts entre emplacements                                             | Livré   | sortie et entrée liées                                                          |
| Historique complet des mouvements                                         | Livré   | onglet Mouvements, rapport `movements`                                          |
| Alertes de stock bas au démarrage et au tableau de bord                   | Livré   | notification à la connexion, indicateur permanent, tuile (D50)                  |
| Valorisation au prix d'achat et au prix de vente                          | Livré   | onglet Valorisation, rapport `stock`                                            |
| Coût moyen pondéré à chaque entrée                                        | Livré   | `applyMovement` (D44), tests `stock`                                            |
| Avoirs fournisseurs                                                       | Partiel | un retour fournisseur ne réduit pas le solde dû (D48) : à saisir comme paiement |

### 4.4 Inventaire

| Exigence                                             | Statut | Preuve                                             |
| ---------------------------------------------------- | ------ | -------------------------------------------------- |
| Session complète ou partielle (marque, catégorie)    | Livré  | D61                                                |
| Comptage manuel ou au scanner                        | Livré  | e2e `inventory` (scanner simulé par le clavier)    |
| Écarts théorique / compté                            | Livré  | écran Écarts                                       |
| Validation par gérant ou administrateur, ajustements | Livré  | `inventory.validate`, double contrôle paramétrable |
| Historique (date, responsable, écarts, valeur)       | Livré  | liste des inventaires                              |
| Rapport PDF et Excel                                 | Livré  | `inventory-report.ts`                              |

### 4.5 Caisse

| Exigence                                                            | Statut            | Preuve / remarque                                                                   |
| ------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Recherche par nom, code-barres, IMEI, numéro ; ajout en un scan     | Livré             | Entrée ajoute le premier résultat ; e2e `sales`                                     |
| Quantités, suppression, remises ligne et globale, plafonds par rôle | Livré             | 10 % / 30 % / libre (D52), portés par la base                                       |
| Espèces, carte, Mobile Money, virement, chèque, paiement mixte      | Livré             | dialogue d'encaissement                                                             |
| Paiement partiel et vente à crédit                                  | Livré             | échéances, plafond de crédit client                                                 |
| Total, monnaie à rendre, marge                                      | Livré             | marge visible seulement avec `cost.view`                                            |
| Ticket 58/80 mm, facture A4, bon de garantie                        | Livré / À valider | PDF livrés ; ticket ESC/POS testé sur simulateur (D55), imprimante réelle à valider |
| Mise en attente et reprise                                          | Livré             | F8, paniers en attente (D56)                                                        |
| Annulation et retour avec motif, par rôle, tracés                   | Livré             | annulation limitée à la session de caisse (D53)                                     |
| Clôture de caisse : totaux par moyen, compté, écart                 | Livré             | `v_cash_session_summary`, e2e `sales`                                               |

### 4.6 Clients

| Exigence                                            | Statut | Preuve                                      |
| --------------------------------------------------- | ------ | ------------------------------------------- |
| Fiche (nom, téléphone, adresse), historique, soldes | Livré  | `v_customer_balances`                       |
| Dettes et remboursements                            | Livré  | imputation aux échéances les plus anciennes |
| Recherche depuis la caisse, création à la volée     | Livré  | e2e `sales`                                 |

### 4.7 Fournisseurs

| Exigence                             | Statut    | Preuve / remarque                                               |
| ------------------------------------ | --------- | --------------------------------------------------------------- |
| Fiche, contacts, historique, dettes  | Livré     | `v_supplier_balances`                                           |
| Bons de réception                    | Livré     | entrées de marchandise                                          |
| Bons de commande                     | Non livré | « optionnel en version 1 » dans le cahier ; non demandé ensuite |
| Paiements aux fournisseurs et soldes | Livré     | paiement plafonné au solde (D48)                                |

### 4.8 Tableau de bord et rapports

| Exigence                                                        | Statut | Preuve                                                                     |
| --------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| Ventes du jour, semaine, mois ; bénéfice ; alertes ; mouvements | Livré  | tableau de bord (D80)                                                      |
| Ventes par période, vendeur, marque, catégorie                  | Livré  | rapport `sales` (jour, mois, vendeur, famille, catégorie, marque, produit) |
| Bénéfices et marges                                             | Livré  | HT, nets des retours (D64)                                                 |
| Plus et moins vendus (rotation)                                 | Livré  | rapport `products`, couverture en jours                                    |
| Valorisation du stock                                           | Livré  | rapport `stock`                                                            |
| Créances clients et dettes fournisseurs                         | Livré  | rapport `balances`                                                         |
| Journal des mouvements                                          | Livré  | rapport `movements`                                                        |
| Rapports de caisse                                              | Livré  | rapport `cash`                                                             |
| Export PDF, Excel, CSV                                          | Livré  | tracé dans l'audit                                                         |
| Graphiques simples                                              | Livré  | Recharts, avec résumé textuel accessible (D68)                             |

### 4.9 Utilisateurs et sécurité

| Exigence                                    | Statut | Preuve                                 |
| ------------------------------------------- | ------ | -------------------------------------- |
| Identifiant et mot de passe haché           | Livré  | Argon2id (D16)                         |
| Utilisateurs, rôles, permissions            | Livré  | écran Utilisateurs                     |
| Journal d'audit                             | Livré  | écran Journal d'audit, chaîne vérifiée |
| Verrouillage après inactivité, paramétrable | Livré  | Paramètres › Sécurité ; e2e `auth`     |

### 4.10 Sauvegarde et restauration

| Exigence                                          | Statut | Preuve                                             |
| ------------------------------------------------- | ------ | -------------------------------------------------- |
| Sauvegarde automatique quotidienne, N copies      | Livré  | 7 par défaut, réglable (D72)                       |
| Sauvegarde manuelle vers dossier, clé USB, disque | Livré  | e2e `settings`                                     |
| Restauration guidée                               | Livré  | depuis les paramètres ou un poste neuf (D73) ; e2e |
| Rappel sans sauvegarde externe                    | Livré  | tableau de bord et connexion                       |

### 4.11 Paramètres

| Exigence                                                   | Statut | Preuve                                  |
| ---------------------------------------------------------- | ------ | --------------------------------------- |
| Boutique (nom, logo, adresse, téléphone, mentions légales) | Livré  | imprimés sur tous les documents (D74)   |
| Devise, date, taxes, numérotation des factures             | Livré  | décimales figées dès le premier montant |
| Imprimante, format des tickets et des étiquettes           | Livré  | ticket d'essai                          |
| Langue (français, anglais)                                 | Livré  | Paramètres › Apparence                  |

### 4.12 Familles électronique, électroménager, solaire

| Exigence                                                                      | Statut | Preuve / remarque                               |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| Quatre familles, sous-catégories modifiables, filtres et rapports par famille | Livré  | `v_category_families`, `v_sales_by_family`      |
| Caractéristiques par catégorie, jamais en dur, saisies, affichées, filtrables | Livré  | `attribute_definitions`, filtres min/max/valeur |
| Suivi par produit ; article suivi vendu avec son unité exacte                 | Livré  | trigger de mouvement ; e2e `sales`              |
| Garanties variables, imprimées, recherche par numéro                          | Livré  | bon de garantie, écran Garantie et SAV          |
| Kits : composants décrémentés, tout ou rien, prix propre                      | Livré  | tests `sales` (kit sans stock refusé en entier) |
| Services sans stock                                                           | Livré  | `is_stocked = 0`                                |
| Devis convertibles, réservation facultative                                   | Livré  | D57                                             |
| Acomptes et échéancier, rappels                                               | Livré  | écran Échéancier, `v_overdue_installments`      |
| Livraison : adresse, statut, bon imprimable                                   | Livré  | écran Livraisons                                |
| Stock multi-emplacements, transferts tracés                                   | Livré  | `v_stock_by_location`                           |
| SAV simplifié avec contrôle de la garantie                                    | Livré  | D62                                             |
| Étiquettes avec numéro de série                                               | Livré  | étiquettes par unité suivie                     |
| Rapports par famille, marque, catégorie ; devis et échéances                  | Livré  | rapports `sales`, `stock`, `followups`          |

## 4. Exigences non fonctionnelles (section 5)

| Exigence                                                                              | Statut            | Preuve / remarque                                                                                               |
| ------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Démarrage < 3 s                                                                       | Livré             | ouverture de la base 1,2 s sur la base de charge ; fenêtre en ~1 s ; contrôle d'intégrité en arrière-plan (D77) |
| Recherche < 100 ms sur 50 000 références                                              | Livré             | 10,8 ms                                                                                                         |
| Panier < 50 ms                                                                        | Livré             | 0,8 ms                                                                                                          |
| Vente < 500 ms                                                                        | Livré             | 8 ms                                                                                                            |
| Listes virtualisées, pagination côté base                                             | Livré             | TanStack Virtual                                                                                                |
| Aucun appel réseau dans la vente                                                      | Livré             | réseau bloqué                                                                                                   |
| Rapports lourds en arrière-plan                                                       | Livré             | thread des rapports (tableau de bord 4,8 s, rapports ≤ 4 s sans bloquer)                                        |
| 100 % hors ligne, transactions atomiques                                              | Livré             | tests de vente « tout ou rien »                                                                                 |
| WAL, intégrité au démarrage                                                           | Livré             | D77 ; base endommagée refermée avec l'écran de restauration                                                     |
| Aucun stock négatif                                                                   | Livré             | trigger                                                                                                         |
| Authentification, rôles, coûts invisibles aux vendeurs                                | Livré             | tests d'intrusion (D79)                                                                                         |
| Chiffrement de la base et des sauvegardes                                             | Livré             | SQLCipher, AES-256-GCM                                                                                          |
| Journal non modifiable depuis l'interface                                             | Livré             | aucune écriture exposée ; triggers                                                                              |
| Interface en français, caisse sans souris, raccourcis, messages clairs, confirmations | Livré             | e2e clavier, WCAG                                                                                               |
| Formation de 1 à 2 h suffisante                                                       | À valider         | avec le vendeur ; guide utilisateur fourni                                                                      |
| Windows 10/11 64 bits, 4 Go                                                           | Livré / À valider | construit et testé sous Windows 11 ; Windows 10 et 4 Go à vérifier sur le poste cible                           |
| 1366 × 768 minimum                                                                    | Livré             | captures et e2e à 1366 × 768                                                                                    |
| Lecteur USB, imprimante ESC/POS, A4                                                   | À valider         | saisie clavier simulée, simulateur d'imprimante, PDF                                                            |
| Code structuré, Git, migrations, journaux locaux                                      | Livré             | commits par fonctionnalité, migrations immuables, `logs\`                                                       |

## 5. Interface (Annexe A)

| Exigence                                                                                                                                                           | Statut    | Preuve / remarque                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| Principes A.1 (simplicité, cohérence, retour immédiat, prévention)                                                                                                 | Livré     | composants uniques, confirmations                                                         |
| Thèmes clair et sombre                                                                                                                                             | Livré     | e2e WCAG dans les deux thèmes                                                             |
| Couleurs sémantiques, Inter, chiffres tabulaires, grille de 8 px, animations < 200 ms                                                                              | Livré     | jetons du design system                                                                   |
| Bibliothèque unique de composants, icônes lucide avec libellés                                                                                                     | Livré     |                                                                                           |
| Barre latérale, modules masqués selon le rôle                                                                                                                      | Livré     | e2e `auth`                                                                                |
| Recherche globale Ctrl+K (produit, IMEI, client, facture)                                                                                                          | Livré     | e2e `shell`                                                                               |
| Fil d'Ariane, retour ; utilisateur, sauvegarde, alertes visibles                                                                                                   | Livré     |                                                                                           |
| Écrans A.4 (connexion avec PIN, tableau de bord, caisse en deux zones, produits, stock, inventaire en étapes, ventes, clients, fournisseurs, rapports, paramètres) | Livré     | voir le guide utilisateur                                                                 |
| Écrans ajoutés (devis, fiche technique, échéancier, livraisons, garantie et SAV)                                                                                   | Livré     |                                                                                           |
| Caisse au clavier et au scanner, focus automatique, raccourcis affichés                                                                                            | Livré     | F2, F4, F8, Échap                                                                         |
| Signal sonore au scan                                                                                                                                              | Livré     |                                                                                           |
| Zones tactiles larges                                                                                                                                              | À valider | boutons de 40 px ; essai sur écran tactile à faire                                        |
| Aucune boîte de dialogue superflue en vente                                                                                                                        | Livré     |                                                                                           |
| États chargement, vide, erreur sur chaque écran                                                                                                                    | Livré     |                                                                                           |
| WCAG AA, clavier, focus visible                                                                                                                                    | Livré     | axe-core sur chaque écran livré, clair et sombre                                          |
| 1366 × 768 à grand écran, taille de texte réglable                                                                                                                 | Livré     |                                                                                           |
| A.7 maquettes, prototype et test d'utilisabilité avec le vendeur                                                                                                   | À valider | démarche à mener avec le client ; une vente complète au clavier tient en quelques actions |

## 6. Sécurité (Annexe B)

| Exigence                                                                          | Statut            | Preuve / remarque                                                                                                                                                |
| --------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B.1 Argon2id avec sel, règles de mot de passe, liste des mots courants            | Livré             | D16                                                                                                                                                              |
| B.1 Délai croissant puis blocage                                                  | Livré             | tests `auth`                                                                                                                                                     |
| B.1 Mot de passe administrateur au premier lancement                              | Livré             | aucun compte par défaut : l'administrateur choisit son mot de passe ; mots de passe provisoires à changer                                                        |
| B.1 PIN vendeur limité à la caisse                                                | Livré             | test d'intrusion                                                                                                                                                 |
| B.1 Verrouillage d'inactivité, déconnexion                                        | Livré             |                                                                                                                                                                  |
| B.1 Récupération administrateur par clé hors ordinateur                           | Livré             | clé renouvelée après usage                                                                                                                                       |
| B.2 RBAC dans la logique métier                                                   | Livré             | droits revérifiés dans chaque service (test d'intrusion)                                                                                                         |
| B.2 Moindre privilège, plafonds de remise, actions réservées                      | Livré             | D52                                                                                                                                                              |
| B.2 Coûts et marges invisibles, y compris exports et rapports                     | Livré             | colonnes sensibles retirées sans `cost.view`                                                                                                                     |
| B.3 Base chiffrée, clé sous DPAPI                                                 | Livré / À valider | testé sur ce poste ; autre compte Windows à refaire à la recette                                                                                                 |
| B.3 Sauvegardes chiffrées, contrôle d'intégrité à la restauration                 | Livré             | GCM + SHA-256 ; sauvegarde modifiée refusée (test)                                                                                                               |
| B.3 Données clients minimales, effacement ou anonymisation                        | Livré             | anonymisation du client (nom, téléphone, adresse, notes) ; les adresses des livraisons déjà faites restent sur le bon de livraison, par décision du client (D87) |
| B.3 Exports tracés, aucune donnée sensible dans les journaux                      | Livré             | masquage testé                                                                                                                                                   |
| B.4 Audit chaîné, aucune suppression, factures sans trou, intégrité au démarrage  | Livré             | tests `db/audit`, `db/integrity`                                                                                                                                 |
| B.4b Alertes anti-fraude et rapport d'activités sensibles                         | Livré             | D75                                                                                                                                                              |
| B.5 contextIsolation, nodeIntegration, sandbox, CSP, aucun contenu distant        | Livré             | e2e `shell`                                                                                                                                                      |
| B.5 IPC listés et validés, SQL paramétré, échappement                             | Livré             | injection SQL et FTS testées                                                                                                                                     |
| B.5 Navigation externe bloquée, DevTools désactivés en production                 | Livré             | vérifié aussi sur l'application installée                                                                                                                        |
| B.5 Accès limité au dossier de données                                            | Livré             | chemins choisis par le processus principal ; installation par utilisateur                                                                                        |
| B.6 Setup.exe signé                                                               | À valider         | signature configurée (`dist:signed`, D84) ; aucun certificat disponible pour l'essai                                                                             |
| B.6 Mises à jour vérifiées avant installation, retour arrière                     | Livré             | signature, éditeur, version, copie vérifiée, sauvegarde (D82)                                                                                                    |
| B.6 Sauvegarde avant migration, audit des dépendances, versions figées            | Livré             | `npm audit` : 0 en production                                                                                                                                    |
| B.6 Licence liée à la machine                                                     | Non livré         | « selon le modèle commercial » : non demandé                                                                                                                     |
| B.7 Règle 3-2-1, test de restauration, procédure en cas de vol ou panne           | Livré             | guide utilisateur §16 et §18 ; e2e de restauration                                                                                                               |
| B.8 Tests d'intrusion (rôles, injection, lecture de la base, sauvegarde modifiée) | Livré             | `tests/unit/security`, `db`, `backup`                                                                                                                            |
| B.8 Revue de code et analyse statique                                             | Livré             | ESLint strict typé ; revue manuelle (sous-agent `security-reviewer` indisponible)                                                                                |

## 7. Base de données (Annexe E)

| Exigence                                                                | Statut | Preuve                                     |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------ |
| E.1 Conventions (STRICT, ISO UTC, entiers, CHECK, RESTRICT)             | Livré  | [BASE_DE_DONNEES.md](BASE_DE_DONNEES.md)   |
| E.2 Tables par domaine                                                  | Livré  | 40 tables                                  |
| E.3 Relations                                                           | Livré  | diagramme Mermaid                          |
| E.4 Contraintes et triggers                                             | Livré  | 99 triggers ; tests `db/schema`            |
| E.5 Index, FTS5                                                         | Livré  | 68 index ; migration 0011 (D81)            |
| E.6 Vues                                                                | Livré  | 15 vues                                    |
| E.7 Migrations, seed, sauvegarde avant migration                        | Livré  | migrations immuables, empreintes vérifiées |
| E.7 Données de démonstration (20 marques, 2 000 produits, 5 000 ventes) | Livré  | `npm run seed`, e2e `demo` (D76)           |
| E.8 Tests de la base                                                    | Livré  | `tests/unit/db`                            |
| Soldes par vues, prix figés dans les lignes                             | Livré  |                                            |
| Mouvement de stock unique, vente en une transaction                     | Livré  |                                            |
| Charge : 50 000 produits, 100 000 ventes, 500 000 mouvements            | Livré  | `npm run test:load` (D78)                  |

## 8. Déploiement et livrables (sections 9, 11, 12)

| Exigence                                                         | Statut    | Preuve / remarque                                                                                  |
| ---------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| Setup.exe unique, installation en quelques clics                 | Livré     | `npm run dist` ; `npm run test:packaged`                                                           |
| Raccourci bureau et menu Démarrer                                | Livré     | vérifié après installation                                                                         |
| Désinstallation propre                                           | Livré     | programme, raccourcis et entrée du registre supprimés ; données gardées (D83)                      |
| Assistant de premier lancement                                   | Livré     | e2e `auth`                                                                                         |
| Données dans un dossier utilisateur distinct                     | Livré     | `%APPDATA%\Boutique Gestion` ; vérifié sur l'application installée                                 |
| Procédure de mise à jour documentée                              | Livré     | guide utilisateur §17, guide technique §8                                                          |
| Migration des données existantes (import Excel/CSV)              | Livré     | import du catalogue                                                                                |
| Code source, base avec migrations                                | Livré     | dépôt Git                                                                                          |
| Documentation utilisateur (guide PDF illustré)                   | Livré     | [GUIDE_UTILISATEUR.md](GUIDE_UTILISATEUR.md) et `GUIDE_UTILISATEUR.pdf`, captures de l'application |
| Documentation technique (architecture, modèle de données, build) | Livré     | [GUIDE_TECHNIQUE.md](GUIDE_TECHNIQUE.md), [BASE_DE_DONNEES.md](BASE_DE_DONNEES.md)                 |
| Guide d'installation et de sauvegarde                            | Livré     | guide utilisateur §1, §16, §18                                                                     |
| Jeu de données de test                                           | Livré     | `npm run seed`                                                                                     |
| Tests unitaires stock et vente, tests de performance             | Livré     | 273 tests ; test de charge                                                                         |
| Formation du vendeur                                             | Non livré | prestation à planifier avec le client                                                              |
| Signature du setup.exe par un vrai certificat                    | À valider | voir B.6                                                                                           |

## 9. Ce qui reste à faire avec le client

1. **Recette sur le matériel** : imprimante thermique (et tiroir-caisse), lecteur de codes-barres, imprimante
   d'étiquettes, écran tactile, poste Windows 10 avec 4 Go.
2. **Certificat de signature de code** : à acheter ; puis `npm run dist:signed` et `npm run test:packaged`.
3. **DPAPI et restauration** sur un autre compte Windows ou un nouveau poste.
4. **Test d'utilisabilité** avec le vendeur (A.7) et formation.
5. **Décisions en attente** : avoirs fournisseurs (D48) ; bons de commande (optionnels en version 1).
