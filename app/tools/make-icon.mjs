// Renders assets/icon.svg to assets/icon.png (256 px) and assets/icon.ico (16..256 px, PNG entries).
// Run after editing the SVG: node_modules/electron/dist/electron.exe tools/make-icon.mjs (from app/).
import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ICO with PNG payloads (Windows Vista and later read these).
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,<style>html,body{margin:0;background:transparent}</style><img style="width:512px;height:512px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
  await new Promise((r) => setTimeout(r, 300));
  const big = await win.capturePage();
  const pngs = SIZES.map((size) => ({ size, data: big.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(dir, 'icon.png'), pngs.at(-1).data);
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(pngs));
  console.log('icon.png, icon.ico written', nativeImage.createFromBuffer(pngs.at(-1).data).getSize());
  app.quit();
});
