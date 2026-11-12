// Génère build/icon.ico (16 à 256 px, images PNG) depuis build/icon.svg avec le rendu d'Electron.
// Lancement : npx electron scripts/make-icon.cjs (outil de développement, hors application).
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const root = join(__dirname, '..');

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

app
  .whenReady()
  .then(async () => {
    const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8');
    const window = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
    });
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const master = await window.webContents.capturePage();
    const base = master.resize({ width: 256, height: 256, quality: 'best' });
    const images = SIZES.map((size) => ({
      size,
      png: (size === 256
        ? base
        : base.resize({ width: size, height: size, quality: 'best' })
      ).toPNG(),
    }));
    writeFileSync(join(root, 'build', 'icon.png'), base.toPNG());
    writeFileSync(join(root, 'build', 'icon.ico'), ico(images));
    window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
