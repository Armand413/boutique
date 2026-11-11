import pdfmake from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/** Polices PDF standard : aucun fichier de police lu sur le disque. */
const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
  Courier: {
    normal: 'Courier',
    bold: 'Courier-Bold',
    italics: 'Courier-Oblique',
    bolditalics: 'Courier-BoldOblique',
  },
};
const STANDARD_FONTS = new Set(Object.values(FONTS).flatMap((font) => Object.values(font)));

pdfmake.setFonts(FONTS);
// Aucun accès au réseau ni au disque pendant la génération (images en data: uniquement).
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

export const MM = 72 / 25.4;

export function renderPdf(document: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(document).getBuffer();
}

/** Texte sans espaces insécables (absents des polices PDF standard). */
export function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}
