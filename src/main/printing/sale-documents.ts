import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatDate, formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { QuoteDetail, SaleDetail } from '@shared/schemas/sales';
import { MM, plain, renderPdf } from './pdf';
import { ticketLines } from './receipt';

export interface ShopIdentity {
  name: string;
}

const money = (value: number): string => plain(formatMoney(value));

const METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Espèces',
  card: 'Carte',
  mobile_money: 'Mobile money',
  transfer: 'Virement',
  cheque: 'Chèque',
};

function header(
  shop: ShopIdentity,
  title: string,
  reference: string,
  date: string | null,
): Content {
  return {
    columns: [
      { text: shop.name, style: 'shop' },
      {
        stack: [
          { text: title, style: 'title' },
          { text: reference, bold: true },
          ...(date === null ? [] : [{ text: plain(formatDateTime(date)) }]),
        ],
        alignment: 'right',
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

function customerBlock(
  customer: { fullName: string; phone: string | null } | null,
  extra: string[] = [],
): Content {
  if (customer === null && extra.length === 0) return { text: '' };
  return {
    stack: [
      ...(customer === null ? [] : [{ text: 'Client', bold: true }, { text: customer.fullName }]),
      ...(typeof customer?.phone === 'string' ? [{ text: `Tél. ${customer.phone}` }] : []),
      ...extra.map((text) => ({ text })),
    ],
    margin: [0, 0, 0, 12],
  };
}

function totalsTable(rows: [string, string, boolean?][]): Content {
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map(([label, value, bold]) => [
        { text: label, bold: bold === true, alignment: 'right' },
        { text: value, bold: bold === true, alignment: 'right' },
      ]),
    },
    layout: 'noBorders',
    margin: [200, 8, 0, 0],
  };
}

const STYLES = {
  shop: { fontSize: 16, bold: true },
  title: { fontSize: 14, bold: true },
  head: { bold: true, fillColor: '#eeeeee' },
};

function saleRows(sale: SaleDetail): TableCell[][] {
  return sale.lines.map((line) => {
    const component = line.lineType === 'kit_component';
    const details = [
      line.variantLabel,
      line.serialNumber === null ? '' : `N° ${line.serialNumber}`,
      line.warrantyEnd === null ? '' : `Garantie jusqu'au ${line.warrantyEnd}`,
    ].filter((part) => part !== '');
    return [
      {
        stack: [
          { text: `${component ? '   - ' : ''}${line.name}`, bold: !component },
          ...details.map((text) => ({ text, fontSize: 8 })),
        ],
      },
      { text: String(line.quantity), alignment: 'right' },
      { text: component ? '' : money(line.unitPrice), alignment: 'right' },
      { text: line.discount === 0 ? '' : `-${money(line.discount)}`, alignment: 'right' },
      { text: component ? '' : money(line.lineTotal), alignment: 'right' },
    ];
  });
}

/** Facture A4 : lignes (composants de kit, numéros, garanties), totaux TTC, TVA comprise, paiements. */
export function invoicePdf(sale: SaleDetail, shop: ShopIdentity): Promise<Buffer> {
  const rows: [string, string, boolean?][] = [
    ['Sous-total', money(sale.subtotal)],
    ...(sale.discountTotal > 0
      ? [['Remises', `-${money(sale.discountTotal)}`] as [string, string]]
      : []),
    ['Total TTC', money(sale.total), true],
    ...(sale.taxIncluded > 0 ? [['dont TVA', money(sale.taxIncluded)] as [string, string]] : []),
    ...sale.payments.map(
      (payment) =>
        [
          `Payé (${METHOD_LABELS[payment.method] ?? payment.method}, ${plain(formatDate(payment.paidAt))})`,
          money(payment.amount),
        ] as [string, string],
    ),
    ...(sale.remaining > 0
      ? [['Reste à payer', money(sale.remaining), true] as [string, string, boolean]]
      : []),
  ];
  const document: TDocumentDefinitions = {
    info: { title: `Facture ${sale.invoiceNumber ?? ''}`, creator: 'Boutique Gestion' },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: STYLES,
    content: [
      header(
        shop,
        sale.status === 'cancelled' ? 'FACTURE ANNULÉE' : 'FACTURE',
        sale.invoiceNumber ?? '',
        sale.completedAt,
      ),
      customerBlock(sale.customer, [`Vendeur : ${sale.userName}`]),
      {
        table: {
          headerRows: 1,
          widths: ['*', 30, 70, 60, 75],
          body: [
            ['Désignation', 'Qté', 'Prix unit.', 'Remise', 'Montant'].map((text) => ({
              text,
              style: 'head',
            })),
            ...saleRows(sale),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      totalsTable(rows),
      ...(sale.installments.length === 0
        ? []
        : [
            { text: 'Échéancier', bold: true, margin: [0, 16, 0, 4] } as Content,
            {
              ul: sale.installments.map(
                (item) =>
                  `${item.dueDate} : ${money(item.amount)} (payé ${money(item.paidAmount)})`,
              ),
            } as Content,
          ]),
      { text: 'Prix toutes taxes comprises.', fontSize: 8, margin: [0, 24, 0, 0] },
    ],
  };
  return renderPdf(document);
}

/** Bon de garantie : une ligne par appareil suivi, avec sa date de fin de garantie. */
export function warrantyPdf(sale: SaleDetail, shop: ShopIdentity): Promise<Buffer> {
  const covered = sale.lines.filter(
    (line) => line.serialNumber !== null || line.warrantyEnd !== null,
  );
  const document: TDocumentDefinitions = {
    info: { title: `Garantie ${sale.invoiceNumber ?? ''}`, creator: 'Boutique Gestion' },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: STYLES,
    content: [
      header(shop, 'BON DE GARANTIE', sale.invoiceNumber ?? '', sale.completedAt),
      customerBlock(sale.customer),
      covered.length === 0
        ? { text: 'Aucun article de cette vente n’est couvert par une garantie.' }
        : {
            table: {
              headerRows: 1,
              widths: ['*', 140, 100],
              body: [
                ['Article', 'Numéro de série / IMEI', 'Garantie jusqu’au'].map((text) => ({
                  text,
                  style: 'head',
                })),
                ...covered.map((line) => [
                  `${line.name} ${line.variantLabel}`.trim(),
                  line.serialNumber ?? '—',
                  line.warrantyEnd ?? '—',
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          },
      {
        text: 'Présentez ce bon et l’appareil pour toute réclamation. La garantie ne couvre pas la casse, l’oxydation ni une intervention extérieure.',
        fontSize: 9,
        margin: [0, 24, 0, 0],
      },
    ],
  };
  return renderPdf(document);
}

/** Bon de livraison : adresse, articles (sans prix) et signature. */
export function deliveryNotePdf(sale: SaleDetail, shop: ShopIdentity): Promise<Buffer> {
  const document: TDocumentDefinitions = {
    info: { title: `Livraison ${sale.invoiceNumber ?? ''}`, creator: 'Boutique Gestion' },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: STYLES,
    content: [
      header(shop, 'BON DE LIVRAISON', sale.invoiceNumber ?? '', sale.completedAt),
      customerBlock(
        sale.customer,
        sale.delivery === null ? [] : [`Adresse : ${sale.delivery.address}`],
      ),
      {
        table: {
          headerRows: 1,
          widths: ['*', 40, 150],
          body: [
            ['Article', 'Qté', 'N° de série'].map((text) => ({ text, style: 'head' })),
            ...sale.lines
              .filter((line) => line.lineType !== 'service')
              .map((line) => [
                `${line.lineType === 'kit_component' ? '   - ' : ''}${line.name} ${line.variantLabel}`.trimEnd(),
                String(line.quantity),
                line.serialNumber ?? '',
              ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        columns: [
          { text: 'Signature du livreur' },
          { text: 'Signature du client', alignment: 'right' },
        ],
        margin: [0, 48, 0, 0],
      },
    ],
  };
  return renderPdf(document);
}

/** Ticket au format rouleau 80 mm en PDF (si aucune imprimante thermique n'est configurée). */
export function ticketPdf(sale: SaleDetail, shop: ShopIdentity): Promise<Buffer> {
  const lines = ticketLines(sale, shop.name, 48);
  return renderPdf({
    info: { title: `Ticket ${sale.invoiceNumber ?? ''}`, creator: 'Boutique Gestion' },
    // Courier 7 pt : environ 8,5 pt par ligne, plus les marges.
    pageSize: { width: 80 * MM, height: lines.length * 8.5 + 8 * MM + 12 },
    pageMargins: [4 * MM, 4 * MM, 4 * MM, 4 * MM],
    defaultStyle: { font: 'Courier', fontSize: 7 },
    content: lines.map((line) => ({ text: plain(line), preserveLeadingSpaces: true })),
  });
}

/** Devis / proforma A4 avec date de validité. */
export function quotePdf(
  quote: QuoteDetail,
  shop: ShopIdentity,
  customer: { fullName: string; phone: string | null } | null,
): Promise<Buffer> {
  const document: TDocumentDefinitions = {
    info: { title: `Devis ${quote.quote.number}`, creator: 'Boutique Gestion' },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: STYLES,
    content: [
      header(shop, 'DEVIS', quote.quote.number, null),
      customerBlock(customer, [`Valable jusqu’au ${quote.quote.validUntil}`]),
      {
        table: {
          headerRows: 1,
          widths: ['*', 30, 70, 60, 75],
          body: [
            ['Désignation', 'Qté', 'Prix unit.', 'Remise', 'Montant'].map((text) => ({
              text,
              style: 'head',
            })),
            ...quote.lines.map((line) => [
              {
                stack: [
                  { text: line.description, bold: true },
                  ...(line.serialNumber === null
                    ? []
                    : [{ text: `N° ${line.serialNumber}`, fontSize: 8 }]),
                ],
              },
              { text: String(line.quantity), alignment: 'right' as const },
              { text: money(line.unitPrice), alignment: 'right' as const },
              {
                text: line.discount === 0 ? '' : `-${money(line.discount)}`,
                alignment: 'right' as const,
              },
              { text: money(line.lineTotal), alignment: 'right' as const },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      totalsTable([
        ['Sous-total', money(quote.subtotal)],
        ...(quote.discountTotal > 0
          ? [['Remises', `-${money(quote.discountTotal)}`] as [string, string]]
          : []),
        ['Total TTC', money(quote.quote.total), true],
        ...(quote.taxIncluded > 0
          ? [['dont TVA', money(quote.taxIncluded)] as [string, string]]
          : []),
      ]),
      ...(quote.notes === null ? [] : [{ text: quote.notes, margin: [0, 16, 0, 0] } as Content]),
      {
        text: 'Prix toutes taxes comprises. Ce devis ne vaut pas facture.',
        fontSize: 8,
        margin: [0, 24, 0, 0],
      },
    ],
  };
  return renderPdf(document);
}
