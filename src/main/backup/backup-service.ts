import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { nowIsoUtc } from '@shared/format/date';
import { AppError } from '@shared/ipc/errors';
import type { BackupSettingsInput, BackupStatus } from '@shared/schemas/backup';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import { assertPasswordAcceptable } from '../auth/credentials';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { logger } from '../logging/logger';
import type { ReportExecutor } from '../reports/report-executor';
import { getSetting, setSetting } from '../settings/settings-repository';
import { BACKUP_EXTENSION, encodeBackup, fileChecksum } from './backup-format';
import type { BackupSecretStore } from './backup-secret';

export interface BackupDependencies {
  db: Db;
  executor: ReportExecutor;
  secrets: BackupSecretStore;
  databaseKey: Buffer;
  escrowPath: string;
  /** Dossier `donnees/sauvegardes` ; les copies automatiques vont dans `auto/`. */
  directory: string;
  dialogs: FileDialogs;
  appVersion: string;
  confirmPassword: (userId: number, password: string) => Promise<void>;
  clock?: () => Date;
}

const DAY_MS = 86_400_000;
const AUTO_PATTERN = new RegExp(`^sauvegarde-auto-.+\\.${BACKUP_EXTENSION}$`);

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Sauvegardes (4.10, B.3, B.7) : copie cohérente faite par le thread en lecture seule, chiffrée
 * AES-256-GCM sous le mot de passe du propriétaire, empreinte enregistrée dans `backup_log`.
 */
export class BackupService {
  private running = false;

  constructor(private readonly deps: BackupDependencies) {}

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  get autoDirectory(): string {
    return join(this.deps.directory, 'auto');
  }

  status(actor: Session): BackupStatus {
    requirePermission(actor, 'backup.manage');
    return this.readStatus();
  }

  /** Vrai si un rappel de sauvegarde externe est dû (affiché au gérant de la sauvegarde). */
  readStatus(): BackupStatus {
    const { db } = this.deps;
    const last = (type: 'auto' | 'manual') =>
      db
        .prepare<[string], string>(
          "SELECT max(created_at) FROM backup_log WHERE type = ? AND status = 'success'",
        )
        .pluck()
        .get(type) ?? null;
    const lastManual = last('manual');
    const reminderDays = getSetting(db, 'backup.reminder_days', z.number().int());
    const history = db
      .prepare<
        [],
        {
          id: number;
          type: 'auto' | 'manual' | 'pre_migration';
          createdAt: string;
          path: string;
          sizeBytes: number;
          status: 'success' | 'failed';
        }
      >(
        `SELECT id, type, created_at AS createdAt, path, size_bytes AS sizeBytes, status
         FROM backup_log ORDER BY id DESC LIMIT 15`,
      )
      .all()
      .map(({ path, ...row }) => ({ ...row, fileName: basename(path) }));
    return {
      passwordSet: this.deps.secrets.has(),
      autoEnabled: getSetting(db, 'backup.auto_enabled', z.boolean()),
      keep: getSetting(db, 'backup.keep', z.number().int()),
      reminderDays,
      lastAuto: last('auto'),
      lastManual,
      reminderDue:
        lastManual === null ||
        this.now().getTime() - Date.parse(lastManual) > reminderDays * DAY_MS,
      autoDirectory: this.autoDirectory,
      history,
    };
  }

  saveSettings(actor: Session, input: BackupSettingsInput): BackupStatus {
    requirePermission(actor, 'backup.manage');
    this.deps.db.transaction(() => {
      setSetting(this.deps.db, 'backup.auto_enabled', input.autoEnabled, actor.userId);
      setSetting(this.deps.db, 'backup.keep', input.keep, actor.userId);
      setSetting(this.deps.db, 'backup.reminder_days', input.reminderDays, actor.userId);
      appendAudit(this.deps.db, {
        userId: actor.userId,
        action: 'backup.settings_changed',
        details: { ...input },
      });
    })();
    return this.readStatus();
  }

  /** Définit ou change le mot de passe des sauvegardes (mot de passe de l'utilisateur exigé). */
  async setPassword(
    actor: Session,
    currentPassword: string,
    password: string,
  ): Promise<BackupStatus> {
    requirePermission(actor, 'backup.manage');
    await this.deps.confirmPassword(actor.userId, currentPassword);
    assertPasswordAcceptable(password, actor.username);
    await this.deps.secrets.set(password);
    appendAudit(this.deps.db, { userId: actor.userId, action: 'backup.password_changed' });
    return this.readStatus();
  }

  /** Sauvegarde manuelle vers un dossier, une clé USB ou un disque externe (4.10). */
  async backupNow(actor: Session): Promise<{ saved: boolean }> {
    requirePermission(actor, 'backup.manage');
    if (!this.deps.secrets.has()) {
      throw new AppError('CONFLICT', 'Définissez d’abord le mot de passe des sauvegardes.');
    }
    const path = await this.deps.dialogs.saveFile({
      title: 'Enregistrer la sauvegarde',
      defaultName: `sauvegarde-${stamp(this.now())}.${BACKUP_EXTENSION}`,
      filters: [{ name: 'Sauvegarde Boutique Gestion', extensions: [BACKUP_EXTENSION] }],
    });
    if (path === null) return { saved: false };
    await this.createBackup('manual', path);
    appendAudit(this.deps.db, {
      userId: actor.userId,
      action: 'backup.manual',
      details: { file: basename(path) },
    });
    return { saved: true };
  }

  /**
   * Sauvegarde automatique quotidienne (4.10) : au plus une par 24 h, les `keep` dernières
   * conservées ; puis maintenance mensuelle (`VACUUM`, E.7). Sans mot de passe : rien.
   */
  async runAutomatic(): Promise<'done' | 'skipped' | 'failed'> {
    const { db } = this.deps;
    if (
      this.running ||
      !this.deps.secrets.has() ||
      !getSetting(db, 'backup.auto_enabled', z.boolean())
    ) {
      return 'skipped';
    }
    const lastAuto = this.readStatus().lastAuto;
    if (lastAuto !== null && this.now().getTime() - Date.parse(lastAuto) < DAY_MS) return 'skipped';
    this.running = true;
    try {
      mkdirSync(this.autoDirectory, { recursive: true });
      await this.createBackup(
        'auto',
        join(this.autoDirectory, `sauvegarde-auto-${stamp(this.now())}.${BACKUP_EXTENSION}`),
      );
      this.prune();
      this.monthlyVacuum();
      return 'done';
    } catch (error) {
      logger.error('Sauvegarde automatique en échec', {
        message: error instanceof Error ? error.message : 'inconnue',
      });
      return 'failed';
    } finally {
      this.running = false;
    }
  }

  /** Écrit une sauvegarde complète en `path` et l'enregistre dans `backup_log`. */
  async createBackup(
    kind: 'auto' | 'manual' | 'safety',
    path: string,
  ): Promise<{ checksum: string; sizeBytes: number }> {
    const { db } = this.deps;
    const logType = kind === 'manual' ? 'manual' : 'auto';
    try {
      const { kdf, key } = await this.deps.secrets.read();
      const database = await this.snapshot();
      const file = encodeBackup(
        {
          kind,
          createdAt: this.now().toISOString(),
          appVersion: this.deps.appVersion,
          schemaVersion:
            db.prepare<[], number>('SELECT max(version) FROM schema_migrations').pluck().get() ?? 1,
          shopName: getSetting(db, 'shop.name', z.string()),
          kdf,
        },
        key,
        {
          database,
          databaseKey: this.deps.databaseKey,
          escrow: existsSync(this.deps.escrowPath)
            ? readFileSync(this.deps.escrowPath, 'utf8')
            : null,
        },
      );
      writeFileSync(`${path}.tmp`, file);
      renameSync(`${path}.tmp`, path);
      const checksum = fileChecksum(file);
      db.prepare(
        "INSERT INTO backup_log (type, path, size_bytes, checksum, status, created_at) VALUES (?, ?, ?, ?, 'success', ?)",
      ).run(logType, path, file.length, checksum, this.now().toISOString());
      return { checksum, sizeBytes: file.length };
    } catch (error) {
      db.prepare(
        "INSERT INTO backup_log (type, path, size_bytes, checksum, status) VALUES (?, ?, 0, ?, 'failed')",
      ).run(logType, path, '0'.repeat(64));
      if (error instanceof AppError) throw error;
      logger.error('Sauvegarde impossible', {
        message: error instanceof Error ? error.message : 'inconnue',
      });
      throw new AppError(
        'INTERNAL_ERROR',
        'La sauvegarde a échoué : vérifiez l’espace disque et le dossier choisi.',
      );
    }
  }

  private async snapshot(): Promise<Buffer> {
    const temporary = join(this.deps.directory, `copie-${randomBytes(6).toString('hex')}.tmp`);
    mkdirSync(this.deps.directory, { recursive: true });
    try {
      await this.deps.executor.execute({ type: 'snapshot', path: temporary });
      return readFileSync(temporary);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  /** Ne garde que les `keep` dernières copies automatiques (fichiers créés par l'application). */
  private prune(): void {
    const keep = getSetting(this.deps.db, 'backup.keep', z.number().int());
    const files = readdirSync(this.autoDirectory)
      .filter((name) => AUTO_PATTERN.test(name))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      rmSync(join(this.autoDirectory, name), { force: true });
    }
  }

  private monthlyVacuum(): void {
    const { db } = this.deps;
    const last = getSetting(db, 'maintenance.last_vacuum', z.string().nullable());
    if (last !== null && this.now().getTime() - Date.parse(last) < 30 * DAY_MS) return;
    try {
      db.exec('VACUUM');
      setSetting(db, 'maintenance.last_vacuum', nowIsoUtc(), null);
    } catch (error) {
      logger.warn('VACUUM mensuel reporté', {
        message: error instanceof Error ? error.message : 'inconnue',
      });
    }
  }
}
