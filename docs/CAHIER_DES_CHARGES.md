# Cahier des charges

**Application de bureau de gestion des stocks, de l'inventaire et des ventes pour une boutique de téléphones, d'accessoires, d'électronique, d'électroménager et d'énergie solaire**

Version 1.3 – Novembre 2026

## 1. Contexte et objectifs

### 1.1 Contexte

Un commerçant vend des téléphones et des accessoires, de l'électronique et de l'électroménager (téléviseurs, amplificateurs de musique), ainsi que du matériel d'énergie solaire (panneaux solaires, régulateurs de charge, batteries, onduleurs), de plusieurs marques. Il gère aujourd'hui son activité de façon manuelle ou avec des outils dispersés, ce qui provoque des erreurs de stock, des pertes de traçabilité et un manque de visibilité sur ses bénéfices.

### 1.2 Objectif général

Concevoir une application de bureau **tout-en-un**, installable via un fichier **setup (.exe)** sur l'ordinateur du vendeur, permettant de gérer :

- le catalogue produits (téléphonie, électronique et audio, électroménager, énergie solaire, multi-marques et multi-familles) ;
- les stocks et leurs mouvements ;
- les inventaires physiques ;
- les ventes (caisse, factures, paiements) ;
- les rapports et statistiques d'activité.

### 1.3 Objectifs mesurables

| Objectif | Indicateur |
| --- | --- |
| Rapidité en caisse | Recherche d'un produit en moins de 100 ms |
| Fonctionnement sans internet | 100 % des fonctions de base disponibles hors ligne |
| Fiabilité du stock | Écart stock théorique / réel réduit après inventaire |
| Installation simple | Installation complète en moins de 5 minutes, sans compétence technique |
| Traçabilité | Chaque téléphone retrouvable par son IMEI |

## 2. Périmètre du projet

### 2.1 Inclus

- Application Windows installable (monoposte)
- Base de données locale
- Gestion des produits (quatre familles : téléphonie, électronique et audio, électroménager, énergie solaire), des stocks, des inventaires, des devis, des ventes, des clients et des fournisseurs
- Impression de tickets et factures
- Lecture de codes-barres
- Rapports et exports
- Sauvegarde et restauration
- Gestion des utilisateurs et des rôles

### 2.2 Exclus de la version 1

- Synchronisation cloud et multi-boutiques
- Boutique en ligne / e-commerce
- Application mobile
- Comptabilité complète (bilan, déclarations fiscales)
- Paiement électronique intégré (terminal bancaire, Mobile Money par API)

Ces éléments sont prévus comme évolutions possibles (voir section 12).

## 3. Utilisateurs et rôles

| Rôle | Droits principaux |
| --- | --- |
| **Administrateur (patron)** | Accès total : produits, prix d'achat, stocks, ventes, rapports, utilisateurs, paramètres, sauvegardes |
| **Gérant** | Gestion des produits, stocks, inventaires, rapports (sans gestion des utilisateurs ni des paramètres système) |
| **Vendeur** | Caisse, consultation du stock, encaissement, impression ; aucun accès aux prix d'achat ni aux bénéfices |

Chaque action sensible (modification de prix, annulation de vente, ajustement de stock) est enregistrée avec l'utilisateur, la date et l'heure.

## 4. Exigences fonctionnelles

### 4.1 Gestion des produits

- Création, modification, archivage de produits (pas de suppression définitive si le produit a un historique).
- Champs : nom, marque, modèle, catégorie, sous-catégorie, description, code-barres, référence interne (SKU), prix d'achat, prix de vente, TVA/taxe éventuelle, seuil d'alerte de stock, photo (optionnelle), statut (actif/archivé).
- **Catégories** : quatre familles principales : téléphonie (téléphones, coques, chargeurs, câbles, écouteurs, protections d'écran), électronique et audio (téléviseurs, amplificateurs de musique, enceintes), électroménager, et énergie solaire (panneaux solaires, régulateurs de charge, batteries, onduleurs, câbles et connecteurs), plus les pièces détachées et les services (livraison, installation). Les familles et catégories sont modifiables par l'administrateur.
- **Marques** : gestion d'une liste de marques (Samsung, Apple, Tecno, Infinix, Xiaomi, etc.) modifiable par l'administrateur.
- **Variantes** : couleur, capacité de stockage et RAM (téléphones), état (neuf / reconditionné / occasion). Chaque variante possède son propre stock et peut avoir son propre prix. Les caractéristiques techniques propres à chaque famille (puissance, tension, taille d'écran, etc.) sont gérées par des attributs (voir 4.12).
- Génération et impression d'étiquettes avec code-barres.
- Importation de produits depuis un fichier Excel/CSV et exportation du catalogue.

### 4.2 Traçabilité par IMEI et numéro de série

- Enregistrement d'un ou deux numéros IMEI par téléphone en stock, et d'un numéro de série pour les articles de valeur (téléviseurs, amplificateurs, panneaux solaires, régulateurs, onduleurs, batteries) : chaque appareil est une unité unique. Le mode de suivi (aucun, numéro de série, IMEI) est défini produit par produit.
- Contrôle d'unicité : un IMEI ou un numéro de série ne peut pas être enregistré deux fois.
- Recherche d'un appareil par IMEI ou numéro de série (stock, vente, client acheteur, date).
- Liaison de l'IMEI ou du numéro de série à la vente pour la garantie et la traçabilité.
- Affichage de la durée de garantie restante sur la fiche de vente ; la durée est propre à chaque produit (de quelques mois pour un accessoire à plusieurs années pour un panneau solaire).

### 4.3 Gestion du stock

- **Entrées de stock** : réception de marchandises auprès d'un fournisseur, avec bon de réception, quantités, prix d'achat, date.
- **Sorties de stock** : ventes, retours fournisseurs, pertes, casse, vols, usage interne.
- **Retours clients** : réintégration au stock ou mise au rebut, avec motif.
- **Transferts** (optionnel) entre emplacements (vitrine, réserve).
- **Historique complet des mouvements** : date, produit, quantité, type, utilisateur, motif, document associé.
- **Alertes de stock bas** affichées au démarrage et dans le tableau de bord.
- **Valorisation du stock** : valeur totale au prix d'achat et au prix de vente.
- Calcul du coût moyen pondéré à chaque nouvelle entrée.

### 4.4 Inventaire

- Création d'une session d'inventaire (complet ou partiel par marque/catégorie).
- Saisie des quantités comptées, manuellement ou par scan de codes-barres.
- Comparaison automatique stock théorique / stock compté, avec liste des écarts.
- Validation par le gérant ou l'administrateur, qui génère les ajustements de stock correspondants.
- Conservation de l'historique de chaque inventaire (date, responsable, écarts, valeur des écarts).
- Export du rapport d'inventaire en PDF et Excel.

### 4.5 Gestion des ventes (caisse)

- **Interface de caisse rapide** : recherche par nom, code-barres, IMEI ou numéro de série ; ajout au panier en un clic ou un scan.
- Modification des quantités, suppression de lignes, remises par ligne ou globales (en montant ou pourcentage, soumises à un plafond selon le rôle).
- **Modes de paiement** : espèces, carte, Mobile Money, virement, chèque, paiement mixte.
- **Paiement partiel et vente à crédit** : suivi des acomptes et du reste à payer par client.
- **Calcul automatique** du total, de la monnaie à rendre et de la marge.
- **Documents** : ticket de caisse (imprimante thermique 58/80 mm), facture A4 PDF, bon de garantie.
- **Mise en attente** d'un panier pour servir un autre client, puis reprise.
- **Annulation et retour de vente** avec motif, restreint par rôle, et traçabilité complète.
- **Clôture de caisse** quotidienne : total encaissé par mode de paiement, comparaison avec l'argent réellement compté, écart éventuel.

### 4.6 Gestion des clients

- Fiche client : nom, téléphone, adresse (optionnelle), historique des achats, soldes et crédits en cours.
- Suivi des dettes clients et enregistrement des remboursements.
- Recherche rapide d'un client depuis la caisse, création à la volée.

### 4.7 Gestion des fournisseurs et des achats

- Fiche fournisseur : nom, contacts, historique des achats, dettes éventuelles.
- Bons de commande (optionnel en version 1) et bons de réception.
- Suivi des paiements aux fournisseurs et des soldes dus.

### 4.8 Tableau de bord et rapports

- **Tableau de bord** : ventes du jour, de la semaine et du mois, bénéfice estimé, produits en alerte, derniers mouvements.
- **Rapports** :
  - ventes par période, par vendeur, par marque, par catégorie ;
  - bénéfices et marges ;
  - produits les plus et les moins vendus (rotation du stock) ;
  - valorisation du stock ;
  - créances clients et dettes fournisseurs ;
  - journal des mouvements de stock ;
  - rapports de caisse.
- Export en **PDF, Excel et CSV**.
- Graphiques simples (courbes, histogrammes).

### 4.9 Utilisateurs et sécurité

- Connexion par identifiant et mot de passe (mots de passe stockés hachés, jamais en clair).
- Gestion des utilisateurs, des rôles et des permissions.
- Journal d'audit (qui a fait quoi, quand).
- Verrouillage automatique de la session après inactivité (paramétrable).

### 4.10 Sauvegarde et restauration

- **Sauvegarde automatique** quotidienne de la base de données, avec conservation des N dernières copies.
- Sauvegarde manuelle à la demande vers un dossier, une clé USB ou un disque externe.
- Restauration guidée depuis une sauvegarde.
- Rappel si aucune sauvegarde externe n'a été faite depuis plusieurs jours.

### 4.11 Paramètres

- Informations de la boutique (nom, logo, adresse, téléphone, mentions légales) pour les documents.
- Devise, format de date, taux de taxe, numérotation des factures.
- Configuration de l'imprimante, du format des tickets et des étiquettes.
- Langue de l'interface (français par défaut, anglais en option).

### 4.12 Familles de produits : électronique, électroménager et énergie solaire

Le commerce ne vend pas que de la téléphonie : il propose aussi des téléviseurs, des amplificateurs de musique et du matériel d'énergie solaire (panneaux, régulateurs de charge, batteries, onduleurs). Ces articles sont plus volumineux, plus chers et ont des caractéristiques techniques différentes. Ils modifient plusieurs règles de gestion.

- **Familles et catégories** : quatre familles de premier niveau (Téléphonie, Électronique et audio, Électroménager, Énergie solaire), avec des sous-catégories modifiables (par exemple Énergie solaire : panneaux, régulateurs, batteries, onduleurs, câblage). Les filtres, rapports et statistiques fonctionnent par famille.
- **Caractéristiques techniques par catégorie (attributs)** : l'administrateur définit, pour chaque catégorie, les champs propres à ses produits. Exemples : panneau solaire (puissance en Wc, tension, type monocristallin ou polycristallin, dimensions) ; régulateur de charge (intensité en A, tension 12/24/48 V, type PWM ou MPPT) ; batterie (capacité en Ah, tension, technologie) ; onduleur (puissance en W ou VA, tension d'entrée) ; téléviseur (taille en pouces, résolution, Smart TV) ; amplificateur (puissance en W, nombre de canaux, entrées). Ces attributs sont saisis sur la fiche produit, affichés en caisse et sur les documents, et utilisables comme filtres de recherche.
- **Mode de suivi par produit** : aucun suivi unitaire (câbles, petits accessoires), numéro de série (téléviseurs, amplificateurs, panneaux, régulateurs, onduleurs, batteries) ou IMEI (téléphones). Un article suivi ne peut pas être vendu sans choisir l'unité exacte.
- **Garanties variables** : durée définie par produit, imprimée sur la facture et le bon de garantie ; recherche de la garantie par numéro de série.
- **Kits** : un kit (par exemple un kit solaire composé de panneaux, d'un régulateur, d'une batterie, d'un onduleur et de câbles) est un produit composé. À la vente, le stock de chaque composant est diminué automatiquement. Le prix du kit peut différer de la somme des composants, qui restent vendables séparément.
- **Services** : lignes sans stock (livraison, installation, mise en service, main-d'œuvre) facturées comme n'importe quel article. Le planning de chantier et la gestion des techniciens restent hors périmètre.
- **Devis et proforma** : pour les achats importants (installation solaire, téléviseur, sonorisation), création d'un devis avec date de validité, transformation en vente en un clic et réservation facultative du stock pendant la validité.
- **Acomptes et paiement échelonné** : échéancier avec dates d'échéance, rappels des échéances proches ou dépassées, suivi du solde par client.
- **Livraison** : adresse et statut (à livrer, livré) sur la vente, bon de livraison imprimable.
- **Stock sur plusieurs emplacements** : gros articles en dépôt, petits articles en vitrine ou en magasin ; transferts entre emplacements tracés ; stock affiché par emplacement.
- **Garantie et SAV simplifié** : enregistrement d'une réclamation par numéro de série (date, panne, statut : reçue, envoyée au fournisseur, réparée, remplacée, refusée), avec contrôle de la période de garantie. Pas de gestion d'atelier de réparation.
- **Étiquettes** : étiquette avec code-barres et numéro de série pour les articles suivis.
- **Rapports par famille** : ventes, marges, rotation et valeur du stock par famille, marque et catégorie ; état des devis et des échéances.

## 5. Exigences non fonctionnelles

### 5.1 Performance (aucune latence)

- Démarrage de l'application en moins de 3 secondes sur le poste cible.
- Recherche de produit en moins de 100 ms, y compris avec 50 000 références.
- Ajout d'un article au panier et affichage du total de façon instantanée (moins de 50 ms).
- Validation d'une vente en moins de 500 ms.
- Affichage fluide des grandes listes (listes virtualisées, pagination côté base).
- Aucun appel réseau dans le parcours de vente.
- Rapports lourds calculés en arrière-plan sans bloquer l'interface.

### 5.2 Fiabilité et intégrité des données

- Fonctionnement 100 % hors ligne.
- Transactions atomiques : une vente enregistre le panier, le paiement et le mouvement de stock en une seule opération ou pas du tout.
- Protection contre la corruption en cas de coupure de courant (mode journalisé WAL de la base).
- Vérification d'intégrité de la base au démarrage.
- Aucune quantité de stock négative sans autorisation explicite.

### 5.3 Sécurité

- Accès protégé par authentification et rôles.
- Prix d'achat et marges invisibles pour les vendeurs.
- Chiffrement de la base de données et des sauvegardes, et exigences détaillées en Annexe B.
- Journal des opérations sensibles non modifiable depuis l'interface.

### 5.4 Ergonomie

- Interface claire, moderne, en français, utilisable par une personne peu technique.
- Caisse utilisable au clavier et au lecteur de code-barres, sans souris.
- Raccourcis clavier pour les actions fréquentes (nouvelle vente, recherche, paiement).
- Messages d'erreur compréhensibles et confirmations pour les actions destructrices.
- Formation initiale de 1 à 2 heures suffisante pour être autonome.

### 5.5 Compatibilité

- Windows 10 et Windows 11 (64 bits). Fonctionnement attendu sur un poste avec 4 Go de RAM minimum.
- Résolution minimale 1366 × 768, adaptation aux écrans plus grands.
- Compatibilité avec lecteurs de codes-barres USB (mode clavier), imprimantes thermiques ESC/POS et imprimantes A4 standard.

### 5.6 Maintenabilité

- Code structuré et documenté, versionné avec Git.
- Migrations de base de données versionnées pour les mises à jour sans perte de données.
- Journaux d'erreurs locaux pour faciliter le diagnostic.

## 6. Architecture technique proposée

### 6.1 Choix technologique

Pile retenue pour la réalisation : Electron + React + TypeScript + SQLite chiffré (option B), le meilleur compromis entre rapidité de développement, interface moderne et installateur Windows. Le détail des bibliothèques figure en Annexe C. Les options A et C restent des alternatives si le poste du vendeur s'avère trop modeste (moins de 4 Go de RAM).

| Option | Pile | À privilégier si |
| --- | --- | --- |
| **A (recommandée si poste correct)** | Tauri + React + SQLite | Interface moderne, installateur léger (\~10 Mo), bonne performance |
| **B** | Electron + React + SQLite | Équipe maîtrisant JavaScript, développement le plus rapide, poste avec 8 Go de RAM |
| **C** | .NET (WPF) + SQLite | Poste très modeste ou ancien, priorité absolue à la vitesse |

### 6.2 Composants

- **Interface** : React + TypeScript, composants Tailwind ou Material UI.
- **Logique métier** : couche de services (ventes, stock, inventaire) isolée de l'interface.
- **Base de données** : SQLite en mode WAL, index sur code-barres, IMEI, nom, marque et date.
- **Impression** : génération PDF (factures) et commandes ESC/POS (tickets).
- **Packaging** : installateur Windows (.exe) signé si possible, avec raccourci bureau, désinstallation propre et mises à jour.

### 6.3 Principes de conception

- Architecture hors ligne d'abord.
- Séparation interface / logique / données.
- Toutes les opérations de stock passent par une seule fonction de mouvement (aucune modification directe des quantités).
- Montants stockés en entiers (plus petite unité monétaire) pour éviter les erreurs d'arrondi.

## 7. Modèle de données (vue d'ensemble, détail en Annexe E)

| Entité | Contenu principal |
| --- | --- |
| Utilisateur | identifiant, mot de passe haché, rôle, statut |
| Marque | nom, logo |
| Famille / catégorie | nom, catégorie parente, mode de suivi et garantie par défaut |
| Attribut technique | catégorie, libellé, type, unité (Wc, V, A, Ah, W, pouces) |
| Produit | nom, marque, catégorie, type (téléphone, accessoire, électronique, électroménager, solaire, pièce, service, kit), mode de suivi (aucun, numéro de série, IMEI), prix d'achat et de vente, garantie, seuil d'alerte, valeurs des attributs |
| Variante | produit, couleur, stockage, état, code-barres, prix, quantité en stock |
| Composant de kit | kit, composant, quantité |
| Unité suivie | variante, numéro de série (ou IMEI 1), IMEI 2, statut (en stock, réservé, vendu, retourné, défectueux), fin de garantie, date d'entrée |
| Emplacement de stock | nom (magasin, dépôt), emplacement par défaut |
| Fournisseur | nom, contacts, solde |
| Réception | fournisseur, date, lignes, total |
| Mouvement de stock | variante, emplacement, type, quantité, utilisateur, date, motif, document lié |
| Inventaire | date, responsable, statut, lignes (compté / théorique / écart) |
| Client | nom, téléphone, adresse, solde |
| Devis | numéro, client, validité, lignes, total, statut |
| Vente | numéro, date, vendeur, client, total, remise, statut, échéance, livraison |
| Ligne de vente | vente, variante, unité suivie, quantité, prix, remise, type (article, kit, composant, service) |
| Paiement | vente, mode, montant, date |
| Échéance | vente, date d'échéance, montant, statut |
| Livraison | vente, adresse, statut, dates |
| Réclamation de garantie | unité, vente, panne, statut, résolution |
| Journal d'audit | utilisateur, action, entité, date, détails |
| Paramètres | clé, valeur |

## 8. Matériel et environnement cible

### 8.1 Poste de travail minimal

- Processeur double cœur, 4 Go de RAM, 500 Mo d'espace pour l'application, SSD fortement recommandé.
- Windows 10 ou 11 (64 bits).

### 8.2 Périphériques recommandés

- Lecteur de codes-barres USB.
- Imprimante de tickets thermique 80 mm (ou 58 mm).
- Imprimante A4 pour les factures.
- Onduleur (protection contre les coupures de courant).
- Disque ou clé USB externe pour les sauvegardes.

## 9. Déploiement et installation

- Livraison d'un **setup.exe** unique, installation en quelques clics.
- Création d'un raccourci bureau et d'une entrée dans le menu Démarrer.
- Assistant de premier lancement : informations de la boutique, création du compte administrateur, choix du dossier de sauvegarde.
- Les données sont stockées dans un dossier utilisateur distinct de l'application, pour que les mises à jour ne les écrasent jamais.
- Procédure de mise à jour documentée (manuelle ou automatique).
- Procédure de migration des données existantes (import Excel/CSV).

## 10. Planification prévisionnelle

| Phase | Contenu | Durée estimée |
| --- | --- | --- |
| **1. Cadrage** | Validation du cahier des charges, maquettes, choix techno final, liste des familles, catégories et attributs techniques | 1 à 2 semaines |
| **2. Fondations** | Architecture, base de données, authentification, rôles | 2 semaines |
| **3. Produits et stock** | Catalogue multi-familles, attributs techniques, variantes, IMEI et numéros de série, kits, entrées/sorties, multi-emplacements, historique, alertes | 4 à 5 semaines |
| **4. Inventaire** | Sessions, comptage, écarts, ajustements | 1 à 2 semaines |
| **5. Ventes** | Caisse, paiements, crédits et échéanciers, devis, services, livraisons, tickets et factures, clôture de caisse | 4 à 6 semaines |
| **6. Clients, fournisseurs et SAV** | Fiches, soldes, historiques, garantie et réclamations par numéro de série | 2 semaines |
| **7. Rapports et tableau de bord** | Statistiques par famille, exports | 2 semaines |
| **8. Sauvegarde et paramètres** | Sauvegarde auto, restauration, configuration | 1 semaine |
| **9. Tests et recette** | Tests, corrections, essais en conditions réelles | 2 à 3 semaines |
| **10. Déploiement et formation** | Installation, import des données, formation du vendeur | 1 semaine |

**Durée totale estimée : 5 à 7 mois** pour un développeur seul à temps plein, à ajuster selon la taille de l'équipe et le périmètre retenu.

### 10.1 Découpage possible en versions

- **Version 1 (MVP)** : produits, stock, caisse, tickets, sauvegarde. Permet de commencer à utiliser l'application rapidement.
- **Version 1.1** : inventaire, clients et crédits, rapports.
- **Version 1.2** : fournisseurs, étiquettes, import/export avancés.

## 11. Livrables

- Application installable (setup.exe) et code source.
- Base de données avec scripts de migration.
- Documentation utilisateur (guide PDF illustré).
- Documentation technique (architecture, modèle de données, procédure de build).
- Guide d'installation et de sauvegarde.
- Jeu de données de test.
- Session de formation pour le vendeur.

## 12. Tests et recette

- **Tests unitaires** sur la logique de stock et de vente (calcul des totaux, marges, coût moyen).
- **Tests de performance** avec une base de 50 000 produits et 100 000 ventes.
- **Tests de robustesse** : coupure de courant simulée pendant une vente, base volumineuse, restauration de sauvegarde.
- **Recette utilisateur** : le vendeur utilise l'application en conditions réelles pendant 1 à 2 semaines avant la mise en production définitive.
- **Critères d'acceptation** : tous les objectifs de la section 1.3 atteints, aucune anomalie bloquante, données importées vérifiées.

## 13. Maintenance et évolutions

### 13.1 Maintenance

- Garantie de correction des anomalies pendant une période à définir (par exemple 3 mois).
- Contrat de maintenance optionnel : support, mises à jour, assistance à distance.

### 13.2 Évolutions possibles

- Synchronisation cloud et sauvegarde en ligne.
- Gestion de plusieurs boutiques avec stock centralisé.
- Application mobile pour consulter les ventes et le stock à distance.
- Module de réparations (dépôt d'un appareil, suivi, facturation).
- Intégration des paiements Mobile Money.
- Programme de fidélité clients.
- Envoi de reçus par SMS ou WhatsApp.

## 14. Risques et mesures

| Risque | Impact | Mesure |
| --- | --- | --- |
| Poste du vendeur trop ancien | Lenteurs | Valider la configuration avant développement, choisir Tauri ou .NET si besoin |
| Perte de données (panne, vol, virus) | Critique | Sauvegarde automatique quotidienne + copie externe obligatoire |
| Coupures de courant | Corruption ou vente perdue | Mode WAL, transactions atomiques, recommandation d'un onduleur |
| Saisie d'erreurs en caisse | Écarts de stock | Scan des codes-barres, confirmations, inventaires réguliers |
| Résistance au changement | Application peu utilisée | Interface simple, formation, déploiement progressif |
| Périmètre qui grossit | Retards, surcoûts | Découpage en versions, validation écrite des évolutions |
| Incompatibilité imprimante ou lecteur | Blocage en caisse | Tester le matériel réel dès la phase 1 |

## 15. Points à valider avec le client

1. Caractéristiques exactes de l'ordinateur (RAM, processeur, SSD, version de Windows).
2. Nombre d'utilisateurs simultanés : un seul poste ou plusieurs postes en réseau local ?
3. Volume approximatif : nombre de produits, de ventes par jour.
4. Matériel disponible : lecteur de codes-barres, imprimante de tickets, imprimante A4.
5. Devise, taxes applicables et mentions légales obligatoires sur les factures.
6. Modes de paiement utilisés (espèces, Mobile Money, carte, crédit).
7. Gestion des réparations nécessaire ou non.
8. Existence de données à importer (fichier Excel, cahier, ancien logiciel).
9. Langue(s) de l'interface.
10. Budget et date de mise en service souhaitée.

Questions supplémentaires liées à l'électroménager et à l'énergie solaire :

- Quels kits solaires sont vendus en packs (composition type, prix) ?
- Le vendeur facture-t-il la livraison et l'installation ?
- Vend-il à crédit avec échéancier, et sur quelle durée ?
- Les gros articles sont-ils stockés dans un dépôt séparé du magasin ?
- Quelles garanties sont accordées, et quelle est la procédure de retour ou de remplacement auprès des fournisseurs (téléviseurs, panneaux, onduleurs) ?
- Le vendeur établit-il des devis ou des factures proforma ?
- Quelles familles, marques et références charger au départ dans le catalogue ?

## 16. Validation

|  | Nom | Date | Signature |
| --- | --- | --- | --- |
| **Le client** |  |  |  |
| **Le prestataire** |  |  |  |

## Annexe A – Exigences d'interface (UI/UX)

L'interface est un critère d'acceptation à part entière : elle doit être **moderne, intuitive, cohérente et rapide à prendre en main**, y compris pour une personne peu à l'aise avec l'informatique.

### A.1 Principes directeurs

- **Simplicité** : une action principale par écran, mise en évidence ; les options avancées sont repliées.
- **Cohérence** : mêmes composants, mêmes emplacements, mêmes mots dans toute l'application.
- **Vitesse d'usage** : tout ce qui est fréquent (vendre, chercher, encaisser) se fait en 2 à 3 actions maximum, au clavier ou au scanner.
- **Retour immédiat** : chaque action donne un retour visible (confirmation, état de chargement, erreur claire).
- **Prévention des erreurs** : confirmations pour les actions destructrices, annulation possible (« Annuler ») quand c'est réaliste, champs validés en direct.
- **Lisibilité** : forts contrastes, textes lisibles à distance de comptoir, chiffres clés en grand.

### A.2 Système de design

| Élément | Exigence |
| --- | --- |
| **Thèmes** | Mode clair et mode sombre, au choix de l'utilisateur |
| **Couleurs** | Une couleur principale de marque, couleurs sémantiques fixes : vert = succès/encaissé, orange = alerte/stock bas, rouge = erreur/suppression, bleu = information |
| **Typographie** | Une seule famille sans empattement (ex. Inter), 3 à 4 tailles de texte ; chiffres tabulaires pour les montants |
| **Espacement** | Grille de 8 px, marges généreuses, interface aérée |
| **Composants** | Bibliothèque unique et réutilisable : boutons, champs, tableaux, listes, cartes, fenêtres modales, notifications, onglets, étiquettes d'état |
| **Icônes** | Un seul jeu d'icônes cohérent, toujours accompagnées d'un libellé pour les actions importantes |
| **Mouvements** | Animations brèves (moins de 200 ms), jamais bloquantes |

### A.3 Navigation et structure

- **Barre latérale** fixe avec les modules : Tableau de bord, Caisse, Produits, Stock, Inventaire, Ventes, Clients, Fournisseurs, Rapports, Paramètres.
- Les modules non autorisés au rôle de l'utilisateur sont masqués.
- **Barre de recherche globale** (raccourci Ctrl+K) : produit, IMEI, client, facture.
- Fil d'Ariane et bouton retour sur les écrans de détail.
- Indicateurs permanents : utilisateur connecté, état de la dernière sauvegarde, alertes de stock.

### A.4 Écrans principaux

| Écran | Contenu et comportement attendus |
| --- | --- |
| **Connexion** | Identifiant et mot de passe, ou code PIN pour le vendeur ; messages d'erreur neutres |
| **Tableau de bord** | Ventes du jour, bénéfice, produits en alerte, dernières ventes, raccourcis « Nouvelle vente » et « Entrée de stock » ; graphiques simples |
| **Caisse** | Écran en deux zones : recherche et grille de produits à gauche, panier et total à droite ; gros bouton « Encaisser » ; scan, remise, client, mise en attente ; récapitulatif et impression en un clic |
| **Produits** | Tableau filtrable (marque, catégorie, stock), fiche détaillée avec variantes, photo, historique ; ajout rapide |
| **Stock** | Vue par produit et par variante, entrées/sorties, historique des mouvements, alertes colorées |
| **Inventaire** | Assistant en étapes : choix du périmètre, comptage (scan), écarts, validation |
| **Ventes** | Historique avec filtres, détail d'une vente, réimpression, retour/annulation |
| **Clients / Fournisseurs** | Fiche avec historique, solde, paiement d'un crédit en quelques clics |
| **Rapports** | Choix de période, graphiques, tableaux, export PDF/Excel |
| **Paramètres** | Boutique, utilisateurs, impressions, sauvegardes, sécurité ; organisés en sections claires |

**Écrans ajoutés pour les nouvelles familles de produits** : *Devis* (liste, création, conversion en vente), *Fiche produit technique* (attributs de la catégorie, composition d'un kit, numéros de série en stock), *Échéancier clients* (échéances à venir et en retard), *Livraisons* (à livrer, livrées) et *Garantie et SAV* (recherche par numéro de série, réclamations). Ils suivent le même design system et les mêmes règles de cohérence que les autres écrans.

### A.5 Ergonomie de la caisse

- Utilisable **entièrement au clavier et au lecteur de codes-barres**, avec focus automatique sur le champ de recherche.
- Raccourcis affichés à l'écran (ex. F2 nouvelle vente, F4 encaisser, F8 mise en attente, Échap annuler).
- Zones tactiles larges pour un usage sur écran tactile.
- Signal sonore discret au scan réussi ou en échec.
- Aucune boîte de dialogue superflue pendant une vente.

### A.6 États et accessibilité

- Chaque écran prévoit : état de chargement (squelettes), état vide avec action suggérée, état d'erreur avec solution.
- Contrastes conformes WCAG AA, navigation clavier complète, focus visible.
- Interface adaptable de 1366 × 768 jusqu'aux grands écrans, taille de texte ajustable.

### A.7 Processus de conception et validation

1. Maquettes « fil de fer » des écrans clés, validées par le vendeur avant tout développement.
2. Maquettes graphiques haute fidélité (caisse, tableau de bord, produits) et guide de style.
3. Prototype cliquable testé avec le vendeur.
4. Tests d'utilisabilité : un nouvel utilisateur doit réaliser une vente complète en moins de 2 minutes après 15 minutes de prise en main.

## Annexe B – Exigences de sécurité renforcées

La sécurité s'applique à trois niveaux : **les accès**, **les données** et **l'application elle-même**.

### B.1 Authentification et sessions

- Mots de passe hachés avec **Argon2id** (ou bcrypt à défaut), avec sel unique ; jamais stockés en clair ni réversibles.
- Règles de mot de passe : longueur minimale, refus des mots de passe trop courants.
- **Limitation des tentatives** : délai croissant puis verrouillage temporaire après plusieurs échecs.
- Changement de mot de passe obligatoire au premier lancement pour le compte administrateur.
- **Code PIN** rapide pour le vendeur en caisse, limité aux droits de caisse.
- Verrouillage automatique après inactivité ; déconnexion explicite.
- Procédure de **récupération du compte administrateur** sécurisée (clé de récupération générée à l'installation, à conserver hors de l'ordinateur).

### B.2 Autorisations

- Contrôle d'accès par rôles (RBAC) **appliqué dans la logique métier**, pas seulement en masquant des boutons de l'interface.
- Principe du moindre privilège : chaque rôle n'a que les droits nécessaires.
- Plafonds de remise par rôle ; annulation de vente, ajustement de stock et modification de prix réservés à un niveau supérieur, ou soumis à un code de validation.
- Prix d'achat et marges inaccessibles aux vendeurs, y compris dans les exports et les rapports.

### B.3 Protection des données

- **Base de données chiffrée au repos** (SQLCipher, AES-256).
- Clé de chiffrement protégée par le coffre de Windows (**DPAPI**) et jamais stockée en clair dans l'application.
- **Sauvegardes chiffrées** (AES-256) avec un mot de passe défini par le propriétaire, et vérification d'intégrité (somme de contrôle) à la restauration.
- Données personnelles des clients limitées au strict nécessaire, avec possibilité d'effacement ou d'anonymisation sur demande.
- Exports (Excel, PDF) tracés dans le journal d'audit.
- Aucune donnée sensible dans les journaux techniques.

### B.4 Intégrité et traçabilité

- **Journal d'audit infalsifiable** : chaque entrée est chaînée par empreinte (hash) avec la précédente, ce qui rend toute modification ou suppression détectable.
- Aucune suppression physique des ventes, paiements ou mouvements de stock : les corrections se font par opérations inverses.
- Numérotation des factures continue, sans trou ni doublon.
- Vérification d'intégrité de la base au démarrage, alerte en cas d'anomalie.

### B.4b Alertes anti-fraude

- Alerte sur annulations ou remises inhabituelles, ajustements de stock répétés, ventes sous le prix d'achat.
- Rapport d'activités sensibles consultable par l'administrateur.

### B.5 Sécurité de l'application

Si la pile Electron est retenue (les règles équivalentes s'appliquent à Tauri) :

- `contextIsolation` activé, `nodeIntegration` désactivé, mode `sandbox` activé.
- **Politique de sécurité du contenu (CSP)** stricte ; aucun chargement de contenu distant dans l'interface.
- Communication interface ↔ logique par canaux **IPC listés et validés** (chaque entrée est vérifiée et typée).
- Requêtes SQL **toujours paramétrées** (aucune concaténation de texte) pour éliminer les injections.
- Échappement systématique des données affichées (protection contre les injections de script).
- Navigation externe et ouverture de liens bloquées par défaut ; outils de développement désactivés en production.
- Droits minimaux sur le système de fichiers, accès limité au dossier de données de l'application.

### B.6 Chaîne de livraison et mises à jour

- **Signature numérique** du setup.exe (certificat de signature de code) pour éviter les alertes Windows SmartScreen et garantir l'origine.
- Mises à jour signées et vérifiées avant installation, avec retour arrière possible.
- Sauvegarde automatique de la base avant toute migration.
- Audit régulier des dépendances (npm audit ou équivalent), versions figées, aucune bibliothèque abandonnée.
- Option de **licence liée à la machine** pour empêcher la copie non autorisée (selon le modèle commercial).

### B.7 Sauvegarde et continuité

- Règle **3-2-1** recommandée : 3 copies, sur 2 supports différents, dont 1 hors du magasin.
- Test de restauration inclus dans la recette.
- Procédure documentée en cas de vol, panne ou infection de l'ordinateur.

### B.8 Tests de sécurité et critères d'acceptation

- Revue de code orientée sécurité et analyse statique automatisée.
- Tests d'intrusion simples avant livraison : contournement des rôles, injection SQL, tentative de lecture de la base hors application, modification manuelle d'une sauvegarde.
- **Critères d'acceptation** : base illisible sans la clé, aucune action sensible possible sans le bon rôle, toute altération du journal d'audit détectée, installateur signé, restauration testée avec succès.

## Annexe C – Décisions techniques retenues

Ces choix sont figés pour la réalisation afin d'éviter les hésitations et de garantir une base cohérente.

### C.1 Pile technique

| Domaine | Choix |
| --- | --- |
| **Application bureau** | Electron (dernière version stable), Node.js LTS, TypeScript en mode strict |
| **Interface** | React 18, Vite, Tailwind CSS, composants shadcn/ui (Radix), icônes lucide-react |
| **État et formulaires** | Zustand, React Hook Form, validation Zod |
| **Tableaux et listes** | TanStack Table et TanStack Virtual (listes virtualisées) |
| **Graphiques** | Recharts |
| **Base de données** | SQLite chiffré via better-sqlite3-multiple-ciphers (SQLCipher), mode WAL, migrations SQL numérotées |
| **Mots de passe** | Argon2id |
| **Impression** | Tickets ESC/POS (node-thermal-printer), factures PDF (pdfmake ou impression Electron) |
| **Codes-barres** | JsBarcode ou bwip-js pour les étiquettes ; lecteurs USB en mode clavier |
| **Exports** | exceljs (Excel), CSV, PDF |
| **Installateur** | electron-builder (NSIS) pour le setup.exe, electron-updater pour les mises à jour |
| **Tests** | Vitest (logique métier), Playwright (parcours de bout en bout) |
| **Qualité** | ESLint, Prettier, TypeScript strict, Git avec commits par fonctionnalité |

### C.2 Architecture logicielle

- **Processus principal** (Electron main) : accès à la base, services métier, authentification, impression, sauvegardes.
- **Preload** : unique pont (contextBridge) exposant une API typée et limitée.
- **Interface** (renderer) : aucun accès direct à Node, à la base ni au système de fichiers.
- **Couches** : interface → API IPC validée → services métier → dépôts de données → SQLite.
- Toute modification de stock passe par une fonction unique de mouvement de stock, dans une transaction.
- Montants stockés en entiers (plus petite unité de la devise) ; devise configurable (par défaut FCFA, sans décimales).

### C.3 Structure de projet recommandée

```text
/src/main        services, dépôts, IPC, sécurité, impression, sauvegardes
/src/preload     pont sécurisé contextBridge
/src/renderer    pages, composants, hooks, thème, i18n (fr)
/src/shared      types, schémas Zod, constantes, droits des rôles
/db/migrations   scripts SQL versionnés
/docs            cahier des charges, guide utilisateur, guide technique
/tests           unitaires et bout en bout
```

## Annexe E – Conception de la base de données

La base est le cœur de l'application : elle doit garantir qu'aucune vente, aucun mouvement de stock ni aucun paiement ne puisse devenir incohérent, même en cas de coupure de courant ou d'erreur de saisie. Les règles d'intégrité sont portées **par la base elle-même** (clés, contraintes, triggers) et pas seulement par le code.

### E.1 Conventions générales

| Sujet | Règle |
| --- | --- |
| **Moteur** | SQLite 3 chiffré (SQLCipher), tables déclarées `STRICT` (types vérifiés) |
| **Réglages à chaque ouverture** | `foreign_keys = ON`, `journal_mode = WAL`, `synchronous = FULL` (sûr en cas de coupure), `busy_timeout = 5000` |
| **Nommage** | `snake_case`, tables au pluriel (`products`), colonnes au singulier, clé étrangère `<table_singulier>_id` |
| **Clés primaires** | `id INTEGER PRIMARY KEY` partout ; les tables de liaison utilisent une clé composite |
| **Dates** | Texte ISO 8601 en UTC (`2026-11-08T14:30:00Z`), converties en heure locale à l'affichage |
| **Montants** | Entiers dans la plus petite unité de la devise, jamais de décimaux flottants |
| **Taux (taxe, remise en %)** | Entiers en centièmes de pourcent (1800 = 18 %) |
| **Booléens** | `INTEGER` avec `CHECK (col IN (0,1))` |
| **Énumérations** | `TEXT` avec `CHECK (col IN (...))` ou table de référence |
| **Suppression** | Aucun `DELETE` sur les données métier : archivage logique (`is_active`, `archived_at`). Clés étrangères en `ON DELETE RESTRICT` par défaut |
| **Colonnes standard** | `created_at`, `updated_at`, `created_by` sur toutes les tables modifiables |
| **Instantanés** | Une ligne de vente conserve le prix, le coût et la taxe au moment de la vente (un changement de prix futur ne modifie jamais l'historique) |
| **Normalisation** | 3e forme normale ; seule dénormalisation admise : le stock courant (`stock_levels`), tenu par trigger et recalculable à tout moment depuis `stock_movements` |

### E.2 Tables par domaine

#### Sécurité et audit

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `roles` | `id`, `code` (admin, manager, seller), `name` | `code` unique |
| `permissions` | `id`, `code` (ex. `sale.cancel`, `price.edit`, `cost.view`), `description` | `code` unique |
| `role_permissions` | `role_id`, `permission_id` | clé composite ; clés étrangères vers `roles` et `permissions` |
| `users` | `id`, `username`, `full_name`, `password_hash`, `pin_hash`, `role_id`, `is_active`, `must_change_password`, `failed_attempts`, `locked_until`, `last_login_at` | `username` unique (insensible à la casse) ; `role_id` obligatoire |
| `audit_log` | `id`, `user_id`, `action`, `entity_type`, `entity_id`, `details` (JSON), `created_at`, `prev_hash`, `hash` | écriture seule (voir E.4) ; `hash` = empreinte de la ligne + `prev_hash` |

#### Catalogue

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `brands` | `id`, `name`, `logo_path`, `is_active` | `name` unique |
| `categories` | `id`, `name`, `parent_id`, `default_tracking_mode`, `default_warranty_months`, `is_active` | `parent_id` vers `categories` ; unicité `(parent_id, name)` ; les catégories de premier niveau sont les familles (téléphonie, électronique et audio, électroménager, énergie solaire) ; les valeurs par défaut sont reprises à la création d'un produit |
| `tax_rates` | `id`, `name`, `rate` | `rate` entre 0 et 10000 |
| `products` | `id`, `name`, `brand_id`, `category_id`, `model`, `description`, `product_type` (phone, accessory, electronics, appliance, solar, part, service, kit), `tracking_mode` (none, serial, imei), `is_stocked`, `tax_rate_id`, `reorder_level`, `warranty_months`, `weight_kg`, `image_path`, `is_active` | `product_type = 'phone'` impose `tracking_mode = 'imei'` ; `service` et `kit` imposent `is_stocked = 0` ; `reorder_level >= 0` ; `warranty_months >= 0` |
| `product_variants` | `id`, `product_id`, `sku`, `barcode`, `color`, `storage_gb`, `ram_gb`, `condition` (new, refurbished, used), `cost_price`, `avg_cost`, `sale_price`, `min_sale_price`, `is_active` | `sku` unique ; `barcode` unique si renseigné ; prix `>= 0` ; unicité de la combinaison `(product_id, color, storage_gb, ram_gb, condition)` ; `storage_gb` et `ram_gb` facultatifs (téléphones) |
| `serial_units` | `id`, `variant_id`, `serial_number`, `imei2`, `status` (in\_stock, reserved, sold, returned, defective), `receipt_line_id`, `sale_line_id`, `received_at`, `sold_at`, `warranty_end` | `serial_number` unique et obligatoire (IMEI 1 pour un téléphone) ; `imei2` unique si renseigné ; format et contrôle Luhn à 15 chiffres uniquement pour le mode `imei` ; `sale_line_id` obligatoire si `status = 'sold'` |

#### Stock

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `stock_locations` | `id`, `name`, `is_default`, `is_active` | `name` unique ; un seul emplacement par défaut |
| `stock_levels` | `variant_id`, `location_id`, `quantity` | clé composite ; `quantity >= 0` ; mise à jour **uniquement par trigger** |
| `stock_movements` | `id`, `variant_id`, `location_id`, `serial_unit_id`, `movement_type`, `quantity_delta` (signé), `unit_cost`, `quantity_after`, `reference_type`, `reference_id`, `reason`, `user_id`, `created_at` | `movement_type` dans (purchase, sale, sale\_return, purchase\_return, adjustment, inventory, loss, damage, theft, internal\_use, transfer\_in, transfer\_out) ; `quantity_delta <> 0` ; immuable |

#### Fournisseurs et achats

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `suppliers` | `id`, `name`, `phone`, `email`, `address`, `notes`, `is_active` | `name` unique |
| `goods_receipts` | `id`, `number`, `supplier_id`, `received_at`, `total_cost`, `status` (draft, validated, cancelled), `notes`, `user_id` | `number` unique ; `total_cost >= 0` ; création des mouvements de stock à la validation |
| `goods_receipt_lines` | `id`, `receipt_id`, `variant_id`, `quantity`, `unit_cost` | `quantity > 0` ; `unit_cost >= 0` |
| `supplier_payments` | `id`, `supplier_id`, `receipt_id`, `amount`, `method`, `reference`, `paid_at`, `user_id` | `amount > 0` |

#### Clients

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `customers` | `id`, `full_name`, `phone`, `address`, `credit_limit`, `notes`, `is_active` | `phone` unique si renseigné ; `credit_limit >= 0` |

Le solde dû d'un client n'est pas stocké : il est calculé par la vue `v_customer_balances` (total des ventes moins paiements reçus), ce qui évite toute incohérence.

#### Ventes et paiements

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `invoice_sequences` | `year`, `last_number` | clé primaire `year` ; incrément dans la même transaction que la vente (numérotation sans trou) |
| `sales` | `id`, `invoice_number`, `status` (held, completed, cancelled), `customer_id`, `user_id`, `cash_session_id`, `subtotal`, `discount_total`, `tax_total`, `total`, `amount_paid`, `created_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `cancelled_by` | `invoice_number` unique ; `total = subtotal - discount_total + tax_total` vérifié ; `amount_paid <= total` ; client obligatoire si `amount_paid < total` (crédit) |
| `sale_lines` | `id`, `sale_id`, `variant_id`, `serial_unit_id`, `quantity`, `unit_price`, `unit_cost`, `discount`, `tax_rate`, `line_total` | `quantity > 0` ; `serial_unit_id` obligatoire pour un produit suivi par IMEI et alors `quantity = 1` ; `unit_cost` figé |
| `payments` | `id`, `sale_id`, `method`, `amount`, `reference`, `cash_session_id`, `user_id`, `paid_at` | `method` dans (cash, card, mobile\_money, transfer, cheque) ; `amount > 0` ; immuable |
| `sale_returns` | `id`, `number`, `sale_id`, `reason`, `refund_amount`, `refund_method`, `user_id`, `created_at` | `number` unique ; `refund_amount >= 0` |
| `sale_return_lines` | `id`, `return_id`, `sale_line_id`, `quantity`, `restock`, `amount` | quantité retournée `<=` quantité vendue (trigger) |

#### Caisse

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `cash_sessions` | `id`, `opened_by`, `opened_at`, `opening_float`, `closed_by`, `closed_at`, `expected_amount`, `counted_amount`, `difference`, `status` (open, closed) | une seule session ouverte à la fois par poste |
| `cash_movements` | `id`, `cash_session_id`, `direction` (in, out), `amount`, `reason`, `user_id`, `created_at` | `amount > 0` ; motif obligatoire |

#### Inventaire

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `inventory_sessions` | `id`, `name`, `scope_type` (all, brand, category), `scope_id`, `status` (draft, counting, review, validated, cancelled), `created_by`, `validated_by`, `created_at`, `validated_at` | validation par un rôle autorisé, jamais par le créateur seul si l'option de double contrôle est active |
| `inventory_lines` | `id`, `session_id`, `variant_id`, `location_id`, `expected_quantity`, `counted_quantity`, `difference`, `note` | unicité `(session_id, variant_id, location_id)` ; `difference = counted - expected` ; `expected_quantity` figé à l'ouverture |

#### Système

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `settings` | `key`, `value`, `updated_at` | `key` clé primaire (boutique, devise, tickets, délai de verrouillage, etc.) |
| `backup_log` | `id`, `type` (auto, manual), `path`, `size_bytes`, `checksum`, `status`, `created_at` | sert au rappel de sauvegarde externe |
| `schema_migrations` | `version`, `name`, `checksum`, `applied_at` | une version appliquée une seule fois ; empreinte vérifiée au démarrage |

#### Caractéristiques techniques et kits

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `attribute_definitions` | `id`, `category_id`, `code`, `label`, `value_type` (text, number, choice, boolean), `unit` (Wc, V, A, Ah, W, pouces...), `choices` (JSON), `is_required`, `is_filterable`, `sort_order` | unicité `(category_id, code)` ; les sous-catégories héritent des attributs de leur catégorie parente |
| `product_attribute_values` | `product_id`, `attribute_id`, `value_text`, `value_number` | clé composite ; une seule des deux valeurs renseignée selon `value_type` ; `value_number` indexé pour filtrer (par exemple panneaux de 400 Wc ou plus) |
| `kit_components` | `id`, `kit_variant_id`, `component_variant_id`, `quantity` | `quantity > 0` ; unicité `(kit_variant_id, component_variant_id)` ; un kit ne peut pas se contenir lui-même (trigger) ; un kit n'a pas de stock propre |

#### Devis, échéanciers et livraisons

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `quotes` | `id`, `number`, `customer_id`, `user_id`, `status` (draft, sent, accepted, expired, converted), `valid_until`, `subtotal`, `discount_total`, `tax_total`, `total`, `reserve_stock`, `notes`, `converted_sale_id`, `created_at` | `number` unique ; totaux cohérents ; non modifiable une fois `converted` |
| `quote_lines` | `id`, `quote_id`, `variant_id`, `description`, `quantity`, `unit_price`, `discount`, `tax_rate`, `line_total` | `quantity > 0` |
| `sale_installments` | `id`, `sale_id`, `due_date`, `amount`, `paid_amount`, `status` (pending, partial, paid, overdue) | `amount > 0` ; `paid_amount <= amount` ; somme des échéances = solde dû à la création de la vente |
| `deliveries` | `id`, `sale_id`, `address`, `status` (to\_deliver, delivered, cancelled), `scheduled_at`, `delivered_at`, `delivered_by`, `notes` | `delivered_at` obligatoire si `status = 'delivered'` |

#### Garantie et SAV

| Table | Colonnes principales | Contraintes clés |
| --- | --- | --- |
| `warranty_claims` | `id`, `serial_unit_id`, `sale_id`, `customer_id`, `supplier_id`, `issue`, `status` (received, sent\_to\_supplier, repaired, replaced, rejected, closed), `resolution`, `opened_at`, `closed_at`, `user_id` | `serial_unit_id` obligatoire ; période de garantie vérifiée à l'ouverture (date de vente + durée du produit) avec alerte si expirée |

#### Compléments aux tables de ventes

| Table | Colonnes ajoutées | Règle |
| --- | --- | --- |
| `sales` | `quote_id`, `due_date`, `delivery_required` | `due_date` obligatoire pour une vente à crédit |
| `sale_lines` | `parent_line_id`, `line_type` (item, kit, kit\_component, service) | un composant référence sa ligne de kit ; seuls les composants créent des mouvements de stock, jamais le kit lui-même ni les services |

### E.3 Relations principales

- Une **marque** et une **catégorie** regroupent plusieurs **produits** ; un produit a plusieurs **variantes** (couleur, stockage, état).
- Une variante suivie par IMEI a plusieurs **unités** (`serial_units`), une par téléphone physique.
- Chaque **entrée** (`goods_receipt_lines`), **vente** (`sale_lines`), **retour**, **perte** ou **inventaire validé** crée un ou plusieurs **mouvements de stock** ; le stock courant en découle.
- Une **vente** appartient à un utilisateur, à une session de caisse et éventuellement à un client ; elle a plusieurs lignes et plusieurs **paiements**.
- Un **retour** référence les lignes de la vente d'origine.
- Un **inventaire** compare `inventory_lines` aux niveaux de stock puis génère des mouvements de type `inventory`.
- Toute action sensible écrit une ligne chaînée dans `audit_log`.

* Une **catégorie** définit des **attributs** techniques ; chaque produit porte les valeurs de ces attributs.
* Un **kit** référence ses **composants** ; sa vente génère une ligne par composant et un mouvement de stock pour chacun.
* Un **devis** peut être converti en **vente** ; une vente à crédit génère des **échéances** et éventuellement une **livraison**.
* Une **réclamation de garantie** référence l'unité vendue (numéro de série) et la vente d'origine.

### E.4 Contraintes d'intégrité et triggers

| Règle | Mise en œuvre |
| --- | --- |
| Stock jamais négatif | `CHECK (quantity >= 0)` sur `stock_levels` ; une dérogation autorisée passe par un mouvement `adjustment` explicite avec motif |
| Stock courant fiable | Trigger `AFTER INSERT` sur `stock_movements` qui met à jour `stock_levels` et renseigne `quantity_after` ; aucune autre écriture sur `stock_levels` |
| Mouvements immuables | Triggers `BEFORE UPDATE` et `BEFORE DELETE` sur `stock_movements`, `payments`, `audit_log`, `invoice_sequences` (suppression) qui refusent l'opération |
| Ventes finalisées verrouillées | Trigger refusant la modification des lignes d'une vente `completed` ou `cancelled` |
| Numéro de série cohérent | Trigger : une unité passe à `sold` uniquement si elle est `in_stock` ou `reserved` ; un IMEI ou numéro de série ne peut pas être vendu deux fois ; un produit en mode `serial` ou `imei` exige une unité sur chaque ligne de vente |
| Retour limité | Trigger : la somme des quantités retournées d'une ligne ne dépasse jamais la quantité vendue |
| Kits | À la validation, un kit est éclaté en lignes de composants ; le stock de tous les composants est vérifié avant validation et une insuffisance bloque la vente entière ; un kit ne peut pas contenir un autre kit |
| Services et kits sans stock | Aucun mouvement de stock n'est créé pour un produit dont `is_stocked = 0` |
| Devis | Un devis `converted` est figé ; si `reserve_stock = 1`, les unités concernées passent à `reserved` jusqu'à la date de validité, puis sont libérées automatiquement |
| Échéancier | Somme des échéances = solde dû à la création de la vente ; statut `overdue` calculé à partir de `due_date` |
| Garantie | Une réclamation ne peut être ouverte que sur une unité `sold` ; alerte si la date de fin de garantie est dépassée |
| Totaux cohérents | Contrôle à la validation de la vente : somme des lignes = `subtotal`, somme des paiements = `amount_paid` |
| Journal chaîné | Chaque insertion dans `audit_log` calcule `hash = SHA-256(prev_hash + contenu)` ; une vérification complète est lancée à la demande et au démarrage |
| Coût moyen pondéré | Recalculé dans la même transaction que chaque entrée de stock (`avg_cost`) |
| Une transaction par opération | Vente, retour, entrée, inventaire : tout ou rien |

### E.5 Index

| Table | Index | Usage |
| --- | --- | --- |
| `product_variants` | `barcode` (unique), `sku` (unique), `product_id` | scan en caisse, recherche |
| `products` | `brand_id`, `category_id`, `product_type`, `is_active` | filtres du catalogue par famille et marque |
| `serial_units` | `serial_number` (unique), `imei2` (unique), `(variant_id, status)` | recherche par numéro de série ou IMEI, unités disponibles |
| `product_attribute_values` | `(attribute_id, value_number)`, `(attribute_id, value_text)` | filtres techniques (puissance, tension, taille d'écran) |
| `kit_components` | `kit_variant_id`, `component_variant_id` | composition des kits, éclatement à la vente |
| `stock_levels` | `location_id` | stock par emplacement |
| `stock_movements` | `(variant_id, created_at)`, `(reference_type, reference_id)`, `created_at` | historique et rapports |
| `sales` | `invoice_number` (unique), `created_at`, `customer_id`, `user_id`, `status`, `due_date` | historique, rapports, crédits |
| `sale_lines` | `sale_id`, `variant_id`, `parent_line_id` | détail et statistiques de vente |
| `sale_installments` | `(status, due_date)`, `sale_id` | échéances à venir et en retard |
| `quotes` | `number` (unique), `customer_id`, `(status, valid_until)` | suivi des devis |
| `deliveries` | `(status, scheduled_at)`, `sale_id` | livraisons à faire |
| `warranty_claims` | `serial_unit_id`, `status` | suivi des garanties |
| `payments` | `sale_id`, `(cash_session_id, method)` | clôture de caisse |
| `audit_log` | `created_at`, `(entity_type, entity_id)`, `user_id` | consultation de l'audit |
| `customers` | `phone`, `full_name` | recherche rapide en caisse |

Une table virtuelle de recherche plein texte (**FTS5**) `products_fts` indexe nom, marque, modèle, SKU et code-barres pour une recherche instantanée tolérante aux accents et aux fautes de frappe courantes ; elle est tenue à jour par trigger.

### E.6 Vues de lecture

| Vue | Rôle |
| --- | --- |
| `v_stock_overview` | stock total par variante avec marque, catégorie et valeur au coût moyen |
| `v_low_stock` | variantes dont le stock est inférieur ou égal au seuil d'alerte |
| `v_sales_margin` | ventes avec coût, marge brute et marge en % (réservée aux rôles autorisés) |
| `v_customer_balances` | solde dû par client |
| `v_supplier_balances` | solde dû par fournisseur |
| `v_cash_session_summary` | totaux encaissés par mode de paiement et par session |
| `v_daily_sales` | chiffre d'affaires et bénéfice par jour |

Les vues exposant des coûts et des marges sont inaccessibles aux vendeurs au niveau du service métier.

Vues ajoutées pour les nouvelles familles : `v_sales_by_family` (ventes et marges par famille de produits), `v_overdue_installments` (échéances dépassées), `v_open_quotes` (devis en cours et expirant bientôt), `v_warranty_expiring` (garanties arrivant à terme) et `v_stock_by_location` (stock par emplacement).

### E.7 Migrations, données initiales et sauvegarde

- Migrations SQL **numérotées et immuables** (`0001_init.sql`, `0002_...`) appliquées dans l'ordre, chacune dans une transaction ; table `schema_migrations` avec empreinte pour détecter toute modification.
- **Sauvegarde automatique avant chaque migration**, restauration possible en cas d'échec.
- Aucune migration destructive sans copie préalable des données concernées.
- **Données initiales** (seed système) : rôles et permissions, modes de paiement, taux de taxe par défaut, emplacement de stock par défaut, paramètres par défaut.
- **Données de démonstration** (script séparé, jamais en production) : 20 marques, 2 000 produits, 5 000 ventes, utilisées pour les tests de performance.
- Sauvegarde par l'API de sauvegarde en ligne de SQLite (copie cohérente même base ouverte), chiffrée ensuite en AES-256, avec somme de contrôle enregistrée dans `backup_log`.
- Maintenance planifiée : `PRAGMA integrity_check` au démarrage, `PRAGMA optimize` à la fermeture, `VACUUM` mensuel après sauvegarde.

### E.8 Tests de la base de données

- Application des migrations sur une base vide, puis sur une base de démonstration.
- Tentatives de violation de chaque contrainte : stock négatif, IMEI en double, suppression d'un mouvement, modification d'un paiement, retour supérieur à la vente.
- Vérification qu'aucune vente à moitié enregistrée n'existe après une coupure simulée.
- Reconstruction du stock depuis `stock_movements` et comparaison avec `stock_levels` : aucun écart toléré.
- Vérification de la chaîne d'audit après insertion, puis après altération volontaire (doit être détectée).
- Plan d'exécution (`EXPLAIN QUERY PLAN`) des requêtes de caisse et de recherche : aucun balayage complet de table sur les tables volumineuses.
- Mesures de performance sur 50 000 produits, 100 000 ventes et 500 000 mouvements de stock.

## Annexe D – Historique des versions du document

| Version | Date | Modifications |
| --- | --- | --- |
| 1.3 | Novembre 2026 | Extension à l'électronique, l'électroménager et l'énergie solaire : familles et attributs techniques, suivi par numéro de série, kits, services, devis, échéanciers, livraisons, garantie et SAV simplifié ; base de données et planning mis à jour |
| 1.2 | Novembre 2026 | Ajout de l'Annexe E : conception détaillée de la base de données (conventions, tables, contraintes, triggers, index, vues, migrations, tests) |
| 1.1 | Novembre 2026 | Ajout des annexes A (interface), B (sécurité) et C (décisions techniques) ; pile technique figée ; exigences de sécurité renforcées |
| 1.0 | Novembre 2026 | Première version du cahier des charges |
