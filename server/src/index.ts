import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cron from 'node-cron';
import { config, ensureDataDir } from './config.js';
import { openDb } from './db.js';
import { Vault } from './vault.js';
import { Categorizer } from './categorize.js';
import { SyncService } from './sync.js';
import { createApi } from './api.js';
import { getMeta } from './db.js';
import { syncSumit } from './business.js';
import { remoteHost } from './remote.js';
import { applyNewIncomeRules } from './profile.js';

const dataDir = ensureDataDir();
const db = openDb(dataDir);
const vault = new Vault(db);
const categorizer = new Categorizer(db);
const sync = new SyncService(db, vault, categorizer);
applyNewIncomeRules(db, categorizer);

// After a restart the vault is locked, so the daily sync waits for the first
// unlock and then catches up on anything older than 20 hours.
function catchUp(): void {
  const stale = db
    .prepare("SELECT id FROM connections WHERE enabled = 1 AND (last_sync_at IS NULL OR last_sync_at < datetime('now', '-20 hours'))")
    .all() as { id: number }[];
  stale.forEach((r) => sync.enqueue(r.id));
}

cron.schedule(config.syncCron, () => {
  if (!vault.isUnlocked()) return;
  sync.enqueueAll();
  if (getMeta(db, 'sumit_creds')) syncSumit(db, vault, new Date().toLocaleDateString('sv-SE')).catch((e) => console.error('SUMIT sync failed', e));
});

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = (req.hostname ?? '').toLowerCase();
  // Besides localhost, only the computer's own Tailscale address, once phone access is on.
  if (!config.allowedHosts.includes(host) && host !== remoteHost(db)) {
    res.status(403).end();
    return;
  }
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  // Financial data stays out of the browser's disk cache.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
// The user's uploaded font. Served without a session so CSS @font-face can load it.
app.get('/fonts/:file', (req, res) => {
  const file = req.params.file;
  if (!/^custom-\d+\.(woff2|woff|ttf|otf)$/.test(file)) {
    res.status(404).end();
    return;
  }
  const full = path.join(dataDir, 'fonts', file);
  if (!fs.existsSync(full)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(full);
});
app.use('/api', createApi({ db, vault, categorizer, sync, onUnlock: catchUp }));

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text/plain; charset=utf-8').send('הממשק לא נבנה עדיין. הריצו: npm run build בתיקיית web'));
}

// The installed app's "stop" shortcut reads this to end the background server.
const pidFile = path.join(dataDir, 'shefa.pid');
fs.writeFileSync(pidFile, String(process.pid));
const cleanup = () => {
  try {
    if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile);
  } catch {
    /* already gone */
  }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));

app.listen(config.port, config.host, () => {
  console.log(`שפע ובהירות פועל: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`תיקיית נתונים: ${dataDir}`);
});
