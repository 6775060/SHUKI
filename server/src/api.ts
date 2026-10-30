import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { FONT_TYPES, isVariableFont, weightRange } from './fonts.js';
import type { SQLInputValue } from 'node:sqlite';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { getMeta, setMeta, transaction, type DB } from './db.js';
import type { Vault } from './vault.js';
import { merchantKey, type Categorizer } from './categorize.js';
import { browserProfileDir, type SyncService } from './sync.js';
import { getInstitution, listInstitutions } from './institutions.js';
import { ingestTransactions, linkInternalTransfers, upsertAccount } from './ingest.js';
import { parseStatement } from './importer.js';
import { futureInstallments, monthSummary, monthsWithData } from './stats.js';
import {
  addMonths,
  bankBalance,
  buildInsights,
  businessView,
  categoryComparison,
  dailySpending,
  detectRecurring,
  forecast,
  fundSuggestions,
  healthScore,
  listFunds,
  monthlyTrend,
  safeToSpend,
  spendingPace,
  topMerchants,
} from './insights.js';
import { cardBills, cycleView } from './cycle.js';
import { businessData, parseDocsFile, saveDocs, syncSumit, type DocSource } from './business.js';
import { categoryCleanups, categorySuggestions } from './suggest.js';
import { parseSavingsFile, saveSavings, savingsView } from './savings.js';
import { syncAlerts } from './sync-health.js';
import { disableRemote, enableRemote, remoteStatus } from './remote.js';
import { BackupError, createBackup, restoreBackup } from './backup.js';
import { incomeMix, incomeProfile, saveIncomeProfile } from './profile.js';
import { dataCheck } from './datacheck.js';
import { savingOpportunities } from './opportunities.js';
import { Receipts } from './receipts.js';
import { remoteHost } from './remote.js';
import { Coach, CoachError } from './coach.js';

interface Deps {
  db: DB;
  vault: Vault;
  categorizer: Categorizer;
  sync: SyncService;
  onUnlock: () => void;
  coach?: Coach;
  receipts?: Receipts;
}

const scope = z.enum(['private', 'business']);

export function createApi({ db, vault, categorizer, sync, onUnlock, coach = new Coach(db, vault), receipts = new Receipts(db, vault, coach, config.dataDir) }: Deps): express.Router {
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));

  // Sessions end after a stretch of no use: sooner on the phone, where a device
  // can be lost or left open. The vault itself stays open so the nightly sync
  // keeps working; coming back only needs the password again.
  const sessions = new Map<string, { lastSeen: number; remote: boolean }>();
  const isRemote = (req: Request) => {
    const host = remoteHost(db);
    return !!host && (req.hostname ?? '').toLowerCase() === host;
  };
  // At the computer, Windows' own lock screen guards an open session, so by
  // default it stays open; a phone is easier to lose and closes on its own.
  const lockMinutes = () => ({ computer: Number(getMeta(db, 'auto_lock_minutes') ?? 0), phone: Number(getMeta(db, 'phone_lock_minutes') ?? 30) });
  const idleLimit = (remote: boolean) => {
    const m = lockMinutes();
    const minutes = remote ? m.phone || 30 : m.computer;
    return minutes > 0 ? minutes * 60_000 : Infinity;
  };
  const newSession = (req: Request) => {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { lastSeen: Date.now(), remote: isRemote(req) });
    return token;
  };

  // The last logins, so a strange one stands out.
  const logLogin = (req: Request, ok: boolean) => {
    const log = JSON.parse(getMeta(db, 'login_log') ?? '[]') as { at: string; ok: boolean; phone: boolean }[];
    log.unshift({ at: new Date().toISOString(), ok, phone: isRemote(req) });
    setMeta(db, 'login_log', JSON.stringify(log.slice(0, 30)));
  };

  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('x-session');
    const s = token ? sessions.get(token) : undefined;
    if (!vault.isUnlocked() || !token || !s || Date.now() - s.lastSeen > idleLimit(s.remote)) {
      if (token) sessions.delete(token);
      res.status(401).json({ error: 'LOCKED' });
      return;
    }
    s.lastSeen = Date.now();
    next();
  };

  // Things that only make sense at the computer itself: from the phone they
  // would let a lost, unlocked phone take everything with it.
  const computerOnly = (req: Request, res: Response, next: NextFunction) => {
    if (isRemote(req)) {
      res.status(403).json({ error: 'COMPUTER_ONLY' });
      return;
    }
    next();
  };

  // ---- vault ----
  api.get('/status', (_req, res) => {
    res.json({ initialized: vault.isInitialized(), unlocked: vault.isUnlocked() });
  });

  api.post('/setup', (req, res) => {
    const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
    if (vault.isInitialized()) {
      res.status(409).json({ error: 'ALREADY_INITIALIZED' });
      return;
    }
    vault.setup(password);
    onUnlock();
    logLogin(req, true);
    res.json({ token: newSession(req) });
  });

  // After 10 wrong passwords in a row, a 15 minute pause before trying again.
  let failedAttempts = 0;
  let blockedUntil = 0;
  api.post('/unlock', async (req, res) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (Date.now() < blockedUntil) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAt: new Date(blockedUntil).toISOString() });
      return;
    }
    if (failedAttempts >= 5) await new Promise((r) => setTimeout(r, 2000 * (failedAttempts - 4)));
    const ok = vault.isUnlocked() ? vault.verify(password) : vault.unlock(password);
    logLogin(req, ok);
    if (!ok) {
      failedAttempts++;
      if (failedAttempts >= 10) {
        blockedUntil = Date.now() + 15 * 60_000;
        failedAttempts = 0;
      }
      res.status(401).json({ error: 'WRONG_PASSWORD' });
      return;
    }
    failedAttempts = 0;
    onUnlock();
    res.json({ token: newSession(req) });
  });

  api.post('/reset', computerOnly, (req, res) => {
    z.object({ confirm: z.literal('איפוס') }).parse(req.body);
    sessions.clear();
    vault.reset();
    failedAttempts = 0;
    res.json({ ok: true });
  });

  api.post('/lock', requireSession, (_req, res) => {
    sessions.clear();
    vault.lock();
    res.json({ ok: true });
  });

  // Restoring a backup: allowed on a fresh install (nothing here to protect yet)
  // or from inside an open session. The password travels URI-encoded in a header
  // because the body is the file itself.
  api.post('/restore', computerOnly, express.raw({ type: 'application/octet-stream', limit: '300mb' }), (req, res) => {
    const token = req.header('x-session');
    if (vault.isInitialized() && !(vault.isUnlocked() && token && sessions.has(token))) {
      res.status(401).json({ error: 'LOCKED' });
      return;
    }
    if (sync.status().running !== null) {
      res.status(409).json({ error: 'SYNC_RUNNING' });
      return;
    }
    let password: string;
    try {
      password = decodeURIComponent(req.header('x-backup-password') ?? '');
    } catch {
      password = '';
    }
    if (!Buffer.isBuffer(req.body) || !password) {
      res.status(400).json({ error: 'NOT_A_BACKUP' });
      return;
    }
    try {
      const result = restoreBackup(db, config.dataDir, req.body, password);
      sessions.clear();
      vault.lock();
      failedAttempts = 0;
      const unlocked = vault.unlock(password);
      if (unlocked) onUnlock();
      res.json({ ...result, token: unlocked ? newSession(req) : null });
    } catch (err) {
      if (err instanceof BackupError) {
        res.status(400).json({ error: err.code });
        return;
      }
      throw err;
    }
  });

  api.use(requireSession);

  api.post('/backup', computerOnly, (req, res) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!vault.verify(password)) {
      res.status(401).json({ error: 'WRONG_PASSWORD' });
      return;
    }
    const file = createBackup(db, config.dataDir, password);
    setMeta(db, 'last_backup_at', new Date().toISOString());
    const name = `shefa-backup-${new Date().toLocaleDateString('sv-SE')}.shefa`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(file);
  });

  // ---- institutions & connections ----
  api.get('/institutions', (_req, res) => res.json(listInstitutions()));

  api.get('/connections', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.company_id AS companyId, c.label, c.default_scope AS defaultScope, c.enabled, c.last_sync_at AS lastSyncAt,
           c.last_status AS lastStatus, c.last_error AS lastError,
           (SELECT added FROM sync_runs r WHERE r.connection_id = c.id ORDER BY r.id DESC LIMIT 1) AS lastAdded
         FROM connections c ORDER BY c.id`,
      )
      .all();
    res.json({ connections: rows, sync: sync.status() });
  });

  api.post('/connections', computerOnly, (req, res) => {
    const body = z
      .object({ companyId: z.string(), label: z.string().min(1), defaultScope: scope, credentials: z.record(z.string(), z.string()) })
      .parse(req.body);
    const inst = getInstitution(body.companyId);
    if (!inst) {
      res.status(400).json({ error: 'UNKNOWN_INSTITUTION' });
      return;
    }
    const missing = inst.loginFields.filter((f) => !body.credentials[f.key]?.trim());
    if (missing.length) {
      res.status(400).json({ error: 'MISSING_FIELDS', fields: missing.map((f) => f.key) });
      return;
    }
    const creds = Object.fromEntries(inst.loginFields.map((f) => [f.key, body.credentials[f.key].trim()]));
    const id = db
      .prepare('INSERT INTO connections (company_id, label, default_scope, credentials_enc) VALUES (?, ?, ?, ?)')
      .run(body.companyId, body.label, body.defaultScope, vault.seal(creds)).lastInsertRowid as number;
    sync.enqueue(id);
    res.json({ id });
  });

  api.patch('/connections/:id', computerOnly, (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        label: z.string().min(1).optional(),
        defaultScope: scope.optional(),
        enabled: z.boolean().optional(),
        credentials: z.record(z.string(), z.string()).optional(),
      })
      .parse(req.body);
    const conn = db.prepare('SELECT company_id FROM connections WHERE id = ?').get(id) as { company_id: string } | undefined;
    if (!conn) {
      res.status(404).end();
      return;
    }
    if (body.label) db.prepare('UPDATE connections SET label = ? WHERE id = ?').run(body.label, id);
    if (body.defaultScope) {
      db.prepare('UPDATE connections SET default_scope = ? WHERE id = ?').run(body.defaultScope, id);
      db.prepare('UPDATE accounts SET default_scope = ? WHERE connection_id = ?').run(body.defaultScope, id);
    }
    if (body.enabled !== undefined) db.prepare('UPDATE connections SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, id);
    if (body.credentials) {
      const inst = getInstitution(conn.company_id)!;
      const creds = Object.fromEntries(inst.loginFields.map((f) => [f.key, (body.credentials![f.key] ?? '').trim()]));
      if (Object.values(creds).some((v) => !v)) {
        res.status(400).json({ error: 'MISSING_FIELDS' });
        return;
      }
      // A login wiped by a password reset comes back to life with its new details.
      db.prepare("UPDATE connections SET enabled = CASE WHEN credentials_enc = '' THEN 1 ELSE enabled END, credentials_enc = ?, last_error = NULL WHERE id = ?").run(vault.seal(creds), id);
    }
    res.json({ ok: true });
  });

  api.delete('/connections/:id', computerOnly, (req, res) => {
    // Transactions stay; only the stored login is removed.
    db.prepare('DELETE FROM connections WHERE id = ?').run(Number(req.params.id));
    fs.rmSync(browserProfileDir(Number(req.params.id)), { recursive: true, force: true });
    res.json({ ok: true });
  });

  api.post('/connections/:id/sync', (req, res) => {
    sync.enqueue(Number(req.params.id));
    res.json({ ok: true });
  });

  api.post('/sync', (_req, res) => {
    sync.enqueueAll();
    res.json({ ok: true });
  });

  // ---- accounts ----
  api.get('/accounts', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT a.id, a.kind, a.company_id AS companyId, a.account_number AS accountNumber, a.label, a.default_scope AS defaultScope,
             a.balance, a.balance_date AS balanceDate, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS txnCount
           FROM accounts a ORDER BY a.kind, a.label`,
        )
        .all(),
    );
  });

  api.post('/accounts', (req, res) => {
    const body = z
      .object({ kind: z.enum(['bank', 'card', 'cash']), label: z.string().min(1), companyId: z.string().nullable(), accountNumber: z.string().min(1), defaultScope: scope })
      .parse(req.body);
    const acc = upsertAccount(db, { connectionId: null, ...body });
    res.json({ id: acc.id });
  });

  api.patch('/accounts/:id', (req, res) => {
    const body = z.object({ label: z.string().min(1).optional(), defaultScope: scope.optional() }).parse(req.body);
    const id = Number(req.params.id);
    if (body.label) db.prepare('UPDATE accounts SET label = ? WHERE id = ?').run(body.label, id);
    if (body.defaultScope) db.prepare('UPDATE accounts SET default_scope = ? WHERE id = ?').run(body.defaultScope, id);
    res.json({ ok: true });
  });

  // ---- categories & rules ----
  api.get('/categories', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT c.id, c.slug, c.name, c.grp, c.kind, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS txnCount
           FROM categories c ORDER BY c.sort, c.id`,
        )
        .all(),
    );
  });

  api.post('/categories', (req, res) => {
    const body = z.object({ name: z.string().min(1).max(40), grp: z.string().min(1).max(40), kind: z.enum(['expense', 'income', 'transfer']) }).parse(req.body);
    const id = db.prepare('INSERT INTO categories (name, grp, kind, sort) VALUES (?, ?, ?, 1000)').run(body.name, body.grp, body.kind).lastInsertRowid;
    res.json({ id });
  });

  api.patch('/categories/:id', (req, res) => {
    const b = z.object({ name: z.string().min(1).max(40).optional(), grp: z.string().min(1).max(40).optional() }).parse(req.body);
    const id = Number(req.params.id);
    if (b.name) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(b.name, id);
    if (b.grp) db.prepare('UPDATE categories SET grp = ? WHERE id = ?').run(b.grp, id);
    res.json({ ok: true });
  });

  api.delete('/categories/:id', (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT slug FROM categories WHERE id = ?').get(id) as { slug: string | null } | undefined;
    if (!c || c.slug) {
      res.status(400).json({ error: 'BUILT_IN' }); // only user-made categories can be removed
      return;
    }
    transaction(db, () => {
      db.prepare("UPDATE transactions SET category_id = (SELECT id FROM categories WHERE slug = 'uncategorized'), category_locked = 0 WHERE category_id = ?").run(id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    categorizer.reload();
    res.json({ ok: true, changed: recategorize() });
  });

  // ---- reviews: "I don't know what this charge is" ----
  api.post('/transactions/:id/review', (req, res) => {
    const b = z.object({ note: z.string().max(500).optional() }).parse(req.body);
    db.prepare(
      "UPDATE transactions SET review_status = 'open', review_note = ?, review_resolution = NULL, review_opened_at = datetime('now'), review_closed_at = NULL WHERE id = ?",
    ).run(b.note?.trim() || null, Number(req.params.id));
    res.json({ ok: true });
  });

  api.patch('/reviews/:id', (req, res) => {
    const b = z
      .object({
        status: z.enum(['open', 'done']).optional(),
        resolution: z.enum(['ok', 'refund', 'disputed', 'cancelled']).optional(),
        note: z.string().max(500).nullable().optional(),
        categoryId: z.number().int().optional(),
      })
      .parse(req.body);
    const id = Number(req.params.id);
    transaction(db, () => {
      if (b.note !== undefined) db.prepare('UPDATE transactions SET review_note = ? WHERE id = ?').run(b.note?.trim() || null, id);
      if (b.categoryId !== undefined) db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?').run(b.categoryId, id);
      if (b.status === 'done')
        db.prepare("UPDATE transactions SET review_status = 'done', review_resolution = ?, review_closed_at = datetime('now') WHERE id = ?").run(b.resolution ?? 'ok', id);
      if (b.status === 'open') db.prepare("UPDATE transactions SET review_status = 'open', review_resolution = NULL, review_closed_at = NULL WHERE id = ?").run(id);
    });
    res.json({ ok: true });
  });

  api.delete('/reviews/:id', (req, res) => {
    db.prepare('UPDATE transactions SET review_status = NULL, review_note = NULL, review_resolution = NULL, review_opened_at = NULL, review_closed_at = NULL WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  api.get('/reviews', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT t.id, t.date, t.processed_date AS processedDate, t.amount, t.original_amount AS originalAmount, t.original_currency AS originalCurrency,
           t.description, t.memo, t.installment_number AS installmentNumber, t.installment_total AS installmentTotal, t.identifier,
           t.category_id AS categoryId, c.name AS categoryName, t.scope, a.label AS accountLabel, a.kind AS accountKind, a.company_id AS companyId,
           t.review_status AS status, t.review_note AS note, t.review_resolution AS resolution, t.review_opened_at AS openedAt, t.review_closed_at AS closedAt
         FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.review_status IS NOT NULL ORDER BY t.review_status = 'open' DESC, t.date DESC`,
      )
      .all() as { id: number; description: string; amount: number; date: string }[];
    // Clues for each charge: has this business charged before, and how often?
    const all = db.prepare('SELECT id, date, amount, description FROM transactions').all() as { id: number; date: string; amount: number; description: string }[];
    const byKey = new Map<string, { id: number; date: string; amount: number }[]>();
    for (const t of all) {
      const k = merchantKey(t.description);
      if (!k) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), t]);
    }
    res.json(
      rows.map((r) => {
        const others = (byKey.get(merchantKey(r.description)) ?? []).filter((x) => x.id !== r.id).sort((a, b) => a.date.localeCompare(b.date));
        const months = new Set(others.map((x) => x.date.slice(0, 7)));
        return {
          ...r,
          history: {
            count: others.length,
            first: others[0]?.date ?? null,
            last: others[others.length - 1]?.date ?? null,
            sameAmount: others.filter((x) => Math.abs(x.amount - r.amount) < 0.5).length,
            months: months.size,
          },
        };
      }),
    );
  });

  // ---- "this business is always this category" ----
  const merchantMatches = (key: string) =>
    (db.prepare('SELECT id, description, amount FROM transactions').all() as { id: number; description: string; amount: number }[]).filter(
      (t) => merchantKey(t.description) === key,
    );

  api.get('/transactions/:id/merchant', (req, res) => {
    const t = db.prepare('SELECT description FROM transactions WHERE id = ?').get(Number(req.params.id)) as { description: string } | undefined;
    if (!t) {
      res.status(404).end();
      return;
    }
    const key = merchantKey(t.description);
    const list = key ? merchantMatches(key) : [];
    const rule = db.prepare("SELECT c.name FROM rules r JOIN categories c ON c.id = r.category_id WHERE r.match = 'merchant' AND r.pattern = ?").get(key) as { name: string } | undefined;
    res.json({ key, count: list.length, total: list.reduce((s, x) => s - x.amount, 0), currentRule: rule?.name ?? null });
  });

  api.post('/transactions/:id/assign', (req, res) => {
    const b = z.object({ categoryId: z.number().int(), applyTo: z.enum(['one', 'merchant']) }).parse(req.body);
    const id = Number(req.params.id);
    const t = db.prepare('SELECT description FROM transactions WHERE id = ?').get(id) as { description: string } | undefined;
    if (!t) {
      res.status(404).end();
      return;
    }
    const key = merchantKey(t.description);
    if (b.applyTo === 'one' || !key) {
      db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?').run(b.categoryId, id);
      res.json({ changed: 1 });
      return;
    }
    const list = merchantMatches(key);
    transaction(db, () => {
      db.prepare("DELETE FROM rules WHERE match = 'merchant' AND pattern = ?").run(key);
      db.prepare("INSERT INTO rules (pattern, category_id, match) VALUES (?, ?, 'merchant')").run(key, b.categoryId);
      const upd = db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?');
      for (const x of list) upd.run(b.categoryId, x.id);
    });
    categorizer.reload();
    res.json({ changed: list.length, key });
  });

  // Several transactions at once. With remember, each of their merchants gets
  // a rule, so past and future charges from the same place follow.
  api.post('/transactions/bulk-assign', (req, res) => {
    const b = z
      .object({ ids: z.array(z.number().int()).min(1).max(2000), categoryId: z.number().int().optional(), scope: scope.optional(), remember: z.boolean().default(false) })
      .parse(req.body);
    if (b.categoryId === undefined && !b.scope) {
      res.status(400).json({ error: 'NOTHING_TO_DO' });
      return;
    }
    if (b.categoryId !== undefined && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(b.categoryId)) {
      res.status(400).json({ error: 'UNKNOWN_CATEGORY' });
      return;
    }
    const picked = new Set(b.ids);
    const all = db.prepare('SELECT id, description FROM transactions').all() as { id: number; description: string }[];
    const keys = new Set<string>();
    const ids = new Set<number>(b.ids);
    if (b.categoryId !== undefined && b.remember) {
      for (const t of all) if (picked.has(t.id)) keys.add(merchantKey(t.description));
      keys.delete('');
      for (const t of all) if (keys.has(merchantKey(t.description))) ids.add(t.id);
    }
    transaction(db, () => {
      if (b.categoryId !== undefined) {
        const upd = db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?');
        for (const id of ids) upd.run(b.categoryId, id);
        const del = db.prepare("DELETE FROM rules WHERE match = 'merchant' AND pattern = ?");
        const ins = db.prepare("INSERT INTO rules (pattern, category_id, match) VALUES (?, ?, 'merchant')");
        for (const k of keys) {
          del.run(k);
          ins.run(k, b.categoryId);
        }
      }
      if (b.scope) {
        const upd = db.prepare('UPDATE transactions SET scope = ?, category_locked = 1 WHERE id = ?');
        for (const id of picked) upd.run(b.scope, id);
      }
    });
    if (keys.size) categorizer.reload();
    res.json({ changed: ids.size, rules: keys.size });
  });

  api.get('/suggestions', (_req, res) => {
    res.json({ categories: categorySuggestions(db), cleanups: categoryCleanups(db, new Date().toLocaleDateString('sv-SE')) });
  });

  // Fold a user-made category into another: its transactions, rules and funds move over.
  api.post('/categories/:id/merge', (req, res) => {
    const id = Number(req.params.id);
    const { into } = z.object({ into: z.number().int() }).parse(req.body);
    const c = db.prepare('SELECT slug FROM categories WHERE id = ?').get(id) as { slug: string | null } | undefined;
    if (!c || c.slug || id === into || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(into)) {
      res.status(400).json({ error: 'CANNOT_MERGE' });
      return;
    }
    let moved = 0;
    transaction(db, () => {
      moved = Number(db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(into, id).changes);
      db.prepare('UPDATE rules SET category_id = ? WHERE category_id = ?').run(into, id);
      db.prepare('UPDATE funds SET category_id = ? WHERE category_id = ?').run(into, id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    categorizer.reload();
    res.json({ moved });
  });

  api.get('/rules', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT r.id, r.pattern, r.category_id AS categoryId, c.name AS categoryName, r.scope, r.account_kind AS accountKind, r.is_default AS isDefault, r.match
           FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.is_default, r.match = 'merchant' DESC, c.sort, r.pattern`,
        )
        .all(),
    );
  });

  api.post('/rules', (req, res) => {
    const body = z
      .object({ pattern: z.string().min(2), categoryId: z.number().int(), scope: scope.nullable().optional(), applyToExisting: z.boolean().default(true) })
      .parse(req.body);
    const id = db
      .prepare('INSERT INTO rules (pattern, category_id, scope) VALUES (?, ?, ?)')
      .run(body.pattern, body.categoryId, body.scope ?? null).lastInsertRowid;
    categorizer.reload();
    const changed = body.applyToExisting ? recategorize() : 0;
    res.json({ id, changed });
  });

  api.delete('/rules/:id', (req, res) => {
    db.prepare('DELETE FROM rules WHERE id = ?').run(Number(req.params.id));
    categorizer.reload();
    res.json({ ok: true });
  });

  // Re-run rules on every transaction the user has not categorized by hand.
  function recategorize(): number {
    const rows = db
      .prepare(
        `SELECT t.id, t.description, t.memo, t.amount, t.category_id, t.scope, a.kind, a.default_scope
         FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.category_locked = 0`,
      )
      .all() as { id: number; description: string; memo: string | null; amount: number; category_id: number; scope: string; kind: 'bank' | 'card' | 'cash'; default_scope: 'private' | 'business' }[];
    const upd = db.prepare('UPDATE transactions SET category_id = ?, scope = ? WHERE id = ?');
    let changed = 0;
    transaction(db, () => {
      for (const r of rows) {
        const c = categorizer.categorize({ description: r.description, memo: r.memo, amount: r.amount, accountKind: r.kind, accountScope: r.default_scope });
        if (c.categoryId !== r.category_id || c.scope !== r.scope) {
          upd.run(c.categoryId, c.scope, r.id);
          changed++;
        }
      }
    });
    return changed;
  }

  api.post('/recategorize', (_req, res) => res.json({ changed: recategorize() }));

  // ---- transactions ----
  api.get('/transactions', (req, res) => {
    const q = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        accountId: z.coerce.number().optional(),
        categoryId: z.coerce.number().optional(),
        scope: scope.optional(),
        search: z.string().optional(),
        uncategorized: z.enum(['1']).optional(),
        limit: z.coerce.number().max(2000).default(500),
      })
      .parse(req.query);
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (q.month) {
      where.push("substr(t.date, 1, 7) = ?");
      params.push(q.month);
    }
    if (q.accountId) {
      where.push('t.account_id = ?');
      params.push(q.accountId);
    }
    if (q.categoryId) {
      where.push('t.category_id = ?');
      params.push(q.categoryId);
    }
    if (q.scope) {
      where.push('t.scope = ?');
      params.push(q.scope);
    }
    if (q.uncategorized) where.push("c.slug = 'uncategorized'");
    if (q.search) {
      where.push('(t.description LIKE ? OR t.memo LIKE ? OR t.note LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    const rows = db
      .prepare(
        `SELECT t.id, t.date, t.amount, t.original_amount AS originalAmount, t.original_currency AS originalCurrency,
           t.description, t.memo, t.status, t.installment_number AS installmentNumber, t.installment_total AS installmentTotal,
           t.category_id AS categoryId, c.name AS categoryName, c.kind AS categoryKind, t.scope, t.note, t.source,
           t.review_status AS reviewStatus,
           a.id AS accountId, a.label AS accountLabel, a.kind AS accountKind
         FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY t.date DESC, t.id DESC LIMIT ?`,
      )
      .all(...params, q.limit);
    res.json(rows);
  });

  api.patch('/transactions/:id', (req, res) => {
    const body = z
      .object({ categoryId: z.number().int().optional(), scope: scope.optional(), note: z.string().max(500).nullable().optional() })
      .parse(req.body);
    const id = Number(req.params.id);
    if (body.categoryId !== undefined) db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?').run(body.categoryId, id);
    if (body.scope) db.prepare('UPDATE transactions SET scope = ?, category_locked = 1 WHERE id = ?').run(body.scope, id);
    if (body.note !== undefined) db.prepare('UPDATE transactions SET note = ? WHERE id = ?').run(body.note, id);
    res.json({ ok: true });
  });

  api.post('/transactions', (req, res) => {
    const body = z
      .object({ accountId: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.number(), description: z.string().min(1) })
      .parse(req.body);
    const account = db.prepare('SELECT id, kind, default_scope FROM accounts WHERE id = ?').get(body.accountId) as
      | { id: number; kind: 'bank' | 'card' | 'cash'; default_scope: 'private' | 'business' }
      | undefined;
    if (!account) {
      res.status(404).end();
      return;
    }
    const r = ingestTransactions(db, categorizer, account, [{ ...body, uniqueKey: crypto.randomUUID() }], 'manual');
    res.json(r);
  });

  // ---- long-term savings: pension, provident funds, investments ----
  const savingsBody = z.object({
    provider: z.string().min(1).max(60),
    product: z.enum(['pension', 'gemel', 'hishtalmut', 'gemel_invest', 'managers', 'investment', 'savings', 'other']),
    accountNumber: z.string().max(40).default(''),
    track: z.string().max(80).nullable().default(null),
    status: z.enum(['active', 'inactive']).default('active'),
    balance: z.number().min(0),
    balanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    monthlyDeposit: z.number().min(0).nullable().default(null),
    feeBalancePct: z.number().min(0).max(5).nullable().default(null),
    feeDepositPct: z.number().min(0).max(10).nullable().default(null),
  });

  api.get('/sync-alerts', (_req, res) => res.json(syncAlerts(db, new Date().toLocaleDateString('sv-SE'))));

  api.get('/savings', (_req, res) => res.json(savingsView(db, new Date().toLocaleDateString('sv-SE'))));

  api.post('/savings', (req, res) => {
    const b = savingsBody.parse(req.body);
    res.json(saveSavings(db, [b], 'manual'));
  });

  api.put('/savings/:id', (req, res) => {
    const b = savingsBody.parse(req.body);
    db.prepare(
      `UPDATE savings_accounts SET provider = ?, product = ?, account_number = ?, track = ?, status = ?, balance = ?, balance_date = ?,
         monthly_deposit = ?, fee_balance_pct = ?, fee_deposit_pct = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(b.provider, b.product, b.accountNumber, b.track, b.status, b.balance, b.balanceDate, b.monthlyDeposit, b.feeBalancePct, b.feeDepositPct, Number(req.params.id));
    res.json({ ok: true });
  });

  api.delete('/savings/:id', (req, res) => {
    db.prepare('DELETE FROM savings_accounts WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  api.post('/savings/import', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
    const q = z.object({ filename: z.string(), dryRun: z.enum(['0', '1']).default('1') }).parse(req.query);
    try {
      const parsed = await parseSavingsFile(q.filename, req.body as Buffer);
      if (q.dryRun === '1') {
        res.json({ headers: parsed.headers, accounts: parsed.accounts, skipped: parsed.skipped });
        return;
      }
      res.json({ ...saveSavings(db, parsed.accounts, 'import'), skipped: parsed.skipped });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ---- file import ----
  api.post('/import', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
    const q = z.object({ accountId: z.coerce.number(), filename: z.string(), dryRun: z.enum(['0', '1']).default('1') }).parse(req.query);
    const account = db.prepare('SELECT id, kind, default_scope FROM accounts WHERE id = ?').get(q.accountId) as
      | { id: number; kind: 'bank' | 'card' | 'cash'; default_scope: 'private' | 'business' }
      | undefined;
    if (!account) {
      res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      return;
    }
    try {
      const parsed = await parseStatement(q.filename, req.body as Buffer, account.kind);
      if (q.dryRun === '1') {
        res.json({ headers: parsed.headers, count: parsed.txns.length, skipped: parsed.skipped, preview: parsed.txns.slice(0, 15) });
        return;
      }
      const r = ingestTransactions(db, categorizer, account, parsed.txns, 'import');
      linkInternalTransfers(db, categorizer);
      res.json({ ...r, skipped: parsed.skipped });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ---- dashboard ----
  api.get('/summary', (req, res) => {
    const month = z.string().regex(/^\d{4}-\d{2}$/).optional().parse(req.query.month) ?? new Date().toISOString().slice(0, 7);
    res.json({ ...monthSummary(db, month), months: monthsWithData(db) });
  });

  // ---- insights ----
  api.get('/insights', (req, res) => {
    const today = new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD
    const month = z.string().regex(/^\d{4}-\d{2}$/).optional().parse(req.query.month) ?? today.slice(0, 7);
    const isCurrent = month === today.slice(0, 7);
    const completeEnd = isCurrent ? month : addMonths(month, 1);
    const trend = monthlyTrend(db, month, 12);
    const categories = categoryComparison(db, month, 'private');
    const recurring = detectRecurring(db, today);
    const pace = spendingPace(db, month, today);
    const balance = bankBalance(db);
    const fc = forecast(db, today, recurring, 60);
    const business = businessView(db, month, trend);
    const merchants = topMerchants(db, month);
    const installments = futureInstallments(db);
    const funds = listFunds(db, today);
    const profile = incomeProfile(db, today);
    const mix = incomeMix(db, month, 6);
    const uncategorized = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
           WHERE c.slug = 'uncategorized' AND substr(t.date, 1, 7) = ?`,
        )
        .get(month) as { n: number }
    ).n;
    res.json({
      month,
      today,
      isCurrent,
      trend,
      categories,
      recurring,
      pace,
      daily: dailySpending(db, month),
      balance,
      forecast: fc,
      business,
      merchants,
      installments,
      health: healthScore(db, month, trend, balance, installments.total, completeEnd),
      safeToSpend: isCurrent ? safeToSpend(db, today, recurring, funds) : null,
      funds,
      insights: buildInsights({ month, isCurrent, trend, categories, recurring, pace, forecast: fc, business, merchants, uncategorized, completeEnd, funds, profile, incomeMix: mix }),
      profile,
      incomeMix: mix,
      check: dataCheck(db, today),
      savings: savingOpportunities(db, today),
      cycle: isCurrent ? cycleView(db, today, recurring, funds) : null,
      cards: cardBills(db, today),
      businessTips: business.hasBusiness ? businessData(db, month, today).tips : [],
      uncategorized,
      syncAlerts: syncAlerts(db, today),
      reviews: (db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(-amount), 0) AS total, MIN(review_opened_at) AS oldest FROM transactions WHERE review_status = 'open'").get() as {
        n: number;
        total: number;
        oldest: string | null;
      }),
    });
  });

  // ---- funds ----
  api.get('/funds', (_req, res) => {
    const today = new Date().toLocaleDateString('sv-SE');
    res.json({ funds: listFunds(db, today), suggestions: fundSuggestions(db, today) });
  });

  const fundBody = z.object({
    name: z.string().min(1).max(60),
    icon: z.string().max(8).nullable().optional(),
    annualAmount: z.number().min(0).max(10_000_000),
    dueMonth: z.number().int().min(1).max(12).nullable().optional(),
    categoryId: z.number().int().nullable().optional(),
  });

  api.post('/funds', (req, res) => {
    const b = fundBody.parse(req.body);
    const id = db
      .prepare('INSERT INTO funds (name, icon, annual_amount, due_month, category_id) VALUES (?, ?, ?, ?, ?)')
      .run(b.name, b.icon ?? null, b.annualAmount, b.dueMonth ?? null, b.categoryId ?? null).lastInsertRowid;
    res.json({ id });
  });

  api.put('/funds/:id', (req, res) => {
    const b = fundBody.parse(req.body);
    db.prepare('UPDATE funds SET name = ?, icon = ?, annual_amount = ?, due_month = ?, category_id = ? WHERE id = ?').run(
      b.name,
      b.icon ?? null,
      b.annualAmount,
      b.dueMonth ?? null,
      b.categoryId ?? null,
      Number(req.params.id),
    );
    res.json({ ok: true });
  });

  api.delete('/funds/:id', (req, res) => {
    db.prepare('DELETE FROM funds WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- settings ----
  api.get('/settings', (_req, res) => {
    const today = new Date().toLocaleDateString('sv-SE');
    const c = cycleView(db, today, [], []).settings;
    res.json({ ...c, taxReservePct: Number(getMeta(db, 'tax_reserve_pct') ?? 15), font: fontSetting() });
  });

  // ---- your own font ----
  const fontDir = path.join(config.dataDir, 'fonts');
  function fontSetting(): { file: string | null; family: string | null; name: string | null; variable: boolean; weights: string | null } {
    return {
      weights: getMeta(db, 'font_weights') ?? null,
      file: getMeta(db, 'font_file') ?? null,
      family: getMeta(db, 'font_family') ?? null,
      name: getMeta(db, 'font_name') ?? null,
      variable: getMeta(db, 'font_variable') === '1',
    };
  }


  api.post('/settings/font', express.raw({ type: 'application/octet-stream', limit: '12mb' }), (req, res) => {
    const q = z.object({ filename: z.string().max(200) }).parse(req.query);
    const buf = req.body as Buffer;
    const ext = path.extname(q.filename).slice(1).toLowerCase();
    if (!FONT_TYPES[ext] || buf.length < 12 || !FONT_TYPES[ext](buf)) {
      res.status(400).json({ error: 'NOT_A_FONT' });
      return;
    }
    fs.mkdirSync(fontDir, { recursive: true });
    for (const f of fs.readdirSync(fontDir)) fs.rmSync(path.join(fontDir, f));
    const file = `custom-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(fontDir, file), buf);
    setMeta(db, 'font_file', file);
    setMeta(db, 'font_name', path.basename(q.filename, path.extname(q.filename)).slice(0, 60));
    setMeta(db, 'font_variable', isVariableFont(buf, ext, q.filename) ? '1' : '0');
    const range = weightRange(buf, ext);
    if (range) setMeta(db, 'font_weights', `${range[0]} ${range[1]}`);
    else db.prepare("DELETE FROM meta WHERE key = 'font_weights'").run();
    db.prepare("DELETE FROM meta WHERE key = 'font_family'").run();
    res.json(fontSetting());
  });

  api.put('/settings/font', (req, res) => {
    // A font already installed on Windows, by name.
    const b = z.object({ family: z.string().min(1).max(60).regex(/^[\p{L}\p{N} _-]+$/u) }).parse(req.body);
    setMeta(db, 'font_family', b.family);
    res.json(fontSetting());
  });

  api.delete('/settings/font', (_req, res) => {
    if (fs.existsSync(fontDir)) for (const f of fs.readdirSync(fontDir)) fs.rmSync(path.join(fontDir, f));
    db.prepare("DELETE FROM meta WHERE key IN ('font_file', 'font_family', 'font_name', 'font_variable', 'font_weights')").run();
    res.json(fontSetting());
  });

  // ---- phone access (Tailscale) ----
  api.get('/remote', async (_req, res) => res.json(await remoteStatus(db)));
  api.post('/remote/enable', computerOnly, async (_req, res) => res.json(await enableRemote(db, config.port)));
  api.post('/remote/disable', async (_req, res) => res.json(await disableRemote(db)));

  api.put('/settings', (req, res) => {
    const b = z
      .object({
        cycleStartDay: z.number().int().min(0).max(28).optional(), // 0 = automatic
        weeklyJoy: z.number().min(0).max(5000).optional(),
        taxReservePct: z.number().min(0).max(60).optional(),
      })
      .parse(req.body);
    if (b.cycleStartDay !== undefined) setMeta(db, 'cycle_start_day', String(b.cycleStartDay));
    if (b.weeklyJoy !== undefined) setMeta(db, 'weekly_joy', String(b.weeklyJoy));
    if (b.taxReservePct !== undefined) setMeta(db, 'tax_reserve_pct', String(b.taxReservePct));
    res.json({ ok: true });
  });

  // ---- household income profile ----
  // The employer's name as the bank writes it, for a salary that doesn't say "משכורת".
  const employers = () =>
    db
      .prepare("SELECT r.id, r.pattern AS name FROM rules r JOIN categories c ON c.id = r.category_id WHERE c.slug = 'income_salary' AND r.is_default = 0 AND r.match = 'contains' ORDER BY r.id")
      .all() as { id: number; name: string }[];
  const profileView = () => ({ ...incomeProfile(db), employers: employers() });
  api.get('/profile', (_req, res) => res.json(profileView()));
  api.post('/profile/employer', (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    if (!employers().some((e) => e.name === b.name)) {
      db.prepare('INSERT INTO rules (pattern, category_id, scope) VALUES (?, ?, NULL)').run(b.name, categorizer.categoryIdBySlug('income_salary'));
      categorizer.reload();
    }
    const changed = recategorize();
    res.json({ ...profileView(), changed });
  });
  api.delete('/profile/employer/:id', (req, res) => {
    const id = Number(req.params.id);
    if (employers().some((e) => e.id === id)) {
      db.prepare('DELETE FROM rules WHERE id = ?').run(id);
      categorizer.reload();
      recategorize();
    }
    res.json(profileView());
  });
  api.put('/profile', (req, res) => {
    const b = z.object({ business: z.enum(['clearing', 'clients', 'none']), salary: z.boolean() }).nullable().parse(req.body?.profile ?? null);
    saveIncomeProfile(db, b);
    res.json(profileView());
  });

  // ---- security ----
  api.get('/security', (req, res) => {
    res.json({
      autoLockMinutes: lockMinutes().computer,
      phoneLockMinutes: lockMinutes().phone || 30,
      onPhone: isRemote(req),
      phoneAccess: !!remoteHost(db),
      lastBackupAt: getMeta(db, 'last_backup_at') ?? null,
      coachEnabled: coach.enabled(),
      logins: JSON.parse(getMeta(db, 'login_log') ?? '[]'),
    });
  });
  api.put('/security', computerOnly, (req, res) => {
    const b = z
      .object({
        autoLockMinutes: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(240)]).optional(),
        phoneLockMinutes: z.union([z.literal(10), z.literal(30), z.literal(60), z.literal(240)]).optional(),
      })
      .parse(req.body);
    if (b.autoLockMinutes !== undefined) setMeta(db, 'auto_lock_minutes', String(b.autoLockMinutes));
    if (b.phoneLockMinutes !== undefined) setMeta(db, 'phone_lock_minutes', String(b.phoneLockMinutes));
    res.json({ ok: true });
  });
  // Ends every open session, on this computer and on the phone.
  api.post('/security/sign-out-all', (_req, res) => {
    sessions.clear();
    res.json({ ok: true });
  });

  // ---- the money coach ----
  const coachFail = (res: Response, err: unknown) => {
    if (err instanceof CoachError) {
      res.status(err.code === 'NO_KEY' ? 409 : 502).json({ error: err.code, detail: err.detail });
      return;
    }
    throw err;
  };
  api.get('/coach', (_req, res) => res.json(coach.state()));
  api.put('/coach/key', computerOnly, async (req, res) => {
    const b = z.object({ apiKey: z.string().trim().min(20).max(300) }).parse(req.body);
    try {
      await coach.setKey(b.apiKey);
      res.json(coach.state());
    } catch (err) {
      coachFail(res, err);
    }
  });
  api.delete('/coach/key', computerOnly, (_req, res) => {
    coach.removeKey();
    res.json(coach.state());
  });
  api.get('/coach/context', (_req, res) => res.type('text/plain; charset=utf-8').send(coach.contextText(new Date().toLocaleDateString('sv-SE'))));
  api.post('/coach/chat', async (req, res) => {
    const b = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    try {
      res.json(await coach.chat(b.message, new Date().toLocaleDateString('sv-SE')));
    } catch (err) {
      coachFail(res, err);
    }
  });
  api.get('/coach/focus', async (req, res) => {
    const today = new Date().toLocaleDateString('sv-SE');
    try {
      res.json({ focus: await coach.focus(today, req.query.refresh === '1') });
    } catch (err) {
      if (err instanceof CoachError) {
        res.json({ focus: null, error: err.code });
        return;
      }
      throw err;
    }
  });
  api.delete('/coach/memory/:id', (req, res) => {
    db.prepare('DELETE FROM coach_memory WHERE id = ?').run(Number(req.params.id));
    res.json(coach.state());
  });
  api.delete('/coach/history', (_req, res) => {
    db.exec('DELETE FROM coach_messages');
    res.json(coach.state());
  });

  // ---- invoices and receipts ----
  const receiptsView = () => {
    const missing = (db.prepare(
      `SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.scope = 'business' AND t.amount < -50 AND c.kind = 'expense' AND t.date >= date('now', '-60 days')
         AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'biz_fees', 'pension', 'loans', 'interest')
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.txn_id = t.id)`,
    ).get() as { n: number }).n;
    return { ...receipts.settings(), items: receipts.list(), businessWithoutInvoice: missing };
  };
  api.get('/receipts', (_req, res) => res.json(receiptsView()));
  api.put('/receipts/gmail', computerOnly, async (req, res) => {
    const b = z.object({ email: z.string().email(), appPassword: z.string().min(12).max(40) }).parse(req.body);
    try {
      await receipts.setGmail(b.email, b.appPassword);
      res.json(receiptsView());
    } catch {
      res.status(400).json({ error: 'GMAIL_LOGIN' });
    }
  });
  api.delete('/receipts/gmail', computerOnly, (_req, res) => {
    receipts.removeGmail();
    res.json(receiptsView());
  });
  api.put('/receipts/folder', computerOnly, (req, res) => {
    const b = z.object({ folder: z.string().trim().max(400).nullable() }).parse(req.body);
    try {
      receipts.setFolder(b.folder || null);
      res.json(receiptsView());
    } catch {
      res.status(400).json({ error: 'FOLDER_NOT_FOUND' });
    }
  });
  api.post('/receipts/scan', async (_req, res) => {
    const r = await receipts.scanAll();
    res.json({ ...receiptsView(), ...r });
  });
  // A photo or PDF straight from the phone or the computer.
  api.post('/receipts/upload', express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], limit: '15mb' }), async (req, res) => {
    const name = z.string().max(200).parse(req.query.filename ?? 'קבלה');
    const mime = String(req.header('content-type')).split(';')[0];
    const id = Buffer.isBuffer(req.body) ? receipts.add('upload', crypto.randomUUID(), name, req.body, mime) : null;
    if (id) await receipts.readPending();
    res.json({ ...receiptsView(), added: id ? 1 : 0 });
  });
  api.get('/receipts/:id/file', (req, res) => {
    const f = receipts.file(Number(req.params.id));
    if (!f) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(f.path);
  });
  api.delete('/receipts/:id', (req, res) => {
    db.prepare('DELETE FROM receipts WHERE id = ?').run(Number(req.params.id));
    res.json(receiptsView());
  });
  api.post('/receipts/:id/unmatch', (req, res) => {
    db.prepare('UPDATE receipts SET txn_id = NULL WHERE id = ?').run(Number(req.params.id));
    res.json(receiptsView());
  });

  // ---- business ----
  api.get('/business', (req, res) => {
    const today = new Date().toLocaleDateString('sv-SE');
    const month = z.string().regex(/^\d{4}-\d{2}$/).optional().parse(req.query.month) ?? today.slice(0, 7);
    const sources = db.prepare('SELECT source, COUNT(*) AS n, MAX(doc_date) AS last FROM business_docs GROUP BY source').all();
    res.json({
      ...businessData(db, month, today),
      connections: { sumit: !!getMeta(db, 'sumit_creds'), sumitLastSync: getMeta(db, 'sumit_last_sync') ?? null, sumitError: getMeta(db, 'sumit_error') ?? null, sources },
    });
  });

  const docSource = z.enum(['sumit', 'grow', 'paperless', 'other']);
  api.post('/business/import', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
    const q = z
      .object({ source: docSource, kind: z.enum(['income', 'expense', 'payment']), filename: z.string(), dryRun: z.enum(['0', '1']).default('1') })
      .parse(req.query);
    try {
      const parsed = await parseDocsFile(q.filename, req.body as Buffer, q.source as DocSource, q.kind);
      if (q.dryRun === '1') {
        res.json({ headers: parsed.headers, count: parsed.docs.length, skipped: parsed.skipped, preview: parsed.docs.slice(0, 10) });
        return;
      }
      res.json({ ...saveDocs(db, parsed.docs), skipped: parsed.skipped });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  api.put('/business/sumit', computerOnly, (req, res) => {
    const b = z.object({ companyId: z.string().regex(/^\d+$/), apiKey: z.string().min(8) }).parse(req.body);
    setMeta(db, 'sumit_creds', vault.seal(b));
    res.json({ ok: true });
  });

  api.delete('/business/sumit', computerOnly, (_req, res) => {
    db.prepare("DELETE FROM meta WHERE key IN ('sumit_creds', 'sumit_last_sync', 'sumit_error')").run();
    res.json({ ok: true });
  });

  api.post('/business/sumit/sync', async (_req, res) => {
    try {
      res.json(await syncSumit(db, vault, new Date().toLocaleDateString('sv-SE')));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION', issues: err.issues });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL' });
  });

  return api;
}
