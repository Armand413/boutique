import bwipjs from 'bwip-js/node';
import pdfmake from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatMoney } from '@shared/format/money';

export interface LabelData {
  name: string;
  detail: string;
  /** Valeur encodée dans le code-barres (code-barres, référence ou numéro de série). */
  code: string;
  /** Référence affichée sous le code d'une unité suivie. */
  caption: string | null;
  price: number | null;
}

export type LabelLayout = 'a4' | 'roll';

const MM = 72 / 25.4;
/** Planche A4 classique de 3 × 8 étiquettes de 70 × 37 mm ; rouleau de 50 × 30 mm. */
const LAYOUTS = {
  a4: { width: 70 * MM, height: 37 * MM, columns: 3, rows: 8 },
  roll: { width: 50 * MM, height: 30 * MM, columns: 1, rows: 1 },
} as const;

/** Polices PDF standard : aucun fichier de police lu sur le disque. */
const STANDARD_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
]);
pdfmake.setFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

/** Code 128 : lisible par tous les lecteurs, accepte lettres, chiffres et ponctuation. */
async function barcodePng(code: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: code,
    scale: 3,
    height: 9,
    includetext: true,
    textxalign: 'center',
    textsize: 9,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

async function labelContent(label: LabelData, width: number, height: number): Promise<Content> {
  const inner = width - 6 * MM;
  return {
    stack: [
      { text: truncate(label.name, 48), bold: true, fontSize: 8 },
      ...(label.detail === '' ? [] : [{ text: truncate(label.detail, 50), fontSize: 7 }]),
      {
        image: await barcodePng(label.code),
        fit: [inner, height * 0.45],
        alignment: 'center',
        margin: [0, 2, 0, 0],
      },
      ...(label.caption === null
        ? []
        : [{ text: label.caption, fontSize: 6, alignment: 'center' as const }]),
      ...(label.price === null
        ? []
        : [
            {
              text: formatMoney(label.price).replace(/\u202f|\u00a0/g, ' '),
              bold: true,
              fontSize: 10,
              alignment: 'right' as const,
            },
          ]),
    ],
    margin: [3 * MM, 2 * MM, 3 * MM, 0],
  };
}

/** Document PDF des étiquettes, prêt à imprimer. */
export async function renderLabels(
  labels: readonly LabelData[],
  layout: LabelLayout,
): Promise<Buffer> {
  const format = LAYOUTS[layout];
  const cells = await Promise.all(
    labels.map((label) => labelContent(label, format.width, format.height)),
  );
  const document: TDocumentDefinitions = {
    info: { title: 'Étiquettes', creator: 'Boutique Gestion' },
    defaultStyle: { font: 'Helvetica' },
    pageMargins: layout === 'a4' ? [0, 0.5 * MM, 0, 0] : [0, 0, 0, 0],
    pageSize: layout === 'a4' ? 'A4' : { width: format.width, height: format.height },
    content:
      layout === 'a4'
        ? sheetTables(cells, format)
        : cells.map((cell, index) =>
            index === 0 ? cell : [{ text: '', pageBreak: 'before' as const }, cell],
          ),
  };
  return pdfmake.createPdf(document).getBuffer();
}

function sheetTables(
  cells: readonly Content[],
  format: { width: number; height: number; columns: number; rows: number },
): Content[] {
  const perPage = format.columns * format.rows;
  const pages: Content[] = [];
  for (let start = 0; start < cells.length; start += perPage) {
    const page = cells.slice(start, start + perPage);
    const body: Content[][] = [];
    for (let row = 0; row < format.rows && row * format.columns < page.length; row += 1) {
      const line = page.slice(row * format.columns, (row + 1) * format.columns);
      while (line.length < format.columns) line.push({ text: '' });
      body.push(line);
    }
    pages.push({
      table: {
        widths: Array<number>(format.columns).fill(format.width),
        heights: format.height,
        body,
        dontBreakRows: true,
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      ...(start === 0 ? {} : { pageBreak: 'before' as const }),
    });
  }
  return pages;
}
