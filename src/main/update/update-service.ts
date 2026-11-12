import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import type { UpdateInstallInput, UpdatePreview } from '@shared/schemas/update';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { logger } from '../logging/logger';
import type { ExecutableInfo, ExecutableInspector } from './installer-inspector';

export const PRODUCT_NAME = 'Boutique Gestion';
const TOKEN_TTL_MS = 15 * 60_000;

/** Lance l'installateur vérifié puis ferme l'application (l'installateur remplace ses fichiers). */
export interface InstallerLauncher {
  launch(path: string): void;
}

export interface UpdateDependencies {
  db: Db;
  dialogs: FileDialogs;
  inspector: ExecutableInspector;
  launcher: InstallerLauncher | null;
  currentVersion: string;
  /** Exécutable de l'application en cours : sa signature sert de référence (D82). */
  currentExecutable: string;
  stagingDirectory: string;
  confirmPassword: (userId: number, password: string) => Promise<void>;
  hasBackupPassword: () => boolean;
  /** Sauvegarde chiffrée de sécurité, faite juste avant de lancer l'installateur. */
  safetyBackup: (name: string) => Promise<void>;
}

interface Staged {
  path: string;
  sha256: string;
  expires: number;
  preview: UpdatePreview;
}

/** Comparaison de versions « a.b.c » (une étiquette après « - » ou « + » est ignorée). */
export function compareVersions(left: string, right: string): number {
  const parts = (version: string) =>
    (version.split(/[-+]/)[0] ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Verdict sur un installateur (D82) : bon produit, version plus récente, et signature au moins
 * aussi sûre que celle de l'application en cours. Une application signée n'accepte qu'un
 * installateur signé par le même certificat ; une application non signée accepte un installateur
 * signé, ou non signé après accord explicite. Une signature invalide est toujours refusée.
 */
export function judgeInstaller(
  installer: ExecutableInfo,
  current: ExecutableInfo,
  currentVersion: string,
): Pick<UpdatePreview, 'verdict' | 'reason'> {
  const refuse = (reason: string) => ({ verdict: 'refused' as const, reason });
  if (installer.productName !== PRODUCT_NAME) {
    return refuse(`Ce fichier n’est pas un installateur de ${PRODUCT_NAME}.`);
  }
  if (installer.signature === 'invalid') {
    return refuse(
      'La signature de ce fichier est invalide : il a pu être modifié. Ne l’utilisez pas.',
    );
  }
  if (compareVersions(installer.productVersion, currentVersion) <= 0) {
    return refuse(
      `Cette version (${installer.productVersion}) n’est pas plus récente que la version installée (${currentVersion}).`,
    );
  }
  if (current.signature === 'valid') {
    if (installer.signature !== 'valid' || installer.thumbprint !== current.thumbprint) {
      return refuse(
        'Ce fichier n’est pas signé par l’éditeur de l’application installée : installation refusée.',
      );
    }
    return { verdict: 'ready', reason: null };
  }
  if (installer.signature === 'unsigned') {
    return {
      verdict: 'unsigned',
      reason:
        'Ce fichier n’est pas signé : son origine ne peut pas être vérifiée. Installez-le seulement s’il vient de votre fournisseur.',
    };
  }
  return { verdict: 'ready', reason: null };
}

/** Mise à jour depuis un setup.exe sur clé USB (B.6, 9 ; D82) : aucun accès réseau. */
export class UpdateService {
  private readonly staged = new Map<string, Staged>();
  private currentInfo: Promise<ExecutableInfo> | null = null;

  constructor(private readonly deps: UpdateDependencies) {}

  /** Choix du fichier, copie dans le dossier de l'application, puis vérification de la copie. */
  async choose(actor: Session): Promise<UpdatePreview | null> {
    requirePermission(actor, 'settings.manage');
    const source = await this.deps.dialogs.openFile({
      title: 'Choisir le programme d’installation de la nouvelle version',
      filters: [{ name: 'Programme d’installation', extensions: ['exe'] }],
    });
    if (source === null) return null;
    this.clearStaging();
    mkdirSync(this.deps.stagingDirectory, { recursive: true });
    // La copie vérifiée est celle qui sera lancée : remplacer le fichier de la clé ensuite est sans effet.
    const path = join(
      this.deps.stagingDirectory,
      `installateur-${randomBytes(6).toString('hex')}.exe`,
    );
    copyFileSync(source, path);
    const [installer, current] = await Promise.all([
      this.deps.inspector.inspect(path),
      this.current(),
    ]);
    const token = randomBytes(16).toString('hex');
    const preview: UpdatePreview = {
      token,
      fileName: basename(source),
      version: installer.productVersion,
      currentVersion: this.deps.currentVersion,
      signature: installer.signature,
      signer: installer.signer,
      ...judgeInstaller(installer, current, this.deps.currentVersion),
    };
    this.staged.set(token, {
      path,
      sha256: sha256(path),
      expires: Date.now() + TOKEN_TTL_MS,
      preview,
    });
    return preview;
  }

  /**
   * Installation : mot de passe de l'administrateur, copie inchangée depuis la vérification,
   * sauvegarde chiffrée de sécurité, journal d'audit, puis lancement de l'installateur.
   */
  async install(actor: Session, input: UpdateInstallInput): Promise<{ started: boolean }> {
    requirePermission(actor, 'settings.manage');
    await this.deps.confirmPassword(actor.userId, input.currentPassword);
    const staged = this.take(input.token);
    const { preview } = staged;
    if (preview.verdict === 'refused') {
      throw new AppError('VALIDATION_ERROR', preview.reason ?? 'Installation refusée.');
    }
    if (preview.verdict === 'unsigned' && !input.acceptUnsigned) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Confirmez que ce fichier non signé vient bien de votre fournisseur.',
      );
    }
    if (sha256(staged.path) !== staged.sha256) {
      throw new AppError(
        'CONFLICT',
        'Le fichier a changé depuis sa vérification : choisissez-le de nouveau.',
      );
    }
    if (!this.deps.hasBackupPassword()) {
      throw new AppError(
        'CONFLICT',
        'Définissez d’abord le mot de passe des sauvegardes : la base est sauvegardée avant la mise à jour.',
      );
    }
    if (this.deps.launcher === null) {
      throw new AppError(
        'UNAVAILABLE',
        'La mise à jour ne peut être lancée que depuis l’application installée.',
      );
    }
    await this.deps.safetyBackup(`avant-mise-a-jour-${preview.version}`);
    appendAudit(this.deps.db, {
      userId: actor.userId,
      action: 'app.update_started',
      entityType: 'application',
      details: {
        from: preview.currentVersion,
        to: preview.version,
        signature: preview.signature,
        signer: preview.signer,
        file: preview.fileName,
      },
    });
    logger.info('Mise à jour lancée', { from: preview.currentVersion, to: preview.version });
    this.deps.launcher.launch(staged.path);
    return { started: true };
  }

  private take(token: string): Staged {
    const staged = this.staged.get(token);
    this.staged.delete(token);
    if (staged === undefined || staged.expires < Date.now()) {
      throw new AppError('NOT_FOUND', 'Choisissez de nouveau le programme d’installation.');
    }
    return staged;
  }

  private current(): Promise<ExecutableInfo> {
    this.currentInfo ??= this.deps.inspector
      .inspect(this.deps.currentExecutable)
      .catch((error: unknown) => {
        this.currentInfo = null;
        throw error;
      });
    return this.currentInfo;
  }

  /** Une seule copie en attente : les copies d'un choix précédent sont effacées. */
  private clearStaging(): void {
    this.staged.clear();
    if (!existsSync(this.deps.stagingDirectory)) return;
    for (const name of readdirSync(this.deps.stagingDirectory)) {
      if (/^installateur-[0-9a-f]+\.exe$/.test(name)) {
        rmSync(join(this.deps.stagingDirectory, name), { force: true });
      }
    }
  }
}
