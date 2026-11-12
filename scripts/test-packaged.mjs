// `npm run test:packaged` (phase 10) : installe le setup.exe de `dist/` en silence dans un dossier
// temporaire, lance le test e2e de l'application installée (avec un setup de version suivante pour la
// mise à jour), puis désinstalle et vérifie qu'il ne reste rien du programme.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const setup = join(root, 'dist', `Boutique-Gestion-Setup-${version}.exe`);
if (!existsSync(setup)) throw new Error(`Installateur absent : ${setup} (lancez npm run dist).`);

function nextVersion() {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// Setup de la version suivante, construit à chaque essai dans un dossier temporaire neuf (même code, version + 1).
const nextDirectory = mkdtempSync(join(tmpdir(), 'boutique-suivante-'));
const nextSetup = join(nextDirectory, `Boutique-Gestion-Setup-${nextVersion()}.exe`);
execSync(
  `npx electron-builder --win nsis -c.extraMetadata.version=${nextVersion()} -c.directories.output="${nextDirectory}"`,
  { cwd: root, stdio: 'inherit' },
);

// Installation sous dist/ (ignoré par Git) : sous %TEMP%, le premier lancement d'un exécutable fraîchement installé
// peut rester bloqué par l'analyse antivirus, et Playwright n'en prend pas le contrôle (constaté sur ce poste).
const directory = mkdtempSync(join(root, 'dist', 'installe-'));
const target = join(directory, 'app');
const executable = join(target, 'BoutiqueGestion.exe');
const uninstaller = join(target, 'Uninstall BoutiqueGestion.exe');
let testStatus = null;
try {
  execFileSync(setup, ['/S', `/D=${target}`], { stdio: 'inherit' });
  // Le setup silencieux peut rendre la main avant la fin de la copie : le désinstallateur est écrit en dernier.
  for (let attempt = 0; attempt < 240 && !existsSync(uninstaller); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (!existsSync(executable) || !existsSync(uninstaller)) {
    throw new Error('Installation silencieuse incomplète.');
  }
  // Jusqu'à trois essais espacés d'une minute : sur ce poste, la prise de contrôle par Playwright d'un exécutable
  // fraîchement installé reste bloquée pendant une à trois minutes (l'application, elle, démarre normalement :
  // fenêtre en moins d'une seconde dans ses journaux). Constaté et documenté dans PROGRESS.md (phase 10).
  for (let attempt = 1; attempt <= 3 && testStatus !== 0; attempt += 1) {
    if (attempt > 1) {
      console.log(`Nouvel essai ${String(attempt)}/3 dans une minute.`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    testStatus = spawnSync('npx playwright test tests/e2e/packaged.e2e.ts', {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, BOUTIQUE_PACKAGED_EXE: executable, BOUTIQUE_NEXT_SETUP: nextSetup },
    }).status;
  }
} finally {
  if (existsSync(uninstaller)) {
    execFileSync(uninstaller, ['/S'], { stdio: 'inherit' });
    // Le désinstallateur NSIS se relance depuis un dossier temporaire : on attend la suppression.
    for (let attempt = 0; attempt < 60 && existsSync(executable); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const leftover = existsSync(executable);
  rmSync(directory, { recursive: true, force: true });
  rmSync(nextDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  if (leftover) console.error('Désinstallation incomplète : l’exécutable est encore présent.');
  else console.log('Désinstallation vérifiée : programme supprimé.');
  process.exitCode = testStatus === 0 && !leftover ? 0 : 1;
}
