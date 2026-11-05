import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { getMeta, setMeta, type DB } from './db.js';
import type { Vault } from './vault.js';
import type { Coach, ReadDocument } from './coach.js';
import { merchantKey } from './categorize.js';

// Invoices and receipts, gathered from Gmail and from a Drive folder (Google
// Drive for desktop keeps it as an ordinary folder on the computer), read by
// the coach's model, and matched to the bank or card transaction they belong to.
// A copy of each file is kept in the data folder.

export type ReceiptSource = 'gmail' | 'drive' | 'upload';

export interface Receipt {
  id: number;
  source: ReceiptSource;
  fileName: string;
  status: 'new' | 'read' | 'not_invoice' | 'failed';
  vendor: string | null;
  docDate: string | null;
  amount: number | null;
  vat: number | null;
  number: string | null;
  error: string | null;
  txnId: number | null;
  txn: { date: string; description: string; amount: number } | null;
  createdAt: string;
}

const KINDS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const MAX_BYTES = 15 * 1024 * 1024;
const PER_RUN = 40; // files read per scan, so a first scan of a big folder stays affordable

export class Receipts {
  private running = false;

  constructor(
    private db: DB,
    private vault: Vault,
    private coach: Coach,
    private dataDir: string,
  ) {}

  private dir(): string {
    const d = path.join(this.dataDir, 'receipts');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  settings() {
    const gmail = getMeta(this.db, 'gmail_creds');
    return {
      gmail: gmail ? { email: this.vault.open<{ email: string }>(gmail).email } : null,
      gmailLastSync: getMeta(this.db, 'gmail_last_sync') ?? null,
      gmailError: getMeta(this.db, 'gmail_error') ?? null,
      folder: getMeta(this.db, 'receipts_folder') ?? null,
      folderLastScan: getMeta(this.db, 'receipts_folder_scan') ?? null,
      folderError: getMeta(this.db, 'receipts_folder_error') ?? null,
      canRead: this.coach.enabled(),
      running: this.running,
    };
  }

  list(limit = 150): Receipt[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, t.date AS t_date, t.description AS t_desc, t.amount AS t_amount FROM receipts r
         LEFT JOIN transactions t ON t.id = r.txn_id ORDER BY COALESCE(r.doc_date, r.created_at) DESC, r.id DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      source: r.source as ReceiptSource,
      fileName: r.file_name as string,
      status: r.status as Receipt['status'],
      vendor: (r.vendor as string) ?? null,
      docDate: (r.doc_date as string) ?? null,
      amount: (r.amount as number) ?? null,
      vat: (r.vat as number) ?? null,
      number: (r.doc_number as string) ?? null,
      error: (r.error as string) ?? null,
      txnId: (r.txn_id as number) ?? null,
      txn: r.t_date ? { date: r.t_date as string, description: r.t_desc as string, amount: r.t_amount as number } : null,
      createdAt: r.created_at as string,
    }));
  }

  file(id: number): { path: string; mime: string; name: string } | null {
    const r = this.db.prepare('SELECT file_path, mime, file_name FROM receipts WHERE id = ?').get(id) as { file_path: string; mime: string; file_name: string } | undefined;
    if (!r) return null;
    const full = path.join(this.dir(), path.basename(r.file_path));
    return fs.existsSync(full) ? { path: full, mime: r.mime, name: r.file_name } : null;
  }

  // Keeps one copy of a file; the same file seen again is ignored.
  add(source: ReceiptSource, externalId: string, fileName: string, data: Buffer, mime: string): number | null {
    if (data.length > MAX_BYTES) return null;
    const exists = this.db.prepare('SELECT id FROM receipts WHERE source = ? AND external_id = ?').get(source, externalId);
    if (exists) return null;
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    if (this.db.prepare('SELECT id FROM receipts WHERE file_hash = ?').get(hash)) return null;
    const ext = Object.entries(KINDS).find(([, m]) => m === mime)?.[0] ?? '.bin';
    const stored = `${hash.slice(0, 24)}${ext}`;
    fs.writeFileSync(path.join(this.dir(), stored), data);
    return this.db
      .prepare("INSERT INTO receipts (source, external_id, file_name, file_path, file_hash, mime, status) VALUES (?, ?, ?, ?, ?, ?, 'new')")
      .run(source, externalId, fileName.slice(0, 200), stored, hash, mime).lastInsertRowid as number;
  }

  // ---------- Drive folder ----------

  setFolder(folder: string | null): void {
    if (!folder) {
      this.db.prepare("DELETE FROM meta WHERE key IN ('receipts_folder', 'receipts_folder_scan', 'receipts_folder_error')").run();
      return;
    }
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('FOLDER_NOT_FOUND');
    setMeta(this.db, 'receipts_folder', folder);
    this.db.prepare("DELETE FROM meta WHERE key = 'receipts_folder_error'").run();
  }

  scanFolder(): number {
    const folder = getMeta(this.db, 'receipts_folder');
    if (!folder) return 0;
    let added = 0;
    try {
      const walk = (dir: string, depth: number) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (depth < 4 && !e.name.startsWith('.')) walk(full, depth + 1);
            continue;
          }
          const mime = KINDS[path.extname(e.name).toLowerCase()];
          if (!mime) continue;
          const st = fs.statSync(full);
          if (st.size > MAX_BYTES) continue;
          const id = `${path.relative(folder, full)}|${st.size}|${Math.round(st.mtimeMs)}`;
          if (this.db.prepare("SELECT 1 FROM receipts WHERE source = 'drive' AND external_id = ?").get(id)) continue;
          if (this.add('drive', id, e.name, fs.readFileSync(full), mime)) added++;
        }
      };
      walk(folder, 0);
      setMeta(this.db, 'receipts_folder_scan', new Date().toISOString());
      this.db.prepare("DELETE FROM meta WHERE key = 'receipts_folder_error'").run();
    } catch (err) {
      setMeta(this.db, 'receipts_folder_error', (err as Error).message.slice(0, 300));
    }
    return added;
  }

  // ---------- Gmail (IMAP with an app password) ----------

  private imap(creds: { email: string; appPassword: string }): ImapFlow {
    return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: creds.email, pass: creds.appPassword }, logger: false });
  }

  async setGmail(email: string, appPassword: string): Promise<void> {
    const creds = { email: email.trim(), appPassword: appPassword.replace(/\s+/g, '') };
    const client = this.imap(creds);
    try {
      await client.connect();
    } catch {
      throw new Error('GMAIL_LOGIN');
    } finally {
      await client.logout().catch(() => {});
    }
    setMeta(this.db, 'gmail_creds', this.vault.seal(creds));
    this.db.prepare("DELETE FROM meta WHERE key IN ('gmail_error', 'gmail_last_sync')").run();
  }

  removeGmail(): void {
    this.db.prepare("DELETE FROM meta WHERE key IN ('gmail_creds', 'gmail_error', 'gmail_last_sync')").run();
  }

  async scanGmail(): Promise<number> {
    const sealed = getMeta(this.db, 'gmail_creds');
    if (!sealed) return 0;
    const creds = this.vault.open<{ email: string; appPassword: string }>(sealed);
    const last = getMeta(this.db, 'gmail_last_sync');
    // A week of overlap; the first scan looks back three months.
    const since = new Date(last ? Date.parse(last) - 7 * 86400000 : Date.now() - 92 * 86400000);
    const client = this.imap(creds);
    let added = 0;
    try {
      await client.connect();
      const boxes = await client.list();
      const all = boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
      const lock = await client.getMailboxLock(all);
      try {
        const uids =
          (await client.search(
            { since, gmraw: 'has:attachment (חשבונית OR קבלה OR "חשבונית מס" OR invoice OR receipt OR "tax invoice")' },
            { uid: true },
          )) || [];
        for (const uid of uids.slice(-200)) {
          const msg = await client.fetchOne(String(uid), { bodyStructure: true, envelope: true }, { uid: true });
          if (!msg || !msg.bodyStructure) continue;
          const parts: { part: string; mime: string; name: string }[] = [];
          const walk = (n: NonNullable<typeof msg.bodyStructure>) => {
            const mime = n.type.toLowerCase();
            const name = n.dispositionParameters?.filename ?? n.parameters?.name ?? '';
            if (n.part && (mime === 'application/pdf' || (mime.startsWith('image/') && (n.size ?? 0) > 20_000 && Object.values(KINDS).includes(mime)))) parts.push({ part: n.part, mime, name });
            n.childNodes?.forEach(walk);
          };
          walk(msg.bodyStructure);
          for (const p of parts) {
            const externalId = `${msg.envelope?.messageId ?? uid}|${p.part}`;
            if (this.db.prepare("SELECT 1 FROM receipts WHERE source = 'gmail' AND external_id = ?").get(externalId)) continue;
            const dl = await client.download(String(uid), p.part, { uid: true });
            if (!dl.content) continue;
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const c of dl.content) {
              size += (c as Buffer).length;
              if (size > MAX_BYTES) break;
              chunks.push(c as Buffer);
            }
            if (size > MAX_BYTES) continue;
            const subject = msg.envelope?.subject ?? '';
            if (this.add('gmail', externalId, p.name || `${subject || 'מייל'}.pdf`, Buffer.concat(chunks), p.mime)) added++;
          }
        }
      } finally {
        lock.release();
      }
      setMeta(this.db, 'gmail_last_sync', new Date().toISOString());
      this.db.prepare("DELETE FROM meta WHERE key = 'gmail_error'").run();
    } catch (err) {
      const auth = /auth|credentials|login/i.test(String((err as Error).message));
      setMeta(this.db, 'gmail_error', auth ? 'Gmail לא קיבל את סיסמת האפליקציה. אולי היא בוטלה. צריך ליצור חדשה ולחבר שוב.' : `Gmail: ${(err as Error).message.slice(0, 200)}`);
    } finally {
      await client.logout().catch(() => {});
    }
    return added;
  }

  // ---------- reading and matching ----------

  async readPending(): Promise<number> {
    if (!this.coach.enabled()) return 0;
    const pending = this.db.prepare("SELECT id, file_path, mime, file_name FROM receipts WHERE status IN ('new', 'failed') AND attempts < 3 ORDER BY id LIMIT ?").all(PER_RUN) as {
      id: number;
      file_path: string;
      mime: string;
      file_name: string;
    }[];
    let read = 0;
    for (const r of pending) {
      const full = path.join(this.dir(), path.basename(r.file_path));
      let doc: ReadDocument;
      try {
        doc = await this.coach.readDocument(fs.readFileSync(full), r.mime, r.file_name);
      } catch (err) {
        this.db.prepare("UPDATE receipts SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?").run(String((err as Error).message).slice(0, 200), r.id);
        continue;
      }
      if (!doc.isInvoice) {
        this.db.prepare("UPDATE receipts SET status = 'not_invoice', attempts = attempts + 1, error = NULL WHERE id = ?").run(r.id);
        continue;
      }
      this.db
        .prepare("UPDATE receipts SET status = 'read', attempts = attempts + 1, error = NULL, vendor = ?, doc_date = ?, amount = ?, vat = ?, doc_number = ? WHERE id = ?")
        .run(doc.vendor, doc.date, doc.total, doc.vat, doc.number, r.id);
      read++;
    }
    this.matchAll();
    return read;
  }

  // An invoice belongs to the money-out transaction of the same amount (±1%)
  // dated up to 3 days before and 40 days after it (card charges post later).
  // When several fit, the one whose description shares a word with the vendor wins.
  matchAll(): number {
    const open = this.db.prepare("SELECT id, vendor, doc_date, amount FROM receipts WHERE status = 'read' AND txn_id IS NULL AND amount > 0 AND doc_date IS NOT NULL").all() as {
      id: number;
      vendor: string | null;
      doc_date: string;
      amount: number;
    }[];
    const find = this.db.prepare(
      `SELECT t.id, t.description, t.date FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount BETWEEN ? AND ? AND c.kind <> 'transfer'
         AND julianday(t.date) BETWEEN julianday(?) - 3 AND julianday(?) + 40
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.txn_id = t.id)
       ORDER BY abs(julianday(t.date) - julianday(?))`,
    );
    const set = this.db.prepare('UPDATE receipts SET txn_id = ? WHERE id = ?');
    let matched = 0;
    for (const r of open) {
      const candidates = find.all(-r.amount * 1.01, -r.amount * 0.99, r.doc_date, r.doc_date, r.doc_date) as { id: number; description: string; date: string }[];
      if (!candidates.length) continue;
      const words = new Set(merchantKey(r.vendor ?? '').split(' ').filter((w) => w.length > 2));
      const best = candidates.find((c) => merchantKey(c.description).split(' ').some((w) => words.has(w))) ?? (candidates.length === 1 ? candidates[0] : null);
      if (!best) continue;
      set.run(best.id, r.id);
      matched++;
    }
    return matched;
  }

  async scanAll(): Promise<{ added: number; read: number }> {
    if (this.running) return { added: 0, read: 0 };
    this.running = true;
    try {
      const added = this.scanFolder() + (await this.scanGmail());
      const read = await this.readPending();
      return { added, read };
    } finally {
      this.running = false;
    }
  }
}
