import { writeFileSync } from 'node:fs';
import type { TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { InventoryDetail } from '@shared/schemas/inventory';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import { writeRows } from '../catalog/catalog-io';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import { plain, renderPdf } from '../printing/pdf';
import type { InventoryService } from './inventory-service';

const STATUS: Readonly<Record<string, string>> = {
  draft: 'En préparation',
  counting: 'Comptage',
  review: 'Revue des écarts',
  validated: 'Validé',
  cancelled: 'Annulé',
};

/** Écart aligné à droite, en gras quand il n'est pas nul. */
function differenceCell(difference: number | null): TableCell {
  return {
    text: difference === null ? '—' : String(difference),
    alignment: 'right',
    bold: (difference ?? 0) !== 0,
  };
}

function reportPdf(detail: InventoryDetail): Promise<Buffer> {
  const { inventory } = detail;
  const withValue = inventory.differenceValue !== null;
  const document: TDocumentDefinitions = {
    info: { title: `Inventaire ${inventory.name}`, creator: 'Boutique Gestion' },
    pageOrientation: 'landscape',
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
    content: [
      { text: `Inventaire : ${inventory.name}`, fontSize: 14, bold: true },
      {
        text: plain(
          `${inventory.scopeLabel} · ${inventory.locationName} · ${STATUS[inventory.status] ?? inventory.status} · ouvert le ${formatDateTime(inventory.createdAt)} par ${inventory.createdBy}` +
            (inventory.validatedAt === null
              ? ''
              : ` · validé le ${formatDateTime(inventory.validatedAt)} par ${inventory.validatedBy ?? ''}`),
        ),
        margin: [0, 4, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 80, 50, 50, 50, ...(withValue ? [80] : [])],
          body: [
            [
              'Article',
              'Référence',
              'Attendu',
              'Compté',
              'Écart',
              ...(withValue ? ['Valeur'] : []),
            ].map((text) => ({ text, bold: true, fillColor: '#eeeeee' })),
            ...detail.lines.map((line) => [
              `${line.name} ${line.variantLabel}`.trim(),
              line.sku,
              { text: String(line.expected), alignment: 'right' as const },
              {
                text: line.counted === null ? '—' : String(line.counted),
                alignment: 'right' as const,
              },
              differenceCell(line.difference),
              ...(withValue
                ? [
                    {
                      text:
                        line.differenceValue === null
                          ? ''
                          : plain(formatMoney(line.differenceValue)),
                      alignment: 'right' as const,
                    },
                  ]
                : []),
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        text: `${String(inventory.differenceCount)} écart(s)${withValue ? ` · valeur des écarts : ${plain(formatMoney(inventory.differenceValue ?? 0))}` : ''}`,
        bold: true,
        margin: [0, 12, 0, 0],
      },
    ],
  };
  return renderPdf(document);
}

/** Rapport d'inventaire en PDF ou Excel (4.4), avec la valeur des écarts pour qui voit les coûts. */
export class InventoryReport {
  constructor(
    private readonly db: Db,
    private readonly inventories: InventoryService,
    private readonly dialogs: FileDialogs,
  ) {}

  async export(
    actor: Session,
    inventoryId: number,
    format: 'pdf' | 'xlsx',
  ): Promise<{ saved: boolean }> {
    requirePermission(actor, 'inventory.manage');
    const detail = this.inventories.detail(actor, inventoryId);
    const path = await this.dialogs.saveFile({
      title: 'Enregistrer le rapport d’inventaire',
      defaultName: `inventaire-${String(inventoryId)}.${format}`,
      filters: [
        format === 'pdf'
          ? { name: 'Document PDF', extensions: ['pdf'] }
          : { name: 'Classeur Excel', extensions: ['xlsx'] },
      ],
    });
    if (path === null) return { saved: false };
    if (format === 'pdf') {
      writeFileSync(path, await reportPdf(detail));
    } else {
      const withValue = detail.inventory.differenceValue !== null;
      await writeRows(
        path,
        'xlsx',
        [
          'Article',
          'Variante',
          'Référence',
          'Attendu',
          'Compté',
          'Écart',
          ...(withValue ? ['Valeur de l’écart'] : []),
          'Note',
        ],
        detail.lines.map((line) => [
          line.name,
          line.variantLabel,
          line.sku,
          line.expected,
          line.counted,
          line.difference,
          ...(withValue ? [line.differenceValue] : []),
          line.note,
        ]),
      );
    }
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'inventory.exported',
      entityType: 'inventory_session',
      entityId: inventoryId,
      details: { format },
    });
    return { saved: true };
  }
}
