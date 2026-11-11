import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import type { SystemStatus } from '@shared/schemas/auth';
import { appendAudit, verifyAuditChain } from '../audit/audit-log';
import { AuditService } from '../audit/audit-service';
import { AuthService } from '../auth/auth-service';
import { SessionManager } from '../auth/session';
import { UserService } from '../auth/user-service';
import { WrongKeyError, closeDatabase, integrityProblems, openDatabase } from '../db/connection';
import { copyDatabaseFile, type FileBackup } from '../db/file-backup';
import { KeyStore, KeyUnavailableError, type KeyProtector } from '../db/keystore';
import { MigrationError, bundledMigrations, migrate } from '../db/migrations';
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

export interface RuntimeOptions {
  dataDirectory: string;
  protector: KeyProtector;
  dialogs: FileDialogs;
  idleLockSecondsOverride?: number;
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
}

/**
 * Cycle de vie de la base au démarrage (B.3, B.4, E.7) : clé protégée, ouverture chiffrée,
 * contrôle d'intégrité, sauvegarde puis migrations, seed système, vérification de l'audit.
 */
export class AppRuntime {
  private status: SystemStatus = {
    state: 'error',
    code: 'STARTUP',
    message: 'Démarrage en cours.',
  };
  private services: Services | null = null;
  private auditChainBroken = false;
  readonly databaseFile: string;
  readonly backupDirectory: string;
  private readonly keyStore: KeyStore;

  constructor(private readonly options: RuntimeOptions) {
    this.databaseFile = join(options.dataDirectory, 'boutique.db');
    this.backupDirectory = join(options.dataDirectory, 'sauvegardes');
    this.keyStore = new KeyStore(
      join(options.dataDirectory, 'boutique.key'),
      join(options.dataDirectory, 'boutique.key.recovery'),
      options.protector,
    );
  }

  async start(): Promise<SystemStatus> {
    try {
      this.status = await this.openWithStoredKey();
    } catch (error) {
      logger.error('Démarrage de la base impossible', { error });
      this.status = {
        state: 'error',
        code: 'STARTUP',
        message: 'La base de données n’a pas pu être ouverte.',
      };
    }
    return this.getStatus();
  }

  getStatus(): SystemStatus {
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

  close(): void {
    if (this.services !== null) closeDatabase(this.services.db);
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
    const problems = integrityProblems(db);
    if (problems.length > 0) {
      logger.error('Contrôle d’intégrité en échec', { problems: problems.slice(0, 10) });
      db.close();
      return {
        state: 'error',
        code: 'INTEGRITY',
        message: 'La base de données est endommagée. Restaurez la dernière sauvegarde.',
      };
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
    return {
      state: 'ready',
      setupCompleted: false,
      shopName: '',
      auditChainBroken: this.auditChainBroken,
    };
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

  private createServices(db: Db, key: Buffer): Services {
    const sessions = new SessionManager();
    const products = new ProductService(db);
    const customers = new CustomerService(db);
    const quotes = new QuoteService(db);
    expireQuotes(db);
    const inventories = new InventoryService(db);
    return {
      db,
      sessions,
      auth: new AuthService({
        db,
        sessions,
        keyStore: this.keyStore,
        databaseKey: key,
        ...(this.options.idleLockSecondsOverride === undefined
          ? {}
          : { idleLockSecondsOverride: this.options.idleLockSecondsOverride }),
      }),
      users: new UserService(db),
      setup: new SetupService(db, this.keyStore, key),
      audit: new AuditService(db),
      references: new ReferenceService(db),
      products,
      catalogFiles: new CatalogFilesService({
        db,
        products,
        dialogs: this.options.dialogs,
        images: new ImageStore(join(this.options.dataDirectory, 'images')),
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
      documents: new DocumentService({
        db,
        dialogs: this.options.dialogs,
        quotes,
        customers,
        simulatorDirectory: join(this.options.dataDirectory, 'tickets-simules'),
      }),
    };
  }
}
