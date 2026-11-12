import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import type { SystemStatus } from '@shared/schemas/auth';
import type { BackupPreview, RestoreInput } from '@shared/schemas/backup';
import type { Session } from '../auth/session';
import { BACKUP_EXTENSION } from '../backup/backup-format';
import { BackupSecretStore } from '../backup/backup-secret';
import { BackupService } from '../backup/backup-service';
import { RestoreTokens, prepareRestore, previewBackup } from '../backup/restore';
import { appendAudit, verifyAuditChain } from '../audit/audit-log';
import { AuditService } from '../audit/audit-service';
import { AuthService } from '../auth/auth-service';
import { SessionManager } from '../auth/session';
import { UserService } from '../auth/user-service';
import { WrongKeyError, closeDatabase, integrityProblems, openDatabase } from '../db/connection';
import { copyDatabaseFile, type FileBackup } from '../db/file-backup';
import { KeyStore, KeyUnavailableError, type KeyProtector } from '../db/keystore';
import { MigrationError, bundledMigrations, migrate, pendingMigrations } from '../db/migrations';
import { seedSystem } from '../db/seed';
import type { Db } from '../db/types';
import { logger } from '../logging/logger';
import { SetupService } from './setup-service';
import { CatalogFilesService } from '../catalog/catalog-files-service';
import { ImageStore } from '../catalog/image-store';
import { ProductService } from '../catalog/product-service';
import { ReferenceService } from '../catalog/reference-service';
import type { FileDialogs } from '../files/file-dialogs';
import { StockService } from '../stock/stock-service';
import { SupplierService } from '../stock/supplier-service';
import { CashSessionService } from '../sales/cash-session-service';
import { CustomerService } from '../sales/customer-service';
import { FollowupService } from '../sales/followup-service';
import { QuoteService, expireQuotes } from '../sales/quote-service';
import { SaleService } from '../sales/sale-service';
import { DocumentService } from '../printing/document-service';
import { InventoryReport } from '../inventory/inventory-report';
import { InventoryService } from '../inventory/inventory-service';
import { WarrantyService } from '../warranty/warranty-service';
import { WorkerExecutor, type ReportExecutor } from '../reports/report-executor';
import { ReportService } from '../reports/report-service';
import { SettingsService } from '../settings/settings-service';
import {
  windowsExecutableInspector,
  type ExecutableInspector,
} from '../update/installer-inspector';
import { UpdateService, type InstallerLauncher } from '../update/update-service';

export interface RuntimeOptions {
  dataDirectory: string;
  protector: KeyProtector;
  dialogs: FileDialogs;
  idleLockSecondsOverride?: number;
  /** Script du thread des rapports (bundle `report-worker.js` à côté du processus principal). */
  reportWorkerScript?: string;
  /** Exécuteur des rapports et copies (tests : dans le processus) ; par défaut, le thread. */
  executorFactory?: (db: Db, file: string, key: Buffer) => ReportExecutor;
  /** Version de l'application, inscrite dans chaque sauvegarde. */
  appVersion?: string;
  /** Mise à jour par setup.exe (D82) : vérification de Windows et lancement de l'installateur. */
  updates?: {
    inspector: ExecutableInspector;
    /** Absent hors de l'application installée : la vérification reste possible, pas l'installation. */
    launcher: InstallerLauncher | null;
    currentExecutable: string;
  };
}

export interface Services {
  db: Db;
  sessions: SessionManager;
  auth: AuthService;
  users: UserService;
  setup: SetupService;
  audit: AuditService;
  references: ReferenceService;
  products: ProductService;
  catalogFiles: CatalogFilesService;
  stock: StockService;
  suppliers: SupplierService;
  customers: CustomerService;
  cashSessions: CashSessionService;
  sales: SaleService;
  quotes: QuoteService;
  followups: FollowupService;
  documents: DocumentService;
  inventories: InventoryService;
  inventoryReport: InventoryReport;
  warranty: WarrantyService;
  reports: ReportService;
  backups: BackupService;
  settings: SettingsService;
  updates: UpdateService;
}

/** État affiché quand la base est endommagée (D77). */
const INTEGRITY_FAILURE: SystemStatus = {
  state: 'error',
  code: 'INTEGRITY',
  message: 'La base de données est endommagée. Restaurez la dernière sauvegarde.',
};

/** Erreur SQLite qui révèle une base endommagée (page illisible ou authentification de page). */
function isCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /malformed|corrupt|not a database/i.test(message);
}

/**
 * Cycle de vie de la base au démarrage (B.3, B.4, E.7) : clé protégée, ouverture chiffrée,
 * contrôle d'intégrité (D77), sauvegarde puis migrations, seed système, vérification de l'audit.
 */
export class AppRuntime {
  private status: SystemStatus = {
    state: 'error',
    code: 'STARTUP',
    message: 'Démarrage en cours.',
  };
  private services: Services | null = null;
  private auditChainBroken = false;
  private integrityCheck: Promise<void> = Promise.resolve();
  /** Base refermée par le contrôle d'intégrité lancé à l'ouverture (prévaut sur tout autre état). */
  private damaged = false;
  readonly databaseFile: string;
  readonly backupDirectory: string;
  private readonly keyStore: KeyStore;
  private readonly backupSecrets: BackupSecretStore;
  private readonly restoreTokens = new RestoreTokens();

  constructor(private readonly options: RuntimeOptions) {
    this.databaseFile = join(options.dataDirectory, 'boutique.db');
    this.backupDirectory = join(options.dataDirectory, 'sauvegardes');
    this.keyStore = new KeyStore(
      join(options.dataDirectory, 'boutique.key'),
      join(options.dataDirectory, 'boutique.key.recovery'),
      options.protector,
    );
    this.backupSecrets = new BackupSecretStore(
      join(options.dataDirectory, 'boutique.backup.key'),
      options.protector,
    );
  }

  async start(): Promise<SystemStatus> {
    try {
      this.status = await this.openWithStoredKey();
    } catch (error) {
      logger.error('Démarrage de la base impossible', { error });
      this.status = isCorruption(error)
        ? INTEGRITY_FAILURE
        : {
            state: 'error',
            code: 'STARTUP',
            message: 'La base de données n’a pas pu être ouverte.',
          };
    }
    return this.getStatus();
  }

  getStatus(): SystemStatus {
    if (this.damaged) return INTEGRITY_FAILURE;
    if (this.status.state !== 'ready' || this.services === null) return this.status;
    return {
      state: 'ready',
      setupCompleted: this.services.setup.isCompleted(),
      shopName: this.services.setup.shopName(),
      auditChainBroken: this.auditChainBroken,
    };
  }

  requireServices(): Services {
    if (this.services === null) {
      throw new AppError('UNAVAILABLE', 'La base de données n’est pas ouverte.');
    }
    return this.services;
  }

  /** Base verrouillée (clé DPAPI perdue) : la clé de récupération retrouve la clé de la base. */
  async unlockDatabase(recoveryKey: string): Promise<SystemStatus> {
    if (this.status.state !== 'locked') return this.getStatus();
    const key = await this.keyStore.recoverKey(recoveryKey);
    let db: Db;
    try {
      db = openDatabase(this.databaseFile, key);
    } catch (error) {
      if (error instanceof WrongKeyError) {
        throw new AppError(
          'INVALID_CREDENTIALS',
          'Cette clé de récupération ne correspond pas à cette base.',
        );
      }
      throw error;
    }
    await this.keyStore.saveKey(key);
    this.status = this.prepare(db, key);
    if (this.services !== null) {
      appendAudit(this.services.db, { userId: null, action: 'db.key_recovered' });
    }
    logger.warn('Clé de la base récupérée grâce à la clé de récupération');
    return this.getStatus();
  }

  /** Restauration sans session : base absente, non configurée, verrouillée ou en erreur. */
  restoreOpenToAll(): boolean {
    const status = this.getStatus();
    return status.state !== 'ready' || !status.setupCompleted;
  }

  /** Choix du fichier à restaurer (fenêtre du processus principal) et aperçu de son en-tête. */
  async chooseBackup(actor: Session | null): Promise<BackupPreview | null> {
    this.assertRestoreAllowed(actor);
    const path = await this.options.dialogs.openFile({
      title: 'Choisir une sauvegarde à restaurer',
      filters: [{ name: 'Sauvegarde Boutique Gestion', extensions: [BACKUP_EXTENSION] }],
    });
    if (path === null) return null;
    return previewBackup(path, this.restoreTokens.issue(path));
  }

  /**
   * Restauration guidée (4.10, B.7) : sauvegarde vérifiée à part, copie de sécurité de la base
   * courante, remplacement, clé remise sous DPAPI, réouverture (migrations comprises). Toutes les
   * sessions sont fermées : on se reconnecte avec les comptes de la sauvegarde.
   */
  async restoreBackup(input: RestoreInput, actor: Session | null): Promise<SystemStatus> {
    this.assertRestoreAllowed(actor);
    const services = this.services;
    if (!this.restoreOpenToAll() && services !== null && actor !== null) {
      if (input.currentPassword === null) {
        throw new AppError('VALIDATION_ERROR', 'Saisissez votre mot de passe pour confirmer.');
      }
      await services.auth.confirmPassword(actor.userId, input.currentPassword);
      if (!this.backupSecrets.has()) {
        throw new AppError(
          'CONFLICT',
          'Définissez d’abord le mot de passe des sauvegardes : la base actuelle sera sauvegardée avant d’être remplacée.',
        );
      }
    }
    const prepared = await prepareRestore(
      this.restoreTokens.take(input.token),
      input.password,
      this.options.dataDirectory,
    );
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    try {
      if (services !== null && this.backupSecrets.has()) {
        await services.backups.createBackup(
          'safety',
          join(this.backupDirectory, `avant-restauration-${stamp}.${BACKUP_EXTENSION}`),
        );
      }
      await this.closeForReplacement();
      this.setAsideDatabase(stamp);
      renameSync(prepared.temporaryFile, this.databaseFile);
    } catch (error) {
      rmSync(prepared.temporaryFile, { force: true });
      throw error;
    }
    await this.keyStore.saveKey(prepared.databaseKey);
    if (prepared.escrow !== null) this.keyStore.restoreEscrow(prepared.escrow);
    if (!this.backupSecrets.has()) {
      await this.backupSecrets.adopt(prepared.header.kdf, prepared.wrappingKey);
    }
    this.status = this.prepare(
      openDatabase(this.databaseFile, prepared.databaseKey),
      prepared.databaseKey,
    );
    if (this.services !== null) {
      appendAudit(this.services.db, {
        userId: null,
        action: 'backup.restored',
        details: {
          backupCreatedAt: prepared.header.createdAt,
          kind: prepared.header.kind,
          restoredBy: actor?.username ?? null,
        },
      });
    }
    logger.warn('Sauvegarde restaurée', { backupCreatedAt: prepared.header.createdAt });
    return this.getStatus();
  }

  /** Sauvegarde automatique quotidienne, appelée par le minuteur du processus principal. */
  async runAutomaticBackup(): Promise<void> {
    if (this.services === null || this.restoreOpenToAll()) return;
    await this.services.backups.runAutomatic();
  }

  private assertRestoreAllowed(actor: Session | null): void {
    if (this.restoreOpenToAll()) return;
    if (!actor?.permissions.has('backup.manage')) {
      throw new AppError('FORBIDDEN', 'Vous n’avez pas le droit d’effectuer cette opération.');
    }
  }

  private async closeForReplacement(): Promise<void> {
    const services = this.services;
    this.services = null;
    if (services === null) return;
    await services.reports.close();
    closeDatabase(services.db);
  }

  /** La base remplacée est mise de côté (jamais effacée), avec ses fichiers WAL éventuels. */
  private setAsideDatabase(stamp: string): void {
    if (!existsSync(this.databaseFile)) return;
    mkdirSync(this.backupDirectory, { recursive: true });
    const target = join(this.backupDirectory, `base-remplacee-${stamp}.db`);
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${this.databaseFile}${suffix}`)) {
        renameSync(`${this.databaseFile}${suffix}`, `${target}${suffix}`);
      }
    }
  }

  close(): void {
    if (this.services !== null) {
      void this.services.reports.close();
      closeDatabase(this.services.db);
    }
    this.services = null;
  }

  private async openWithStoredKey(): Promise<SystemStatus> {
    if (!existsSync(this.databaseFile)) {
      const key = await this.newOrStoredKey();
      return this.prepare(openDatabase(this.databaseFile, key), key);
    }
    if (!this.keyStore.hasKey()) return this.lockedOrUnavailable();
    let key: Buffer;
    try {
      key = await this.keyStore.readKey();
    } catch (error) {
      if (error instanceof KeyUnavailableError) return this.lockedOrUnavailable();
      throw error;
    }
    try {
      return this.prepare(openDatabase(this.databaseFile, key), key);
    } catch (error) {
      if (error instanceof WrongKeyError) return this.lockedOrUnavailable();
      throw error;
    }
  }

  /** Première installation (aucun fichier de base) : clé existante réutilisée si lisible, sinon nouvelle. */
  private async newOrStoredKey(): Promise<Buffer> {
    if (this.keyStore.hasKey()) {
      try {
        return await this.keyStore.readKey();
      } catch (error) {
        if (!(error instanceof KeyUnavailableError)) throw error;
        logger.warn('Clé existante illisible sans base associée : une nouvelle clé est créée');
      }
    }
    return await this.keyStore.createKey();
  }

  private lockedOrUnavailable(): SystemStatus {
    if (this.keyStore.hasEscrow()) return { state: 'locked' };
    return {
      state: 'error',
      code: 'KEY_UNAVAILABLE',
      message:
        'La clé de la base est introuvable sur ce compte Windows et aucun séquestre n’existe. ' +
        'Restaurez une sauvegarde ou ouvrez la session Windows d’origine.',
    };
  }

  /** Prépare la base ouverte ; la connexion est refermée si une étape échoue. */
  private prepare(db: Db, key: Buffer): SystemStatus {
    try {
      return this.prepareOpened(db, key);
    } catch (error) {
      if (db.open) db.close();
      this.services = null;
      throw error;
    }
  }

  private prepareOpened(db: Db, key: Buffer): SystemStatus {
    if (!this.integrityBeforeMigrationOk(db)) {
      db.close();
      return INTEGRITY_FAILURE;
    }
    const migrated = this.migrate(db);
    if (migrated !== null) {
      db.close();
      return migrated;
    }
    seedSystem(db);
    const audit = verifyAuditChain(db);
    this.auditChainBroken = !audit.ok;
    if (!audit.ok) logger.error('Journal d’audit altéré', { brokenAtId: audit.brokenAtId });
    this.services = this.createServices(db, key);
    this.damaged = false;
    this.startIntegrityCheck(db, key);
    return {
      state: 'ready',
      setupCompleted: false,
      shopName: '',
      auditChainBroken: this.auditChainBroken,
    };
  }

  /**
   * Avant les migrations, seul le contrôle d'intégrité est bloquant quand une migration attend
   * (on ne migre pas une base endommagée) ; sinon le contrôle complet part dans un thread (D77).
   */
  private integrityBeforeMigrationOk(db: Db): boolean {
    if (pendingMigrations(db, bundledMigrations()).length === 0) return true;
    const problems = integrityProblems(db);
    if (problems.length > 0) {
      logger.error('Contrôle d’intégrité en échec', { problems: problems.slice(0, 10) });
    }
    return problems.length === 0;
  }

  /**
   * `PRAGMA integrity_check` complet au démarrage (E, maintenance) dans un thread dédié, en lecture
   * seule : plusieurs dizaines de secondes sur une très grosse base, sans retarder l'ouverture ni
   * le thread des rapports. Une base endommagée est aussitôt refermée et l'écran d'erreur s'affiche.
   */
  private startIntegrityCheck(db: Db, key: Buffer): void {
    const executor = this.newExecutor(db, key);
    this.integrityCheck = executor
      .execute({ type: 'integrity' })
      .then((problems) => {
        if (problems.length === 0) {
          logger.info('Contrôle d’intégrité au démarrage : base saine');
          return;
        }
        logger.error('Contrôle d’intégrité en échec', { problems: problems.slice(0, 10) });
        this.refuseDamaged(db);
      })
      .catch((error: unknown) => {
        logger.error('Contrôle d’intégrité impossible', { error });
        if (isCorruption(error)) this.refuseDamaged(db);
      })
      .finally(() => executor.close());
  }

  /** Base endommagée découverte après l'ouverture : sessions fermées, base refermée. */
  private refuseDamaged(db: Db): void {
    const services = this.services;
    if (services?.db !== db) return;
    this.damaged = true;
    this.status = INTEGRITY_FAILURE;
    this.services = null;
    services.sessions.end();
    void services.reports.close();
    db.close();
  }

  /** Fin du contrôle d'intégrité lancé à l'ouverture (attendue par les tests). */
  integrityChecked(): Promise<void> {
    return this.integrityCheck;
  }

  private newExecutor(db: Db, key: Buffer): ReportExecutor {
    return (
      this.options.executorFactory?.(db, this.databaseFile, key) ??
      new WorkerExecutor(
        this.options.reportWorkerScript ?? join(__dirname, 'report-worker.js'),
        this.databaseFile,
        key,
      )
    );
  }

  /** Applique les migrations ; renvoie un statut d'erreur en cas d'échec, null sinon. */
  private migrate(db: Db): SystemStatus | null {
    let backup: FileBackup | null = null;
    try {
      const applied = migrate(db, bundledMigrations(), {
        backupBeforeMigrating: () => {
          backup = copyDatabaseFile(db, this.backupDirectory, 'avant-migration');
        },
      });
      if (applied.length > 0)
        logger.info('Migrations appliquées', { versions: applied.map((m) => m.version) });
      this.recordBackup(db, backup);
      return null;
    } catch (error) {
      logger.error('Migration impossible', { error });
      const detail = error instanceof MigrationError ? ` ${error.message}` : '';
      return {
        state: 'error',
        code: 'MIGRATION',
        message: `La mise à jour de la base a échoué ; elle est restée dans son état précédent.${detail}`,
      };
    }
  }

  private recordBackup(db: Db, backup: FileBackup | null): void {
    if (backup === null) return;
    db.prepare(
      "INSERT INTO backup_log (type, path, size_bytes, checksum, status) VALUES ('pre_migration', ?, ?, ?, 'success')",
    ).run(backup.path, backup.sizeBytes, backup.checksum);
  }

  private createUpdates(db: Db, auth: AuthService, backups: BackupService): UpdateService {
    const updates = this.options.updates;
    return new UpdateService({
      db,
      dialogs: this.options.dialogs,
      inspector: updates?.inspector ?? windowsExecutableInspector,
      launcher: updates?.launcher ?? null,
      currentVersion: this.options.appVersion ?? '0.0.0',
      currentExecutable: updates?.currentExecutable ?? process.execPath,
      stagingDirectory: join(this.options.dataDirectory, 'mise-a-jour'),
      confirmPassword: (userId, password) => auth.confirmPassword(userId, password),
      hasBackupPassword: () => this.backupSecrets.has(),
      safetyBackup: async (name) => {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
        await backups.createBackup(
          'safety',
          join(this.backupDirectory, `${name}-${stamp}.${BACKUP_EXTENSION}`),
        );
      },
    });
  }

  private createServices(db: Db, key: Buffer): Services {
    const sessions = new SessionManager();
    const products = new ProductService(db);
    const customers = new CustomerService(db);
    const quotes = new QuoteService(db);
    expireQuotes(db);
    const inventories = new InventoryService(db);
    const images = new ImageStore(join(this.options.dataDirectory, 'images'));
    const executor = this.newExecutor(db, key);
    const backups = new BackupService({
      db,
      executor,
      secrets: this.backupSecrets,
      databaseKey: key,
      escrowPath: this.keyStore.escrowPath,
      directory: this.backupDirectory,
      dialogs: this.options.dialogs,
      appVersion: this.options.appVersion ?? '0.0.0',
      confirmPassword: (userId, password) => auth.confirmPassword(userId, password),
    });
    const auth = new AuthService({
      db,
      sessions,
      keyStore: this.keyStore,
      databaseKey: key,
      ...(this.options.idleLockSecondsOverride === undefined
        ? {}
        : { idleLockSecondsOverride: this.options.idleLockSecondsOverride }),
    });
    return {
      db,
      sessions,
      auth,
      users: new UserService(db),
      setup: new SetupService(db, this.keyStore, key),
      audit: new AuditService(db),
      references: new ReferenceService(db),
      products,
      catalogFiles: new CatalogFilesService({
        db,
        products,
        dialogs: this.options.dialogs,
        images,
      }),
      stock: new StockService(db),
      suppliers: new SupplierService(db),
      customers,
      cashSessions: new CashSessionService(db),
      sales: new SaleService(db),
      quotes,
      followups: new FollowupService(db),
      inventories,
      inventoryReport: new InventoryReport(db, inventories, this.options.dialogs),
      warranty: new WarrantyService(db),
      reports: new ReportService(db, executor, this.options.dialogs),
      settings: new SettingsService(db, images, this.options.dialogs),
      backups,
      updates: this.createUpdates(db, auth, backups),
      documents: new DocumentService({
        db,
        dialogs: this.options.dialogs,
        quotes,
        customers,
        simulatorDirectory: join(this.options.dataDirectory, 'tickets-simules'),
        images,
      }),
    };
  }
}
