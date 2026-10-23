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

const dataDir = ensureDataDir();
const db = openDb(dataDir);
const vault = new Vault(db);
const categorizer = new Categorizer(db);
const sync = new SyncService(db, vault, categorizer);

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
  if (!config.allowedHosts.includes(host)) {
    res.status(403).end();
    return;
  }
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use('/api', createApi({ db, vault, categorizer, sync, onUnlock: catchUp }));

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text/plain; charset=utf-8').send('הממשק לא נבנה עדיין. הריצו: npm run build בתיקיית web'));
}

app.listen(config.port, config.host, () => {
  console.log(`שפע ובהירות פועל: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`תיקיית נתונים: ${dataDir}`);
});
