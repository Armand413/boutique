import { writeFileSync } from 'node:fs';
import type { TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatDateTime, isIsoUtc } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type { ReportColumn, ReportRequest, ReportResult, ReportRow } from '@shared/schemas/reports';
import { writeRows } from '../catalog/catalog-io';
import { plain, renderPdf } from '../printing/pdf';
import { COLUMN_LABELS, ENUM_LABELS, periodText, reportTitle } from './report-labels';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';

function label(column: ReportColumn): string {
  return COLUMN_LABELS[column.key] ?? column.key;
}

/** Valeur de tableur : nombres conservés, codes traduits, dates lisibles. */
function sheetValue(
  column: ReportColumn,
  value: ReportRow[string] | undefined,
): string | number | null {
  if (value === null || value === undefined) return null;
  if (column.type === 'enum' && column.enumKey !== null && typeof value === 'string') {
    return ENUM_LABELS[column.enumKey][value] ?? value;
  }
  if (column.type === 'datetime' && typeof value === 'string' && isIsoUtc(value)) {
    return formatDateTime(value);
  }
  return value;
}

/** Texte d'une cellule PDF, montants et pourcentages formatés. */
function pdfText(column: ReportColumn, value: ReportRow[string] | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (column.type === 'money') return plain(formatMoney(value));
    if (column.type === 'percent') return plain(`${value.toLocaleString('fr-FR')} %`);
    return plain(value.toLocaleString('fr-FR'));
  }
  return plain(String(sheetValue(column, value) ?? ''));
}

function numeric(column: ReportColumn): boolean {
  return column.type === 'int' || column.type === 'money' || column.type === 'percent';
}

function pdfRow(columns: readonly ReportColumn[], row: ReportRow, bold = false): TableCell[] {
  return columns.map((column) => ({
    text: pdfText(column, row[column.key]),
    alignment: numeric(column) ? 'right' : 'left',
    ...(bold ? { bold: true } : {}),
  }));
}

function reportPdf(request: ReportRequest, result: ReportResult): Promise<Buffer> {
  const period = periodText(request);
  const wide = result.columns.length > 9;
  const document: TDocumentDefinitions = {
    info: { title: reportTitle(request), creator: 'Boutique Gestion' },
    pageOrientation: 'landscape',
    pageMargins: [24, 28, 24, 28],
    defaultStyle: { font: 'Helvetica', fontSize: wide ? 7 : 9 },
    content: [
      { text: reportTitle(request), fontSize: 14, bold: true },
      {
        text: plain(
          [period, `édité le ${formatDateTime(result.generatedAt)}`].filter(Boolean).join(' · '),
        ),
        margin: [0, 4, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: result.columns.map((_column, index) => (index === 0 ? '*' : 'auto')),
          body: [
            result.columns.map((column) => ({
              text: label(column),
              bold: true,
              fillColor: '#eeeeee',
              alignment: numeric(column) ? 'right' : 'left',
            })),
            ...result.rows.map((row) => pdfRow(result.columns, row)),
            ...(result.totals === null ? [] : [pdfRow(result.columns, result.totals, true)]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      ...(result.rows.length === 0
        ? [
            {
              text: 'Aucune donnée sur cette période.',
              margin: [0, 12, 0, 0] as [number, number, number, number],
            },
          ]
        : []),
    ],
  };
  return renderPdf(document);
}

/** Écrit le rapport complet au format demandé (4.8 : PDF, Excel et CSV). */
export async function writeReport(
  path: string,
  format: ExportFormat,
  request: ReportRequest,
  result: ReportResult,
): Promise<void> {
  if (format === 'pdf') {
    writeFileSync(path, await reportPdf(request, result));
    return;
  }
  const rows = [...result.rows, ...(result.totals === null ? [] : [result.totals])];
  await writeRows(
    path,
    format,
    result.columns.map(label),
    rows.map((row) => result.columns.map((column) => sheetValue(column, row[column.key]))),
    'Rapport',
  );
}
