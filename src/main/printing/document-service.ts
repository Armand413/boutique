import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import type { DOCUMENT_KINDS } from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { logger } from '../logging/logger';
import { readSaleDetail } from '../sales/sale-queries';
import type { QuoteService } from '../sales/quote-service';
import type { CustomerService } from '../sales/customer-service';
import { getSetting } from '../settings/settings-repository';
import { escposTestTicket, escposTicket, ticketLines, type TicketWidth } from './receipt';
import { contactLines, readShopIdentity, type ShopIdentity } from './shop-identity';
import type { ImageStore } from '../catalog/image-store';
import { deliveryNotePdf, invoicePdf, quotePdf, ticketPdf, warrantyPdf } from './sale-documents';

type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const FILE_NAMES: Readonly<Record<DocumentKind, string>> = {
  ticket: 'ticket',
  invoice: 'facture',
  warranty: 'garantie',
  delivery_note: 'livraison',
};

const RENDERERS = {
  ticket: ticketPdf,
  invoice: invoicePdf,
  warranty: warrantyPdf,
  delivery_note: deliveryNotePdf,
};

/** Une imprimante réseau ESC/POS (« tcp://hôte:port ») ou rien (simulateur). */
const printerSetting = z
  .string()
  .regex(/^tcp:\/\/[\w.-]+(:\d{1,5})?$/)
  .nullable();

export interface DocumentServiceDependencies {
  db: Db;
  dialogs: FileDialogs;
  quotes: QuoteService;
  customers: CustomerService;
  /** Dossier du simulateur d'imprimante (tickets ESC/POS écrits en fichiers). */
  simulatorDirectory: string;
  /** Logo de la boutique (facultatif dans les tests). */
  images?: ImageStore;
}

/**
 * Documents de vente (4.5) : ticket ESC/POS (imprimante réseau ou simulateur, D55), facture A4,
 * bon de garantie, bon de livraison et devis en PDF. Le caissier imprime la vente qu'il vient de
 * faire ; la réimpression d'une vente passée exige sale.view.
 */
export class DocumentService {
  constructor(private readonly deps: DocumentServiceDependencies) {}

  ticketText(actor: Session, saleId: number): string[] {
    this.requireSaleAccess(actor);
    const shop = this.shop();
    return ticketLines(
      readSaleDetail(this.deps.db, saleId, false),
      shop.name,
      this.width(),
      this.ticketExtra(shop),
    );
  }

  async printTicket(actor: Session, saleId: number): Promise<{ simulated: boolean }> {
    this.requireSaleAccess(actor);
    const sale = readSaleDetail(this.deps.db, saleId, false);
    const configured = getSetting(this.deps.db, 'printer.receipt', printerSetting);
    let target = configured;
    if (target === null) {
      mkdirSync(this.deps.simulatorDirectory, { recursive: true });
      target = join(this.deps.simulatorDirectory, `${sale.invoiceNumber ?? String(saleId)}.escpos`);
    }
    const shop = this.shop();
    const printer = escposTicket(sale, shop.name, this.width(), target, this.ticketExtra(shop));
    try {
      await printer.execute();
    } catch (error) {
      logger.warn('Impression du ticket impossible', { error });
      throw new AppError(
        'UNAVAILABLE',
        'L’imprimante de tickets ne répond pas : vérifiez qu’elle est allumée et reliée au réseau.',
      );
    }
    appendAudit(this.deps.db, {
      userId: actor.userId,
      action: 'sale.ticket_printed',
      entityType: 'sale',
      entityId: saleId,
      details: { simulated: configured === null },
    });
    return { simulated: configured === null };
  }

  /** Ticket d'essai depuis les paramètres ; simulateur si aucune imprimante n'est réglée. */
  async printTest(actor: Session): Promise<{ simulated: boolean }> {
    requirePermission(actor, 'settings.manage');
    const configured = getSetting(this.deps.db, 'printer.receipt', printerSetting);
    let target = configured;
    if (target === null) {
      mkdirSync(this.deps.simulatorDirectory, { recursive: true });
      target = join(this.deps.simulatorDirectory, 'ticket-essai.escpos');
    }
    const shop = this.shop();
    try {
      await escposTestTicket(shop.name, this.width(), target, contactLines(shop)).execute();
    } catch (error) {
      logger.warn('Ticket d’essai impossible', { error });
      throw new AppError(
        'UNAVAILABLE',
        'L’imprimante de tickets ne répond pas : vérifiez son adresse, qu’elle est allumée et reliée au réseau.',
      );
    }
    return { simulated: configured === null };
  }

  async saveSaleDocument(
    actor: Session,
    saleId: number,
    kind: DocumentKind,
  ): Promise<{ saved: boolean }> {
    this.requireSaleAccess(actor);
    const sale = readSaleDetail(this.deps.db, saleId, false);
    if (sale.status === 'held') throw new AppError('CONFLICT', 'Cette vente n’est pas terminée.');
    if (kind === 'delivery_note' && sale.delivery === null) {
      throw new AppError('VALIDATION_ERROR', 'Cette vente n’a pas de livraison.');
    }
    const buffer = await RENDERERS[kind](sale, this.shop());
    return this.save(
      actor,
      buffer,
      `${FILE_NAMES[kind]}-${sale.invoiceNumber ?? String(saleId)}.pdf`,
      'sale',
      saleId,
      kind,
    );
  }

  async saveQuote(actor: Session, quoteId: number): Promise<{ saved: boolean }> {
    const quote = this.deps.quotes.get(actor, quoteId);
    const customer =
      quote.customerId === null ? null : this.deps.customers.get(actor, quote.customerId);
    const buffer = await quotePdf(quote, this.shop(), customer);
    return this.save(actor, buffer, `devis-${quote.quote.number}.pdf`, 'quote', quoteId, 'quote');
  }

  private async save(
    actor: Session,
    buffer: Buffer,
    defaultName: string,
    entityType: string,
    entityId: number,
    kind: string,
  ): Promise<{ saved: boolean }> {
    const path = await this.deps.dialogs.saveFile({
      title: 'Enregistrer le document',
      defaultName,
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
    });
    if (path === null) return { saved: false };
    writeFileSync(path, buffer);
    appendAudit(this.deps.db, {
      userId: actor.userId,
      action: 'document.saved',
      entityType,
      entityId,
      details: { kind },
    });
    return { saved: true };
  }

  private requireSaleAccess(actor: Session): void {
    if (!actor.permissions.has('sale.view') && !actor.permissions.has('pos.use')) {
      throw new AppError('FORBIDDEN', 'Vous n’avez pas le droit d’effectuer cette opération.');
    }
  }

  private shop(): ShopIdentity {
    return readShopIdentity(this.deps.db, this.deps.images ?? null);
  }

  private ticketExtra(shop: ShopIdentity): { header: string[]; footer: string[] } {
    return {
      header: contactLines(shop),
      footer: typeof shop.legal === 'string' ? [shop.legal] : [],
    };
  }

  private width(): TicketWidth {
    return getSetting(
      this.deps.db,
      'printer.receipt_width',
      z.union([z.literal(32), z.literal(48)]),
    );
  }
}
