import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function defaultDataDir(): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'ShefaUBehirut');
  }
  return path.join(os.homedir(), '.shefa-u-behirut');
}

export const config = {
  dataDir: process.env.SHEFA_DATA_DIR ?? defaultDataDir(),
  // Bound to localhost only. Phone access comes later through Tailscale.
  host: process.env.SHEFA_HOST ?? '127.0.0.1',
  port: Number(process.env.SHEFA_PORT ?? 4870),
  // Requests must name one of these hosts; blocks DNS-rebinding from web pages.
  allowedHosts: (process.env.SHEFA_ALLOWED_HOSTS ?? '127.0.0.1,localhost').split(',').map((h) => h.trim().toLowerCase()),
  // Daily automatic sync (cron syntax, local time).
  syncCron: process.env.SHEFA_SYNC_CRON ?? '30 6 * * *',
  // Optional: path to an existing Chrome/Chromium for the bank scrapers.
  chromePath: process.env.SHEFA_CHROME_PATH,
  showBrowser: process.env.SHEFA_SHOW_BROWSER === '1',
  // How far back the first sync of a new connection goes.
  initialSyncMonths: Number(process.env.SHEFA_INITIAL_MONTHS ?? 6),
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

export function ensureDataDir(): string {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'screenshots'), { recursive: true });
  return config.dataDir;
}
