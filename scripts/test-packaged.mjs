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
const next = join(root, 'dist-next', 'Boutique-Gestion-Setup-0.0.0-next.exe');
if (!existsSync(setup)) throw new Error(`Installateur absent : ${setup} (lancez npm run dist).`);

function nextVersion() {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

const nextSetup = next.replace('0.0.0-next', nextVersion());
if (!existsSync(nextSetup)) {
  execSync(
    `npx electron-builder --win nsis -c.extraMetadata.version=${nextVersion()} -c.directories.output=dist-next`,
    { cwd: root, stdio: 'inherit' },
  );
}

const directory = mkdtempSync(join(tmpdir(), 'boutique-installe-'));
const target = join(directory, 'app');
const executable = join(target, 'BoutiqueGestion.exe');
const uninstaller = join(target, 'Uninstall BoutiqueGestion.exe');
let testStatus = null;
try {
  execFileSync(setup, ['/S', `/D=${target}`], { stdio: 'inherit' });
  if (!existsSync(executable)) throw new Error('Installation silencieuse sans exécutable.');
  const run = spawnSync('npx playwright test tests/e2e/packaged.e2e.ts', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BOUTIQUE_PACKAGED_EXE: executable, BOUTIQUE_NEXT_SETUP: nextSetup },
  });
  testStatus = run.status;
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
  if (leftover) console.error('Désinstallation incomplète : l’exécutable est encore présent.');
  else console.log('Désinstallation vérifiée : programme supprimé.');
  process.exitCode = testStatus === 0 && !leftover ? 0 : 1;
}
