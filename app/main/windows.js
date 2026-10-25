// StripWindow and MainWindow (arch section 6): sandboxed, local pages only, one preload.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { savedPosition } from './placement.js';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const PRELOAD = path.join(APP_DIR, 'preload', 'preload.cjs');
const page = (name) => path.join(APP_DIR, 'renderer', name, 'index.html');

const WEB_PREFS = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };

// Deny every navigation and popup; the iframe may load only the monitor html file.
function lockDown(win, pageUrl, frameUrl) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => { if (e.url.split('#')[0] !== pageUrl) e.preventDefault(); });
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return;
    if (!frameUrl || e.url.split('#')[0] !== frameUrl()) e.preventDefault();
  });
}

class AppWindow {
  constructor(name) {
    this.name = name;
    this.pageUrl = pathToFileURL(page(name)).href;
    this.win = null;
  }

  isAlive() { return this.win !== null && !this.win.isDestroyed(); }

  // True when the IPC event comes from this window's own top page.
  owns(event) {
    if (!this.isAlive() || event.sender.id !== this.win.webContents.id) return false;
    const url = event.senderFrame?.url ?? '';
    return url.split('#')[0] === this.pageUrl && event.senderFrame === this.win.webContents.mainFrame;
  }

  send(channel, data) {
    if (this.isAlive()) this.win.webContents.send(channel, data);
  }
}

export class StripWindow extends AppWindow {
  static WIDTH = 620;
  static HEIGHT = 34;
  static MARGIN = 8;

  // store: { load() -> {x,y} | null, save({x,y}) } keeps the dragged position across restarts.
  constructor(store = { load: () => null, save: () => {} }) {
    super('strip');
    this.store = store;
  }

  create() {
    this.win = new BrowserWindow({
      width: StripWindow.WIDTH, height: StripWindow.HEIGHT, frame: false, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: true,
      skipTaskbar: true, transparent: false, show: false, title: 'Claude Monitor',
      webPreferences: WEB_PREFS,
    });
    // 'screen-saver' level keeps it above the taskbar and maximized windows.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    lockDown(this.win, this.pageUrl);
    this.win.once('ready-to-show', () => this.win.showInactive());
    const size = { width: StripWindow.WIDTH, height: StripWindow.HEIGHT };
    const pos = savedPosition(this.store.load(), size, screen.getAllDisplays().map((d) => d.workArea));
    if (pos) this.win.setBounds({ ...pos, ...size });
    else this.moveToCorner();
    this.win.on('moved', () => { const [x, y] = this.win.getPosition(); this.store.save({ x, y }); });
    this.win.loadURL(this.pageUrl);
    return this;
  }

  moveToCorner() {
    if (!this.isAlive()) return;
    this.store.save(null);
    const { workArea } = screen.getPrimaryDisplay();
    const x = workArea.x + workArea.width - StripWindow.WIDTH - StripWindow.MARGIN;
    const y = workArea.y + workArea.height - StripWindow.HEIGHT - StripWindow.MARGIN;
    this.win.setBounds({ x, y, width: StripWindow.WIDTH, height: StripWindow.HEIGHT });
  }
}

export class MainWindow extends AppWindow {
  constructor(frameUrl) {
    super('main');
    this.frameUrl = frameUrl;
  }

  open(tab = 'ov') {
    if (!this.isAlive()) {
      this.win = new BrowserWindow({
        width: 1280, height: 860, minWidth: 900, minHeight: 600, show: false,
        title: 'Claude Monitor', autoHideMenuBar: true, webPreferences: WEB_PREFS,
      });
      this.win.setMenu(null);
      lockDown(this.win, this.pageUrl, this.frameUrl);
      this.win.once('ready-to-show', () => this.win.show());
      this.win.loadURL(`${this.pageUrl}#${tab}`);
      return;
    }
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
    // Same-document hash change: the shell listens for hashchange.
    this.win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(tab)}`).catch(() => {});
  }
}
