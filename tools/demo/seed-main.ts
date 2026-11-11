/**
 * `npm run seed` : remplit la base de l'application avec les données de démonstration (E.7 :
 * 20 marques, 2 000 produits, 5 000 ventes). Script Electron séparé (clé de la base sous DPAPI),
 * construit dans `out-demo/`, jamais empaqueté dans l'application installée.
 *
 * Option : `--user-data <dossier>` (profil de l'application, qui contient `donnees/` ; par défaut celui
 * de l'application installée). La clé de la base est scellée par `safeStorage`, dont la clé maîtresse
 * vit dans ce profil : le script et l'application doivent partager le même. Une base qui contient
 * déjà des produits est refusée.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { SessionManager, type Session } from '../../src/main/auth/session';
import { electronFileDialogs } from '../../src/main/files/file-dialogs';
import { InlineExecutor } from '../../src/main/reports/report-executor';
import { safeStorageProtector } from '../../src/main/security/safe-storage';
import { AppRuntime, type Services } from '../../src/main/system/runtime';
import { DEMO_SCALE, generate } from './generator';

const PRODUCT_NAME = 'Boutique Gestion';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function demoPassword(): string {
  return `Vitrine-${randomBytes(6).toString('hex')}-Plateau`;
}

function sessionFor(manager: SessionManager, services: Services, username: string): Session {
  const user = services.db
    .prepare<[string], { id: number; full_name: string; role: 'admin' | 'manager' | 'seller' }>(
      `SELECT u.id, u.full_name, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
    )
    .get(username);
  if (user === undefined) throw new Error(`Utilisateur introuvable : ${username}`);
  return manager.start({
    userId: user.id,
    username,
    fullName: user.full_name,
    role: user.role,
    method: 'password',
    mustChangePassword: false,
    idleLockMs: 3_600_000,
  });
}

async function seed(): Promise<number> {
  const dataDirectory = join(app.getPath('userData'), 'donnees');
  say(`Dossier de données : ${dataDirectory}`);
  const runtime = new AppRuntime({
    dataDirectory,
    protector: safeStorageProtector,
    dialogs: electronFileDialogs,
    appVersion: app.getVersion(),
    executorFactory: (db) => new InlineExecutor(db),
  });
  const status = await runtime.start();
  if (status.state !== 'ready') {
    say(`Base inutilisable (${status.state}) : ouvrez d’abord l’application.`);
    return 1;
  }
  const services = runtime.requireServices();
  try {
    if (services.db.prepare('SELECT count(*) FROM products').pluck().get() !== 0) {
      say(
        'La base contient déjà des produits : les données de démonstration ne s’ajoutent qu’à une base vierge.',
      );
      return 1;
    }
    let adminName: string;
    if (!status.setupCompleted) {
      const password = demoPassword();
      const recoveryKey = await services.setup.complete({
        shopName: 'Boutique de démonstration',
        fullName: 'Administrateur démo',
        username: 'demo',
        password,
      });
      adminName = 'demo';
      say(`Compte administrateur : demo / ${password}`);
      say(`Clé de récupération (à noter) : ${recoveryKey}`);
    } else {
      adminName =
        services.db
          .prepare<[], string>(
            "SELECT u.username FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' AND u.is_active = 1 ORDER BY u.id LIMIT 1",
          )
          .pluck()
          .get() ?? '';
    }
    const manager = new SessionManager();
    const admin = sessionFor(manager, services, adminName);
    const sellers: Session[] = [];
    for (const [username, fullName] of [
      ['awa', 'Awa Kouamé'],
      ['koffi', 'Koffi N’Guessan'],
      ['yao', 'Yao Bamba'],
    ] as const) {
      const temporary = demoPassword();
      await services.users.create(admin, {
        username,
        fullName,
        role: 'seller',
        temporaryPassword: temporary,
      });
      say(`Vendeur : ${username} / ${temporary} (à changer à la première connexion)`);
      sellers.push(sessionFor(manager, services, username));
    }
    const summary = await generate(services, { admin, sellers }, DEMO_SCALE, (message) =>
      say(message),
    );
    say(`Terminé : ${JSON.stringify(summary)}`);
    return 0;
  } finally {
    runtime.close();
  }
}

app.setName(PRODUCT_NAME);
app.setPath('userData', argument('--user-data') ?? join(app.getPath('appData'), PRODUCT_NAME));
if (!app.requestSingleInstanceLock()) {
  say('Fermez Boutique Gestion avant de charger les données de démonstration.');
  app.exit(1);
} else {
  app
    .whenReady()
    .then(seed)
    .then(
      (code) => app.exit(code),
      (error: unknown) => {
        say(`Échec : ${error instanceof Error ? error.message : String(error)}`);
        app.exit(1);
      },
    );
}
