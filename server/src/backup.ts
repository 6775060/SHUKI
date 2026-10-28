import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, openDb, transaction, type DB } from './db.js';

// Moving to another computer: one file that holds the whole database and the
// user's font, sealed with the master password (scrypt + AES-256-GCM). Without
// the password the file is unreadable, so it is safe on a USB stick.

const MAGIC = Buffer.from('SHEFA-BACKUP-1\n');
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupError extends Error {
  constructor(public code: 'NOT_A_BACKUP' | 'WRONG_PASSWORD' | 'NEWER_VERSION' | 'CORRUPT') {
    super(code);
  }
}

interface Payload {
  version: number;
  createdAt: string;
  db: string;
  files: Record<string, string>;
}

function key(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
}

function tmpPath(dataDir: string, name: string): string {
  return path.join(dataDir, `${name}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function removeDb(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export function createBackup(db: DB, dataDir: string, password: string): Buffer {
  // VACUUM INTO gives a consistent copy even while the app is writing.
  const snap = tmpPath(dataDir, 'backup');
  let dbBytes: Buffer;
  try {
    db.prepare('VACUUM INTO ?').run(snap);
    dbBytes = fs.readFileSync(snap);
  } finally {
    removeDb(snap);
  }
  const files: Record<string, string> = {};
  const fontDir = path.join(dataDir, 'fonts');
  if (fs.existsSync(fontDir)) {
    for (const f of fs.readdirSync(fontDir)) files[`fonts/${f}`] = fs.readFileSync(path.join(fontDir, f)).toString('base64');
  }
  const payload: Payload = { version: 1, createdAt: new Date().toISOString(), db: dbBytes.toString('base64'), files };
  const plain = zlib.gzipSync(JSON.stringify(payload));

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(password, salt), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), data]);
}

function openBackup(file: Buffer, password: string): Payload {
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('NOT_A_BACKUP');
  let at = MAGIC.length;
  const salt = file.subarray(at, (at += 16));
  const iv = file.subarray(at, (at += 12));
  const tag = file.subarray(at, (at += 16));
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(password, salt), iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(file.subarray(at)), decipher.final()]);
  } catch {
    throw new BackupError('WRONG_PASSWORD');
  }
  try {
    return JSON.parse(zlib.gunzipSync(plain).toString('utf8')) as Payload;
  } catch {
    throw new BackupError('CORRUPT');
  }
}

export interface RestoreResult {
  createdAt: string;
  transactions: number;
  connections: number;
  previousCopy: string | null;
}

// Replaces everything in the running database with the backup's contents, in one
// transaction, so the app keeps its open connection and needs no restart.
export function restoreBackup(db: DB, dataDir: string, file: Buffer, password: string): RestoreResult {
  const payload = openBackup(file, password);
  const incoming = tmpPath(dataDir, 'restore');
  fs.writeFileSync(incoming, Buffer.from(payload.db, 'base64'));
  try {
    // Check it and bring an older backup up to this version's schema first.
    try {
      const probe = new DatabaseSync(incoming);
      const ok = (probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      const version = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      probe.close();
      if (ok !== 'ok' || version < 1) throw new BackupError('CORRUPT');
      if (version > SCHEMA_VERSION) throw new BackupError('NEWER_VERSION');
    } catch (err) {
      throw err instanceof BackupError ? err : new BackupError('CORRUPT');
    }
    const upgraded = openDb(path.dirname(incoming), path.basename(incoming));
    upgraded.exec('PRAGMA journal_mode = DELETE');
    upgraded.close();

    // Keep what was here, in case the wrong file was chosen.
    let previousCopy: string | null = null;
    const has = db.prepare("SELECT 1 FROM meta WHERE key = 'vault_salt'").get();
    if (has) {
      previousCopy = path.join(dataDir, `shefa-before-restore-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`);
      db.prepare('VACUUM INTO ?').run(previousCopy);
    }

    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('ATTACH DATABASE ? AS r').run(incoming);
    try {
      const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
      const cols = (schema: string, t: string) => (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      transaction(db, () => {
        for (const t of tables) {
          db.exec(`DELETE FROM main."${t}"`);
          const theirs = new Set(cols('r', t));
          const shared = cols('main', t).filter((c) => theirs.has(c)).map((c) => `"${c}"`);
          if (shared.length) db.exec(`INSERT INTO main."${t}" (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM r."${t}"`);
        }
        const seq = "SELECT 1 FROM %s.sqlite_master WHERE name = 'sqlite_sequence'";
        if (db.prepare(seq.replace('%s', 'main')).get() && db.prepare(seq.replace('%s', 'r')).get()) {
          db.exec('DELETE FROM main.sqlite_sequence');
          db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM r.sqlite_sequence');
        }
        // The old computer's Tailscale address means nothing here.
        db.exec("DELETE FROM meta WHERE key = 'remote_host'");
      });
    } finally {
      db.exec('DETACH DATABASE r');
      db.exec('PRAGMA foreign_keys = ON');
    }

    const fontDir = path.join(dataDir, 'fonts');
    if (fs.existsSync(fontDir)) for (const f of fs.readdirSync(fontDir)) fs.rmSync(path.join(fontDir, f));
    for (const [rel, b64] of Object.entries(payload.files ?? {})) {
      const name = path.basename(rel);
      if (!rel.startsWith('fonts/') || !/^custom-\d+\.(woff2|woff|ttf|otf)$/.test(name)) continue;
      fs.mkdirSync(fontDir, { recursive: true });
      fs.writeFileSync(path.join(fontDir, name), Buffer.from(b64, 'base64'));
    }

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { createdAt: payload.createdAt, transactions: count('transactions'), connections: count('connections'), previousCopy };
  } finally {
    removeDb(incoming);
  }
}
