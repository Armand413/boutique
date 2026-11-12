// `npm run docs:pdf` : produit docs/GUIDE_UTILISATEUR.pdf (A4, illustré) depuis docs/GUIDE_UTILISATEUR.md avec le
// moteur d'impression d'Electron. Convertisseur limité au Markdown du guide : titres, paragraphes, listes, tableaux,
// images, gras, code et liens. Outil de documentation, hors de l'application.
const { app, BrowserWindow } = require('electron');
const { readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const docs = join(root, 'docs');

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((#[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

function slug(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function table(rows) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => inline(cell.trim()));
  const [head, , ...body] = rows;
  return `<table><thead><tr>${cells(head)
    .map((cell) => `<th>${cell}</th>`)
    .join('')}</tr></thead><tbody>${body
    .map(
      (row) =>
        `<tr>${cells(row)
          .map((cell) => `<td>${cell}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

function convert(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level} id="${slug(heading[2])}">${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image) {
      html.push(
        `<figure><img src="${image[2]}" alt="${escapeHtml(image[1])}"><figcaption>${escapeHtml(image[1])}</figcaption></figure>`,
      );
      index += 1;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith('|')) rows.push(lines[index++]);
      html.push(table(rows));
      continue;
    }
    const list = /^(\s*)(-|\d+\.) /.exec(line);
    if (list) {
      const ordered = list[2] !== '-';
      const items = [];
      while (index < lines.length && lines[index].trim() !== '') {
        const item = /^(-|\d+\.) (.*)$/.exec(lines[index]);
        if (item) items.push(item[2]);
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (line.startsWith('```')) {
      const block = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) block.push(lines[index++]);
      index += 1;
      html.push(`<pre>${escapeHtml(block.join('\n'))}</pre>`);
      continue;
    }
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#|\||!\[|-\s|\d+\.\s|```)/.test(lines[index])
    ) {
      paragraph.push(lines[index++].trim());
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Inter, "Segoe UI", sans-serif; font-size: 10.5pt; line-height: 1.5; color: #111827; }
  h1 { font-size: 22pt; color: #4338ca; margin: 0 0 12pt; }
  h2 { font-size: 15pt; color: #4338ca; margin: 18pt 0 6pt; break-before: page; }
  h2#sommaire { break-before: auto; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  a { color: inherit; text-decoration: none; }
  code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f3f4f6; padding: 0 2pt; border-radius: 2pt; }
  pre { background: #f3f4f6; padding: 6pt; font-size: 9pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: 1px solid #d1d5db; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eef2ff; }
  figure { margin: 8pt 0; break-inside: avoid; text-align: center; }
  img { max-width: 100%; border: 1px solid #d1d5db; border-radius: 4pt; }
  figcaption { font-size: 9pt; color: #6b7280; margin-top: 2pt; }
  li { margin: 2pt 0; }
`;

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const markdown = readFileSync(join(docs, 'GUIDE_UTILISATEUR.md'), 'utf8');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Boutique Gestion — Guide utilisateur</title><base href="${pathToFileURL(docs).href}/"><style>${STYLE}</style></head><body>${convert(markdown)}</body></html>`;
    const page = join(docs, '.guide.html');
    writeFileSync(page, html);
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    await window.loadFile(page);
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8pt;color:#6b7280;width:100%;text-align:center">Boutique Gestion — Guide utilisateur — <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margins: { top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 },
    });
    writeFileSync(join(docs, 'GUIDE_UTILISATEUR.pdf'), pdf);
    rmSync(page);
    window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
