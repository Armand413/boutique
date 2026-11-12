# Boutique Gestion — Guide technique

Pour le développeur ou le prestataire qui installe, construit, maintient ou fait évoluer l'application. Le cahier des
charges (`docs/CAHIER_DES_CHARGES.md`) reste la source de vérité ; les choix faits pendant la réalisation sont dans
[DECISIONS.md](DECISIONS.md) (D1 à D88), l'avancement dans [PROGRESS.md](../PROGRESS.md), la base dans
[BASE_DE_DONNEES.md](BASE_DE_DONNEES.md).

## 1. Pile technique

| Domaine              | Choix (versions figées dans `package.json`)                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Application          | Electron 45, Node.js 24 LTS, TypeScript 6 strict (aucun `any`)                           |
| Construction         | electron-vite 6 (Vite 8, rolldown)                                                       |
| Interface            | React 18, Tailwind CSS 4, composants Radix (façon shadcn/ui), lucide-react, police Inter |
| État et formulaires  | Zustand, React Hook Form, Zod 4                                                          |
| Listes et graphiques | TanStack Table et Virtual, Recharts                                                      |
| Base                 | SQLite chiffré (better-sqlite3-multiple-ciphers, SQLCipher), WAL                         |
| Sécurité             | Argon2id (@node-rs/argon2), DPAPI (`safeStorage`), AES-256-GCM (`node:crypto`)           |
| Documents            | pdfmake (PDF), exceljs (Excel), node-thermal-printer (ESC/POS), bwip-js (codes-barres)   |
| Installateur         | electron-builder 26 (NSIS)                                                               |
| Tests                | Vitest (métier, base), Playwright (bout en bout sur Electron), axe-core (WCAG AA)        |

Écart à la pile prévue : **electron-updater n'est pas utilisé**. Il ne sait télécharger que depuis un serveur HTTPS ;
la boutique est hors ligne. La mise à jour passe par un setup.exe vérifié par l'application (D82, §8).

## 2. Architecture

```
src/main       processus principal : services métier, dépôts, IPC, sécurité, impression, sauvegardes
src/preload    unique pont contextBridge : window.api.invoke(canal, entrée)
src/renderer   interface React uniquement (aucun accès à Node, au disque ni à la base)
src/shared     types, schémas Zod, contrat IPC, permissions, formats (montants, dates)
db/templates   sources des migrations ; db/migrations : migrations générées, immuables
tools/demo     générateur de données de démonstration et de charge (jamais empaqueté)
scripts        génération des migrations, icône, documentation de la base, test de l'application installée
tests          unit (Vitest), e2e (Playwright), load (charge)
```

**Chaîne obligatoire** : interface → `window.api.invoke` → `ipcMain` (origine vérifiée, canal listé, entrée validée par
Zod, accès contrôlé) → service métier (permissions **revérifiées**) → SQLite. La réponse est elle aussi validée par
Zod avant de repartir vers l'interface.

Modules du processus principal :

| Dossier                 | Rôle                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `system/runtime.ts`     | cycle de vie de la base (clé, ouverture, migrations, intégrité, services), restauration         |
| `db`                    | connexion chiffrée, migrations, seed système, copie de fichier, erreurs SQLite lisibles         |
| `auth`, `audit`         | Argon2id, sessions, PIN, verrouillage, récupération ; journal chaîné                            |
| `ipc`                   | contrat, autorisation, distribution, gestionnaires                                              |
| `security`              | fenêtre, protocole `app://`, CSP, gardes (réseau, navigation, permissions), DPAPI               |
| `catalog`, `stock`      | produits, caractéristiques, kits, import/export, étiquettes ; mouvements, entrées, fournisseurs |
| `sales`                 | caisse, panier, ventes, paiements, retours, clients, devis, échéances, livraisons               |
| `inventory`, `warranty` | inventaires ; garantie et SAV                                                                   |
| `reports`               | rapports et tableau de bord, calculés dans un **thread** (`report-worker.js`, lecture seule)    |
| `backup`, `settings`    | sauvegardes chiffrées, restauration ; paramètres                                                |
| `printing`              | ticket ESC/POS (imprimante réseau ou simulateur), PDF (facture, devis, bons)                    |
| `update`                | mise à jour par setup.exe (vérification Authenticode)                                           |

**Une seule fonction de mouvement de stock** (`src/main/stock/movements.ts`, `applyMovement`), appelée dans la
transaction de l'opération ; la base refuse toute autre écriture de stock. **Une vente** (panier, paiements, mouvements,
unités, échéances, livraison, facture) est **une transaction**.

## 3. Sécurité

- **Electron** : `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity` ; interface servie par le
  protocole privé `app://renderer` avec en-têtes de sécurité et CSP stricte (aussi en `<meta>`) ; réseau sortant,
  navigation externe, nouvelles fenêtres, `webview` et permissions refusés ; DevTools et menu absents de
  l'application installée ; instance unique.
- **IPC** : liste fermée de canaux (`src/shared/ipc/channels.ts`), contrat d'accès par canal (`public`, session,
  permission) dans `src/shared/ipc/contract.ts`, validation Zod des entrées et des sorties, erreurs traduites sans
  détail technique. Les chemins de fichiers sont toujours choisis par le processus principal (boîtes de dialogue) ;
  l'interface ne manipule que des jetons.
- **Données** : base SQLCipher (clé de 256 bits sous DPAPI, séquestre sous la clé de récupération), sauvegardes
  AES-256-GCM, SQL toujours paramétré, recherche FTS échappée, aucune donnée sensible dans les journaux (masquage).
- **Droits** : contrôlés dans les services ; coûts et marges retirés des réponses, rapports et exports sans
  `cost.view`. Tests d'intrusion automatisés : `tests/unit/security` (D79).

## 4. Poste de développement

Prérequis : Windows 10/11 64 bits, Node.js 24, Git. Aucun compilateur C++ n'est nécessaire : les modules natifs
(better-sqlite3-multiple-ciphers, @node-rs/argon2) sont des binaires N-API précompilés, valables pour Node comme pour
Electron. Les scripts d'installation des dépendances sont désactivés (`allowScripts`).

```bash
npm ci
```

| Commande                | Effet                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | application en développement, rechargement à chaud                                                                                           |
| `npm run build`         | construction dans `out/` (main, preload, renderer, thread des rapports)                                                                      |
| `npm run typecheck`     | TypeScript sur les projets node, web et e2e                                                                                                  |
| `npm run lint`          | ESLint (0 avertissement toléré)                                                                                                              |
| `npm test`              | tests unitaires (métier, base, sécurité)                                                                                                     |
| `npm run test:e2e`      | build puis Playwright sur l'application compilée (profil isolé, WCAG AA)                                                                     |
| `npm run test:load`     | test de charge : 50 000 produits, 100 000 ventes, 500 000 mouvements (environ 25 min) ; `BOUTIQUE_LOAD=demo` pour l'échelle de démonstration |
| `npm run seed`          | données de démonstration dans le profil de l'application installée (base vide exigée) ; `-- --user-data <dossier>` pour un autre profil      |
| `npm run dist`          | setup.exe non signé dans `dist/`                                                                                                             |
| `npm run dist:signed`   | setup.exe signé (certificat obligatoire, voir §7)                                                                                            |
| `npm run test:packaged` | installe le setup de `dist/` en silence, teste l'application installée, la désinstalle et vérifie                                            |
| `npm run docs:db`       | régénère `docs/BASE_DE_DONNEES.schema.md` depuis les migrations                                                                              |

En développement et dans les tests, la variable `BOUTIQUE_TEST_USER_DATA` isole le profil ; elle est ignorée par
l'application installée. Pour isoler le profil d'une application installée : `BoutiqueGestion.exe
--user-data-dir=<dossier>`.

## 5. Faire évoluer la base

1. Créer `db/templates/00NN_sujet.sql` (ne jamais modifier une migration existante).
2. `node scripts/build-migrations.mjs` génère `db/migrations/00NN_sujet.sql`.
3. Ajouter les tests dans `tests/unit/db`, puis `npm run docs:db`.
4. Les migrations sont intégrées au build (`import.meta.glob`). Au premier démarrage de la nouvelle version : copie de
   la base, migration dans une transaction, empreinte enregistrée.

## 6. Construire l'installateur

`npm run dist` lit `electron-builder.yml` :

- installation **par utilisateur** (aucun droit d'administrateur), dossier modifiable, raccourcis bureau et menu
  Démarrer, lancement à la fin ;
- seuls `out/main`, `out/preload`, `out/renderer` et les dépendances de production sont empaquetés (archive asar) ;
  les modules natifs sont sortis de l'archive (`asarUnpack: **/*.node`) ; rien de `tools/`, `tests/` ni `out-demo/` ;
- la désinstallation supprime le programme, les raccourcis et l'entrée du registre, **jamais les données**
  (`deleteAppDataOnUninstall: false`, D83) ;
- icône : `build/icon.svg`, convertie par `npx electron scripts/make-icon.cjs` en `build/icon.ico`.

Installation silencieuse (déploiement) : `Boutique-Gestion-Setup-<version>.exe /S /D=C:\chemin`. Désinstallation
silencieuse : `"Uninstall BoutiqueGestion.exe" /S`.

## 7. Signature du code (configurable)

Sans certificat, l'installateur n'est pas signé : Windows SmartScreen affiche un avertissement. Pour signer
(certificat de signature de code au format `.pfx`, jamais versionné) :

```powershell
$env:CSC_LINK = "C:\certificats\editeur.pfx"
$env:CSC_KEY_PASSWORD = "<mot de passe du certificat>"
npm run dist:signed
```

`dist:signed` force la signature (`forceCodeSigning`) : sans certificat valide, la construction échoue au lieu de
produire un installateur non signé. electron-builder signe l'exécutable, le désinstallateur et le setup. Vérification :
`Get-AuthenticodeSignature .\dist\Boutique-Gestion-Setup-<version>.exe` doit afficher `Valid`. Un certificat EV ou un
service de signature (Azure Trusted Signing, option `win.azureSignOptions`) supprime l'avertissement SmartScreen dès la
première installation.

## 8. Publier une mise à jour

1. Augmenter `version` dans `package.json` (versions `majeure.mineure.correctif`).
2. `npm run dist:signed`, puis `npm run test:packaged`.
3. Remettre le setup.exe à la boutique (clé USB). L'administrateur l'installe depuis **Paramètres › Mise à jour**.

Contrôles faits par l'application (`src/main/update`, D82) :

- le fichier choisi est **copié** dans `donnees\mise-a-jour`, et c'est cette copie qui est vérifiée puis lancée
  (empreinte SHA-256 recontrôlée juste avant) ;
- `Get-AuthenticodeSignature` et les informations de version (produit « Boutique Gestion », version strictement plus
  récente) sont lus par PowerShell, le chemin passant par une variable d'environnement, jamais dans le script ;
- application signée : le setup doit être signé par le **même certificat** (empreinte) ; application non signée :
  setup signé accepté, setup non signé accepté seulement après accord explicite ; signature invalide toujours refusée ;
- mot de passe de l'administrateur, **sauvegarde chiffrée** (`avant-mise-a-jour-<version>-…bgsauv`), entrée
  `app.update_started` au journal d'audit, puis lancement de l'assistant et fermeture de l'application.

**Retour arrière** : désinstaller, réinstaller le setup précédent, restaurer la sauvegarde « avant mise à jour » si
la base a été migrée (une version ne lit pas une base d'un schéma plus récent).

## 9. Exploitation

| Élément                | Emplacement (`%APPDATA%\Boutique Gestion`)                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Base chiffrée          | `donnees\boutique.db` (+ `-wal`, `-shm`)                                                                      |
| Clé (DPAPI), séquestre | `donnees\boutique.key`, `donnees\boutique.key.recovery`                                                       |
| Clé des sauvegardes    | `donnees\boutique.backup.key` (DPAPI)                                                                         |
| Sauvegardes            | `donnees\sauvegardes\auto` (quotidiennes), `donnees\sauvegardes` (avant migration, restauration, mise à jour) |
| Images                 | `donnees\images` (logo, photos des produits)                                                                  |
| Tickets simulés        | `donnees\tickets-simules` (sans imprimante configurée)                                                        |
| Journaux techniques    | `logs\` (un fichier par jour, 14 jours, secrets masqués)                                                      |
| Préférences du poste   | `preferences.json` (thème, taille du texte, langue)                                                           |

**Changement d'ordinateur** : installer l'application sur le nouveau poste, puis restaurer une sauvegarde `.bgsauv`
depuis l'écran de bienvenue (mot de passe des sauvegardes exigé). La clé DPAPI ne se transporte pas d'un compte
Windows à l'autre : c'est la sauvegarde (qui contient la clé de la base) ou la clé de récupération qui permet de
rouvrir les données.

**Matériel** : imprimante de tickets ESC/POS en réseau (adresse IP et port dans Paramètres › Impression), lecteur de
codes-barres USB en mode clavier terminant par Entrée, imprimante A4 standard pour les PDF.

## 10. Qualité et performances mesurées

Fin de phase 10 : typecheck et lint sans erreur, 273 tests unitaires, 41 tests de bout en bout (dont l'application
installée), test de charge vert. Mesures sur 50 000 produits et 100 000 ventes : recherche < 11 ms, ajout au panier
< 1 ms, validation d'une vente 8 ms, ouverture de la base 1,2 s ; rapports de 0,1 à 4 s et tableau de bord 4,8 s,
calculés hors du thread de l'interface (voir PROGRESS.md, phase 9).

## 11. Limites connues

- Imprimante thermique réelle, tiroir-caisse, lecteur de codes-barres et imprimante d'étiquettes : implémentés derrière
  des interfaces testables (simulateur, saisie clavier) ; à valider sur le matériel.
- Signature avec un vrai certificat : configurée, non testée faute de certificat.
- DPAPI : testé sur le poste de développement ; restauration sur un autre compte Windows à refaire à la recette.
