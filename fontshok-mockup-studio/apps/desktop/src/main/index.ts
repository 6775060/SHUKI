/**
 * Electron main process: window, IPC whitelist, services wiring.
 */
import { app, BrowserWindow, dialog, ipcMain, net, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Db } from '@fontshok/db';
import { FigmaBridge } from '@fontshok/figma-bridge';
import { SiteCapturer } from '@fontshok/scanner';
import { FsGuard } from '@fontshok/exporter';
import { toAppError } from '@fontshok/shared';
import { STUDIO_METHODS, type StudioEvent, type StudioMethod } from './api.js';
import { Studio } from './core/studio.js';
import { loadSettings } from './core/settings.js';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) app.quit();

async function main() {
  await app.whenReady();
  const dataDir = join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  const db = new Db(join(dataDir, 'studio.sqlite'));
  const initial = loadSettings(db);

  let studio: Studio | null = null;
  const bridge = new FigmaBridge({
    port: initial.wsPort,
    token: () => studio?.getSettings().pairingToken ?? initial.pairingToken,
    appVersion: app.getVersion(),
  });
  try {
    await bridge.start();
  } catch (e) {
    dialog.showErrorBox('FontShok Mockup Studio', `לא ניתן לפתוח את פורט החיבור ל־Figma (${initial.wsPort}).\n${toAppError(e).message}`);
  }

  const capturer = new SiteCapturer(initial.browserChannel ? { channel: initial.browserChannel } : {});
  // Chromium network stack: honours the system proxy and certificates.
  const fetchText = async (url: string) => {
    const res = await net.fetch(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  };
  studio = new Studio({ db, dataDir, bridge, capturer, fetchText });
  studio.on('event', (e: StudioEvent) => win?.webContents.send('studio:event', e));

  const trusted = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
  };

  ipcMain.handle('studio:call', async (e, method: string, args: unknown[]) => {
    if (!trusted(e)) return { ok: false, error: { code: 'FORBIDDEN', message: 'untrusted sender' } };
    if (!(STUDIO_METHODS as readonly string[]).includes(method)) return { ok: false, error: { code: 'FORBIDDEN', message: `unknown method ${method}` } };
    try {
      const fn = (studio as unknown as Record<StudioMethod, (...a: unknown[]) => unknown>)[method as StudioMethod];
      const value = await fn.apply(studio, Array.isArray(args) ? args : []);
      return { ok: true, value };
    } catch (err) {
      const ae = toAppError(err);
      return { ok: false, error: { code: ae.code, message: ae.message } };
    }
  });

  ipcMain.handle('studio:pickFolder', async (e) => {
    if (!trusted(e) || !win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle('studio:reveal', async (e, path: string) => {
    if (!trusted(e) || !studio) return false;
    const s = studio.getSettings();
    const guard = new FsGuard([dataDir, s.exportRoot, ...s.extraAllowedDirs]);
    if (!guard.isAllowed(path)) return false;
    shell.showItemInFolder(path);
    return true;
  });

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  app.on('window-all-closed', async () => {
    await bridge.stop();
    await capturer.close();
    db.close();
    app.quit();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'FontShok Mockup Studio',
    backgroundColor: '#f6f5f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // never navigate away or open new windows from the renderer
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL(pathToFileURL(join(__dirname, '../renderer/index.html')).toString());
}

main().catch((e) => {
  dialog.showErrorBox('FontShok Mockup Studio', toAppError(e).message);
  app.exit(1);
});
