import { z } from 'zod';
import { setDateFormat } from '@shared/format/date';
import { setActiveCurrency, type CurrencyConfig } from '@shared/format/money';
import { AppError } from '@shared/ipc/errors';
import type {
  AllSettings,
  FraudSettings,
  PrinterSettings,
  PublicSettings,
  RegionalSettings,
  SecuritySettings,
  ShopSettings,
  TaxRateInput,
} from '@shared/schemas/settings';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { ImageStore } from '../catalog/image-store';
import { listTaxRates } from '../catalog/reference-repository';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { getSetting, setSetting } from './settings-repository';

const text = z.string().nullable();
const currencySchema = z.strictObject({
  code: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
});
const capsSchema = z.strictObject({
  seller: z.number().int(),
  manager: z.number().int(),
  admin: z.number().int().nullable(),
});
const PRINTER = /^tcp:\/\/([\w.-]+):(\d{1,5})$/;

function printerTarget(db: Db): PrinterSettings['receipt'] {
  const value = getSetting(db, 'printer.receipt', z.string().nullable());
  const match = value === null ? null : PRINTER.exec(value);
  return match === null ? null : { host: match[1] ?? '', port: Number(match[2]) };
}

/** Paramètres de la boutique (4.11), réservés à l'administrateur (`settings.manage`), tracés dans l'audit. */
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly images: ImageStore,
    private readonly dialogs: FileDialogs,
  ) {
    this.applyDisplay();
  }

  all(actor: Session): AllSettings {
    requirePermission(actor, 'settings.manage');
    const { db } = this;
    return {
      shop: {
        name: getSetting(db, 'shop.name', z.string()),
        address: getSetting(db, 'shop.address', text),
        phone: getSetting(db, 'shop.phone', text),
        email: getSetting(db, 'shop.email', text),
        legal: getSetting(db, 'shop.legal', text),
      },
      logo: this.images.dataUrl(getSetting(db, 'shop.logo', text)),
      regional: {
        currency: getSetting(db, 'shop.currency', currencySchema),
        dateFormat: getSetting(db, 'shop.date_format', z.enum(['fr', 'iso'])),
        invoicePrefix: getSetting(db, 'invoice.prefix', z.string()),
      },
      decimalsLocked: this.hasAmounts(),
      printer: {
        receipt: printerTarget(db),
        receiptWidth: getSetting(
          db,
          'printer.receipt_width',
          z.union([z.literal(32), z.literal(48)]),
        ),
        labelLayout: getSetting(db, 'printer.label_layout', z.enum(['sheet', 'roll'])),
      },
      security: {
        idleLockMinutes: getSetting(db, 'security.idle_lock_minutes', z.number().int()),
        discountCaps: getSetting(db, 'pos.discount_caps', capsSchema),
        inventoryDoubleCheck: getSetting(db, 'inventory.double_check', z.boolean()),
      },
      fraud: {
        discountAlert: getSetting(db, 'fraud.discount_alert', z.number().int()),
        adjustmentsPerDay: getSetting(db, 'fraud.adjustments_per_day', z.number().int()),
        cashDifference: getSetting(db, 'fraud.cash_difference', z.number().int()),
      },
      taxRates: listTaxRates(db),
    };
  }

  /** Lu par toute session : affichage des montants et des dates, nom de la boutique. */
  publicSettings(): PublicSettings {
    return {
      shopName: getSetting(this.db, 'shop.name', z.string()),
      currency: getSetting(this.db, 'shop.currency', currencySchema),
      dateFormat: getSetting(this.db, 'shop.date_format', z.enum(['fr', 'iso'])),
      labelLayout: getSetting(this.db, 'printer.label_layout', z.enum(['sheet', 'roll'])),
    };
  }

  saveShop(actor: Session, input: ShopSettings): AllSettings {
    return this.save(actor, 'shop', {
      'shop.name': input.name,
      'shop.address': input.address,
      'shop.phone': input.phone,
      'shop.email': input.email,
      'shop.legal': input.legal,
    });
  }

  /** Décimales de la devise figées dès qu'un montant existe (les montants sont des entiers, E.1). */
  saveRegional(actor: Session, input: RegionalSettings): AllSettings {
    requirePermission(actor, 'settings.manage');
    const current = getSetting(this.db, 'shop.currency', currencySchema);
    if (input.currency.decimals !== current.decimals && this.hasAmounts()) {
      throw new AppError(
        'CONFLICT',
        'Les décimales de la devise ne changent plus une fois des prix ou des ventes enregistrés.',
      );
    }
    const result = this.save(actor, 'regional', {
      'shop.currency': input.currency satisfies CurrencyConfig,
      'shop.date_format': input.dateFormat,
      'invoice.prefix': input.invoicePrefix,
    });
    this.applyDisplay();
    return result;
  }

  savePrinter(actor: Session, input: PrinterSettings): AllSettings {
    return this.save(actor, 'printer', {
      'printer.receipt':
        input.receipt === null ? null : `tcp://${input.receipt.host}:${String(input.receipt.port)}`,
      'printer.receipt_width': input.receiptWidth,
      'printer.label_layout': input.labelLayout,
    });
  }

  saveSecurity(actor: Session, input: SecuritySettings): AllSettings {
    return this.save(actor, 'security', {
      'security.idle_lock_minutes': input.idleLockMinutes,
      'pos.discount_caps': input.discountCaps,
      'inventory.double_check': input.inventoryDoubleCheck,
    });
  }

  saveFraud(actor: Session, input: FraudSettings): AllSettings {
    return this.save(actor, 'fraud', {
      'fraud.discount_alert': input.discountAlert,
      'fraud.adjustments_per_day': input.adjustmentsPerDay,
      'fraud.cash_difference': input.cashDifference,
    });
  }

  /** Taux de taxe : créés, renommés, modifiés ou désactivés (jamais supprimés) ; les ventes gardent le leur. */
  saveTaxRate(actor: Session, input: TaxRateInput): AllSettings {
    requirePermission(actor, 'settings.manage');
    const duplicate = this.db
      .prepare<[string, number], number>('SELECT id FROM tax_rates WHERE name = ? AND id <> ?')
      .pluck()
      .get(input.name, input.id ?? 0);
    if (duplicate !== undefined) throw new AppError('CONFLICT', 'Un taux porte déjà ce nom.');
    this.db.transaction(() => {
      if (input.id === null) {
        this.db
          .prepare('INSERT INTO tax_rates (name, rate, is_active, created_by) VALUES (?, ?, ?, ?)')
          .run(input.name, input.rate, input.isActive ? 1 : 0, actor.userId);
      } else {
        const changed = this.db
          .prepare(
            "UPDATE tax_rates SET name = ?, rate = ?, is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          )
          .run(input.name, input.rate, input.isActive ? 1 : 0, input.id).changes;
        if (changed === 0) throw new AppError('NOT_FOUND', 'Taux introuvable.');
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'settings.tax_rate_saved',
        details: { ...input },
      });
    })();
    return this.all(actor);
  }

  async chooseLogo(actor: Session): Promise<AllSettings | null> {
    requirePermission(actor, 'settings.manage');
    const path = await this.dialogs.openFile({
      title: 'Choisir le logo de la boutique',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (path === null) return null;
    const previous = getSetting(this.db, 'shop.logo', text);
    const name = this.images.importLogo(path);
    this.save(actor, 'logo', { 'shop.logo': name });
    this.images.remove(previous);
    return this.all(actor);
  }

  removeLogo(actor: Session): AllSettings {
    const previous = getSetting(this.db, 'shop.logo', text);
    const result = this.save(actor, 'logo', { 'shop.logo': null });
    this.images.remove(previous);
    return { ...result, logo: null };
  }

  /** Applique la devise et le format de date au processus principal (documents, exports). */
  applyDisplay(): void {
    const settings = this.publicSettings();
    setActiveCurrency(settings.currency);
    setDateFormat(settings.dateFormat);
  }

  private hasAmounts(): boolean {
    return (
      this.db
        .prepare('SELECT EXISTS (SELECT 1 FROM product_variants) OR EXISTS (SELECT 1 FROM sales)')
        .pluck()
        .get() === 1
    );
  }

  private save(
    actor: Session,
    section: string,
    values: Readonly<Record<string, unknown>>,
  ): AllSettings {
    requirePermission(actor, 'settings.manage');
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values))
        setSetting(this.db, key, value, actor.userId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'settings.changed',
        details: { section, keys: Object.keys(values) },
      });
    })();
    return this.all(actor);
  }
}
