import { CharacterSet, PrinterTypes, ThermalPrinter } from 'node-thermal-printer';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { SaleDetail } from '@shared/schemas/sales';

/** Largeur en caractères : rouleau de 58 mm (32) ou de 80 mm (48). */
export type TicketWidth = 32 | 48;

const METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Espèces',
  card: 'Carte',
  mobile_money: 'Mobile money',
  transfer: 'Virement',
  cheque: 'Chèque',
};

/** Montant sans espace insécable (les imprimantes thermiques ne les connaissent pas). */
function amount(value: number): string {
  return formatMoney(value).replace(/[\u00a0\u202f]/g, ' ');
}

function leftRight(left: string, right: string, width: number): string {
  const space = width - right.length - 1;
  const head = left.length > space ? `${left.slice(0, Math.max(space - 1, 0))}…` : left;
  return `${head}${' '.repeat(Math.max(width - head.length - right.length, 1))}${right}`;
}

function center(text: string, width: number): string {
  const trimmed = text.slice(0, width);
  return `${' '.repeat(Math.floor((width - trimmed.length) / 2))}${trimmed}`;
}

/**
 * Contenu du ticket de caisse, ligne par ligne (aperçu à l'écran, simulateur, impression).
 * Prix TTC : la TVA comprise est indiquée en pied de ticket.
 */
export function ticketLines(
  sale: SaleDetail,
  shopName: string,
  width: TicketWidth,
  extra: { header?: string[]; footer?: string[] } = {},
): string[] {
  const rule = '-'.repeat(width);
  const lines: string[] = [
    center(shopName, width),
    ...(extra.header ?? []).map((line) => center(line, width)),
    center(`Ticket ${sale.invoiceNumber ?? ''}`, width),
  ];
  if (sale.completedAt !== null) lines.push(center(formatDateTime(sale.completedAt), width));
  lines.push(center(`Vendeur : ${sale.userName}`, width));
  if (sale.customer !== null) lines.push(center(`Client : ${sale.customer.fullName}`, width));
  lines.push(rule);
  for (const line of sale.lines) {
    if (line.lineType === 'kit_component') {
      lines.push(`  ${String(line.quantity)} x ${line.name}`.slice(0, width));
      if (line.serialNumber !== null) lines.push(`    N° ${line.serialNumber}`.slice(0, width));
      continue;
    }
    const name = line.variantLabel === '' ? line.name : `${line.name} ${line.variantLabel}`;
    lines.push(
      leftRight(
        `${String(line.quantity)} x ${name}`,
        amount(line.quantity * line.unitPrice),
        width,
      ),
    );
    if (line.discount > 0) lines.push(leftRight('  Remise', `-${amount(line.discount)}`, width));
    if (line.serialNumber !== null) lines.push(`  N° ${line.serialNumber}`.slice(0, width));
    if (line.warrantyEnd !== null)
      lines.push(`  Garantie jusqu'au ${line.warrantyEnd}`.slice(0, width));
  }
  lines.push(rule);
  if (sale.discountTotal > 0) {
    lines.push(leftRight('Sous-total', amount(sale.subtotal), width));
    lines.push(leftRight('Remises', `-${amount(sale.discountTotal)}`, width));
  }
  lines.push(leftRight('TOTAL TTC', amount(sale.total), width));
  if (sale.taxIncluded > 0) lines.push(leftRight('dont TVA', amount(sale.taxIncluded), width));
  for (const payment of sale.payments) {
    lines.push(
      leftRight(METHOD_LABELS[payment.method] ?? payment.method, amount(payment.amount), width),
    );
  }
  if (sale.remaining > 0) {
    lines.push(leftRight('Reste à payer', amount(sale.remaining), width));
    if (sale.dueDate !== null) lines.push(`Échéance finale : ${sale.dueDate}`.slice(0, width));
  }
  lines.push(rule, center('Merci de votre visite', width));
  for (const line of extra.footer ?? []) lines.push(center(line, width));
  return lines;
}

/** Commandes ESC/POS du ticket (jeu de caractères PC858 pour les accents et l'euro). */
export function escposTicket(
  sale: SaleDetail,
  shopName: string,
  width: TicketWidth,
  target: string,
  extra: { header?: string[]; footer?: string[] } = {},
): ThermalPrinter {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: target,
    width,
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
  });
  const lines = ticketLines(sale, shopName, width, extra);
  printer.alignCenter();
  printer.bold(true);
  printer.println(lines[0] ?? shopName);
  printer.bold(false);
  printer.alignLeft();
  for (const line of lines.slice(1)) printer.println(line);
  if (sale.invoiceNumber !== null) {
    printer.alignCenter();
    printer.code128(sale.invoiceNumber);
  }
  printer.cut();
  return printer;
}

/** Ticket d'essai (paramètres, 4.11) : vérifie l'adresse, la largeur et les accents de l'imprimante. */
export function escposTestTicket(
  shopName: string,
  width: TicketWidth,
  target: string,
  header: string[],
): ThermalPrinter {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: target,
    width,
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
  });
  printer.alignCenter();
  printer.bold(true);
  printer.println(shopName.slice(0, width));
  printer.bold(false);
  for (const line of header) printer.println(line.slice(0, width));
  printer.println('-'.repeat(width));
  printer.println('Ticket d’essai : éèàçù €'.slice(0, width));
  printer.println(`Largeur : ${String(width)} caractères`.slice(0, width));
  printer.println(formatDateTime(new Date().toISOString()));
  printer.cut();
  return printer;
}
