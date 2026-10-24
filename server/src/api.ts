import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { FONT_TYPES, isVariableFont } from './fonts.js';
import type { SQLInputValue } from 'node:sqlite';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { getMeta, setMeta, transaction, type DB } from './db.js';
import type { Vault } from './vault.js';
import { merchantKey, type Categorizer } from './categorize.js';
import type { SyncService } from './sync.js';
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

interface Deps {
  db: DB;
  vault: Vault;
  categorizer: Categorizer;
  sync: SyncService;
  onUnlock: () => void;
}

const scope = z.enum(['private', 'business']);

export function createApi({ db, vault, categorizer, sync, onUnlock }: Deps): express.Router {
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));

  const sessions = new Set<string>();
  const newSession = () => {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    return token;
  };

  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('x-session');
    if (!vault.isUnlocked() || !token || !sessions.has(token)) {
      res.status(401).json({ error: 'LOCKED' });
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
    res.json({ token: newSession() });
  });

  let failedAttempts = 0;
  api.post('/unlock', async (req, res) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (failedAttempts >= 5) await new Promise((r) => setTimeout(r, 2000 * (failedAttempts - 4)));
    if (!vault.unlock(password)) {
      failedAttempts++;
      res.status(401).json({ error: 'WRONG_PASSWORD' });
      return;
    }
    failedAttempts = 0;
    onUnlock();
    res.json({ token: newSession() });
  });

  api.post('/lock', requireSession, (_req, res) => {
    sessions.clear();
    vault.lock();
    res.json({ ok: true });
  });

  api.use(requireSession);

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

  api.post('/connections', (req, res) => {
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

  api.patch('/connections/:id', (req, res) => {
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
      db.prepare('UPDATE connections SET credentials_enc = ?, last_error = NULL WHERE id = ?').run(vault.seal(creds), id);
    }
    res.json({ ok: true });
  });

  api.delete('/connections/:id', (req, res) => {
    // Transactions stay; only the stored login is removed.
    db.prepare('DELETE FROM connections WHERE id = ?').run(Number(req.params.id));
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
      insights: buildInsights({ month, isCurrent, trend, categories, recurring, pace, forecast: fc, business, merchants, uncategorized, completeEnd, funds }),
      cycle: isCurrent ? cycleView(db, today, recurring, funds) : null,
      cards: cardBills(db, today),
      businessTips: business.hasBusiness ? businessData(db, month, today).tips.filter((t) => t.relevance === 'high').slice(0, 2) : [],
      uncategorized,
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
  function fontSetting(): { file: string | null; family: string | null; name: string | null; variable: boolean } {
    return {
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
    db.prepare("DELETE FROM meta WHERE key IN ('font_file', 'font_family', 'font_name', 'font_variable')").run();
    res.json(fontSetting());
  });

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

  api.put('/business/sumit', (req, res) => {
    const b = z.object({ companyId: z.string().regex(/^\d+$/), apiKey: z.string().min(8) }).parse(req.body);
    setMeta(db, 'sumit_creds', vault.seal(b));
    res.json({ ok: true });
  });

  api.delete('/business/sumit', (_req, res) => {
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
