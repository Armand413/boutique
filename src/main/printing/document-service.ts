import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '@shared/ipc/errors';
import type { DOCUMENT_KINDS } from '@shared/schemas/sales';
import { appendAudit } from '../audit/audit-log';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { logger } from '../logging/logger';
import { readSaleDetail } from '../sales/sale-queries';
import type { QuoteService } from '../sales/quote-service';
import type { CustomerService } from '../sales/customer-service';
import { getSetting } from '../settings/settings-repository';
import { escposTicket, ticketLines, type TicketWidth } from './receipt';
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
    return ticketLines(readSaleDetail(this.deps.db, saleId, false), this.shopName(), this.width());
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
    const printer = escposTicket(sale, this.shopName(), this.width(), target);
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
    const buffer = await RENDERERS[kind](sale, { name: this.shopName() });
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
    const buffer = await quotePdf(quote, { name: this.shopName() }, customer);
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

  private shopName(): string {
    const name = getSetting(this.deps.db, 'shop.name', z.string());
    return name === '' ? 'Boutique' : name;
  }

  private width(): TicketWidth {
    return getSetting(
      this.deps.db,
      'printer.receipt_width',
      z.union([z.literal(32), z.literal(48)]),
    );
  }
}
