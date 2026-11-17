# Bouba Store

Logiciel de gestion de boutique pour Windows : caisse, stock, inventaire, clients, devis et rapports, pour une
boutique qui vend des téléphones et accessoires, de l'électronique et de l'audio, de l'électroménager et du matériel
d'énergie solaire.

L'application s'installe avec un simple `setup.exe` et fonctionne **entièrement sans Internet**. Toutes les données
restent sur l'ordinateur de la boutique, dans une base chiffrée.

_Logiciel conçu par **2KConception**. © 2026 2KConception. Tous droits réservés._

![Tableau de bord](docs/images/tableau-de-bord.png)

## Fonctionnalités

| Domaine             | Ce que fait l'application                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Caisse**          | Choix des articles en listes successives (Famille › Catégorie › Article) ou au scanner, prix convenu avec le client, mise en attente (F8), encaissement (F4), ticket et facture         |
| **Paiements**       | Espèces, Orange Money, Moov Money, Telecel Money, Wave, ou plusieurs à la fois (paiement mixte) ; acomptes et ventes à crédit avec échéancier                                           |
| **Produits**        | Familles et catégories modifiables, caractéristiques techniques configurables (Wc, V, Ah, pouces…), variantes, kits (ex. kit solaire), services, import et export CSV/Excel, étiquettes |
| **Stock**           | Plusieurs emplacements (magasin, dépôt), entrées de marchandise, transferts, pertes et casse, alertes de stock bas, valorisation                                                        |
| **Inventaire**      | Tenu automatiquement à partir des mouvements : stock au début, entrées, ventes, autres sorties, stock restant ; contrôle physique facultatif                                            |
| **Clients**         | Fiches clients, crédits, échéances en retard                                                                                                                                            |
| **Devis**           | Devis et proformas convertibles en vente, avec réservation du stock si besoin                                                                                                           |
| **Rapports**        | Ventes par jour, mois, vendeur, famille, catégorie, marque ou produit, marges, stock, caisse ; exports PDF, Excel et CSV                                                                |
| **Tableau de bord** | Ventes du jour, de la semaine et du mois, alertes, dernières ventes ; le vendeur ne voit que les ventes du jour                                                                         |
| **Utilisateurs**    | Rôles administrateur, gérant et vendeur ; code PIN de caisse ; l'administrateur crée les comptes et fixe ou réinitialise les mots de passe                                              |
| **Contrôle**        | Journal d'audit infalsifiable (chaîné), clôture de caisse avec écart, activités sensibles signalées                                                                                     |
| **Sauvegardes**     | Sauvegardes chiffrées automatiques, sauvegarde sur clé USB, restauration ; mise à jour de l'application par clé USB                                                                     |

Modules facultatifs, désactivés par défaut (Paramètres › Modules) : fournisseurs, livraisons, garantie et SAV.

## Installer l'application

1. Copier `Bouba-Store-Setup-<version>.exe` sur l'ordinateur de la boutique (Windows 10 ou 11, 64 bits).
2. Lancer le setup et suivre l'assistant. Aucun droit administrateur n'est nécessaire.
3. Au premier lancement, créer le compte administrateur et **recopier la clé de récupération** remise à l'écran.

La désinstallation conserve toujours les données. Le mode d'emploi complet est dans
[docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) (version imprimable :
[docs/GUIDE_UTILISATEUR.pdf](docs/GUIDE_UTILISATEUR.pdf)).

## Développement

Prérequis : Windows 10/11 64 bits, Node.js 24, Git. Aucun compilateur C++ n'est nécessaire.

```bash
npm ci
```

```bash
npm run dev
```

| Commande                | Effet                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`           | application en développement, rechargement à chaud                                     |
| `npm run build`         | construction dans `out/`                                                               |
| `npm run typecheck`     | vérification TypeScript                                                                |
| `npm run lint`          | ESLint, aucun avertissement toléré                                                     |
| `npm test`              | tests unitaires (Vitest)                                                               |
| `npm run test:e2e`      | tests de bout en bout sur l'application compilée (Playwright)                          |
| `npm run test:load`     | test de charge (50 000 produits, 100 000 ventes, 500 000 mouvements)                   |
| `npm run seed`          | données de démonstration (base vide exigée)                                            |
| `npm run dist`          | installateur `dist/Bouba-Store-Setup-<version>.exe` (non signé)                        |
| `npm run dist:signed`   | installateur signé avec le certificat de 2KConception (`CSC_LINK`, `CSC_KEY_PASSWORD`) |
| `npm run test:packaged` | installe le setup en silence, teste l'application installée, puis la désinstalle       |
| `npm run docs:pdf`      | régénère le PDF du mode d'emploi                                                       |

En développement, la variable `BOUTIQUE_TEST_USER_DATA` isole le profil de données : le profil réel de
l'application installée n'est jamais touché.

## Technique

- **Pile** : Electron, TypeScript strict, React 18, Vite, Tailwind CSS, Radix, Zustand, Zod ; SQLite chiffré
  (SQLCipher) ; Argon2id ; pdfmake, exceljs ; electron-builder (NSIS).
- **Architecture** : interface (`src/renderer`) › pont typé (`src/preload`) › canaux IPC validés par Zod › services
  métier et dépôts (`src/main`) › SQLite. Types, schémas et droits partagés dans `src/shared`.
- **Base de données** : migrations SQL numérotées et immuables (`db/templates` › `db/migrations`), règles d'intégrité
  dans la base (contraintes, triggers), mouvements de stock, paiements et journal d'audit non modifiables, montants en
  entiers (FCFA par défaut).
- **Sécurité** : base chiffrée dont la clé est protégée par Windows (DPAPI), isolation du contexte et bac à sable
  Electron, CSP stricte, aucun contenu distant, droits vérifiés côté service, prix d'achat et marges cachés aux
  vendeurs, verrouillage après inactivité.

## Documentation

| Document                                                 | Contenu                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md)   | mode d'emploi pour le patron, le gérant et les vendeurs       |
| [docs/GUIDE_TECHNIQUE.md](docs/GUIDE_TECHNIQUE.md)       | architecture, sécurité, installateur, signature, mises à jour |
| [docs/BASE_DE_DONNEES.md](docs/BASE_DE_DONNEES.md)       | schéma de la base et diagramme                                |
| [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md) | cahier des charges (source de vérité)                         |
| [docs/DECISIONS.md](docs/DECISIONS.md)                   | décisions prises en cours de réalisation                      |
| [PROGRESS.md](PROGRESS.md)                               | avancement, phase par phase                                   |
| [docs/RAPPORT_FINAL.md](docs/RAPPORT_FINAL.md)           | rapport final, exigence par exigence                          |

## Limites connues

- L'imprimante thermique, le tiroir-caisse et le lecteur de codes-barres sont pris en charge mais restent à valider
  sur le matériel réel.
- La signature de l'installateur au nom de 2KConception demande un certificat de signature de code (voir
  [docs/GUIDE_TECHNIQUE.md](docs/GUIDE_TECHNIQUE.md) §7) ; sans lui, Windows affiche « Éditeur inconnu ».

## Licence

Logiciel propriétaire de **2KConception**. Toute copie, diffusion ou modification sans autorisation écrite de
2KConception est interdite.
