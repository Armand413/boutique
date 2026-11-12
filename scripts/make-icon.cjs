// Génère build/icon.ico (16 à 256 px) et build/icon.png depuis l'emblème rond du logo de la boutique
// (build/logo-bouba-store.webp) : le cercle est repéré dans la moitié haute de l'image (le texte en dessous serait
// illisible en petit), recadré et détouré, puis redessiné à chaque taille par le moteur de rendu d'Electron.
// Lancement : npx electron scripts/make-icon.cjs (outil de développement, hors application).
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const root = join(__dirname, '..');
const source = join(root, 'build', 'logo-bouba-store.webp');

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

/* global Image, document -- RENDER s'exécute dans la page, pas dans Node. */

/** Exécuté dans la page : repère le cercle, puis dessine chaque taille ; renvoie des PNG en base 64. */
const RENDER = (url, sizes) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('Logo illisible'));
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      const probe = document.createElement('canvas');
      probe.width = width;
      probe.height = height;
      const context = probe.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, width, height);
      // Pixels « encre » (ni blancs ni presque blancs), rang par rang depuis le haut : l'emblème rond s'arrête au
      // rang où l'encre s'étale d'un coup vers les bords (début du nom « BOUBA STORE », plus large que le cercle).
      const span = (y) => {
        let [first, last] = [-1, -1];
        for (let x = 0; x < width; x += 1) {
          const at = (y * width + x) * 4;
          if (Math.min(data[at], data[at + 1], data[at + 2]) < 140) {
            if (first < 0) first = x;
            last = x;
          }
        }
        return [first, last];
      };
      let top = 0;
      while (top < height && span(top)[0] < 0) top += 1;
      let [left, bottom] = [width, top];
      for (let y = top; y < height; y += 1) {
        const [first] = span(y);
        if (first < 0) break;
        if (y > top + 100 && first < left - 100) break;
        left = Math.min(left, first);
        bottom = y;
      }
      // Largeur mesurée sur la bande centrale, là où le cercle est le plus large (les bords haut et bas peuvent
      // toucher le halo ou le début du texte).
      [left] = [width];
      let right = 0;
      const band = (bottom - top) / 4;
      for (let y = Math.round(top + band); y <= Math.round(bottom - band); y += 1) {
        const [first, last] = span(y);
        left = Math.min(left, first);
        right = Math.max(right, last);
      }
      // Le cercle (légèrement plus large que haut) est ramené au carré de l'icône.
      const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
      const result = sizes.map((size) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const target = canvas.getContext('2d');
        target.imageSmoothingQuality = 'high';
        target.beginPath();
        target.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        target.clip();
        target.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      resolve({ circle: box, result });
    };
    image.src = url;
  });

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false });
    await window.loadURL('about:blank');
    const { circle, result } = await window.webContents.executeJavaScript(
      `(${RENDER.toString()})(${JSON.stringify(`data:image/webp;base64,${readFileSync(source).toString('base64')}`)}, ${JSON.stringify(SIZES)})`,
    );
    const images = SIZES.map((size, index) => ({
      size,
      png: Buffer.from(result[index], 'base64'),
    }));
    writeFileSync(join(root, 'build', 'icon.png'), images.at(-1).png);
    writeFileSync(join(root, 'build', 'icon.ico'), ico(images));
    console.log(`Icône générée (cercle : ${JSON.stringify(circle)}).`);
    window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
