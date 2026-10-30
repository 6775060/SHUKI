import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, setMeta } from '../src/db.js';
import { Vault } from '../src/vault.js';
import { Categorizer } from '../src/categorize.js';
import { ingestTransactions, upsertAccount } from '../src/ingest.js';
import { applyNewIncomeRules, incomeMix, incomeProfile } from '../src/profile.js';
import { buildInsights, detectRecurring, monthlyTrend } from '../src/insights.js';
import { businessData } from '../src/business.js';
import { Coach } from '../src/coach.js';
import { createApi } from '../src/api.js';
import type { SyncService } from '../src/sync.js';

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shefa-home-'));
  const db = openDb(dir);
  const categorizer = new Categorizer(db);
  const biz = upsertAccount(db, { connectionId: null, kind: 'bank', companyId: 'leumi', accountNumber: '1', label: 'עסק', defaultScope: 'business' });
  const priv = upsertAccount(db, { connectionId: null, kind: 'bank', companyId: 'hapoalim', accountNumber: '2', label: 'בית', defaultScope: 'private' });
  return { dir, db, categorizer, biz, priv };
}

const slugOf = (db: ReturnType<typeof openDb>, description: string) =>
  (db.prepare('SELECT c.slug FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.description = ?').get(description) as { slug: string }).slug;

// Six months of a clearing business next to a steady salary.
function fill(h: ReturnType<typeof home>) {
  for (const m of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) {
    const low = m === '2026-06';
    ingestTransactions(h.db, h.categorizer, h.biz, [
      { date: `${m}-05`, description: `ישראכרט זיכוי ${m}`, amount: low ? 6000 : 14000 },
      { date: `${m}-12`, description: `כאל זיכוי עסקאות ${m}`, amount: 4000 },
    ], 'import');
    ingestTransactions(h.db, h.categorizer, h.priv, [
      { date: `${m}-10`, description: `משכורת ${m}`, amount: 9000 },
      { date: `${m}-02`, description: 'חברת החשמל', amount: -450 },
      { date: `${m}-03`, description: 'משכנתא בנק', amount: -5200 },
      { date: `${m}-04`, description: 'בזק', amount: -120 },
    ], 'import');
  }
}

describe('household income', () => {
  it('files clearing deposits and the salary in their own categories', () => {
    const h = home();
    fill(h);
    expect(slugOf(h.db, 'ישראכרט זיכוי 2026-05')).toBe('income_clearing');
    expect(slugOf(h.db, 'כאל זיכוי עסקאות 2026-05')).toBe('income_clearing');
    expect(slugOf(h.db, 'משכורת 2026-05')).toBe('income_salary');
    // A card bill paid from the bank is still a transfer, not income.
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-09-15', description: 'ישראכרט חיוב', amount: -3000 }], 'import');
    expect(slugOf(h.db, 'ישראכרט חיוב')).toBe('card_payment');

    const p = incomeProfile(h.db, '2026-10-15');
    expect(p).toEqual({ business: 'clearing', salary: true, auto: true });
    const mix = incomeMix(h.db, '2026-09', 6);
    expect(mix.at(-1)).toEqual({ month: '2026-09', salary: 9000, business: 18000, other: 0 });
  });

  it('moves older income into the new categories once', () => {
    const h = home();
    // As filed by an older version, before the salary category existed.
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-01-10', description: 'משכורת ינואר', amount: 8000 }], 'import');
    h.db.prepare("UPDATE transactions SET category_id = ? WHERE description = 'משכורת ינואר'").run(h.categorizer.categoryIdBySlug('income_other'));
    expect(applyNewIncomeRules(h.db, h.categorizer)).toBe(1);
    expect(slugOf(h.db, 'משכורת ינואר')).toBe('income_salary');
    expect(applyNewIncomeRules(h.db, h.categorizer)).toBe(0);
  });

  it('speaks about clearing and the salary, not about clients', () => {
    const h = home();
    fill(h);
    const today = '2026-10-15';
    const trend = monthlyTrend(h.db, '2026-10', 12);
    const recurring = detectRecurring(h.db, today);
    const out = buildInsights({
      month: '2026-10',
      isCurrent: true,
      trend,
      categories: [],
      recurring,
      pace: { spentToDate: 0, avgToDate: null, avgFull: null, projected: 0 } as never,
      forecast: { start: 0, points: [], low: { date: '2026-11-01', balance: -10 }, firstNegative: '2026-11-01', assumptions: {} as never },
      business: { hasBusiness: true } as never,
      merchants: [],
      uncategorized: 0,
      completeEnd: '2026-10',
      funds: [],
      profile: incomeProfile(h.db, today),
      incomeMix: incomeMix(h.db, '2026-10', 6),
    });
    const text = out.map((i) => `${i.title} ${i.body}`).join('\n');
    expect(text).not.toContain('לקוח');
    expect(text).toContain('סליקה');
    expect(out.some((i) => i.title.startsWith('המשכורת הקבועה מכסה'))).toBe(true);
    expect(out.some((i) => i.title.startsWith('ההכנסה מהסליקה נעה'))).toBe(true);

    const tips = businessData(h.db, '2026-10', today).tips;
    expect(tips.map((t) => t.key)).not.toContain('concentration');
    expect(tips.map((t) => `${t.title} ${t.action}`).join('\n')).not.toContain('לקוח');
  });
});

// ---------- the coach, with a stand-in for the Claude API ----------

function fakeClient(script: ((params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Partial<Anthropic.Beta.BetaMessage>)[], seen: Anthropic.Beta.MessageCreateParamsNonStreaming[]) {
  let i = 0;
  return {
    models: { retrieve: async () => ({ id: 'claude-opus-5-5' }) },
    beta: {
      messages: {
        create: async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
          seen.push(structuredClone(params));
          return { stop_reason: 'end_turn', content: [], ...script[i++](params) };
        },
      },
    },
  } as unknown as Anthropic;
}

describe('coach', () => {
  it('chats with the real numbers, remembers, and keeps it all sealed', async () => {
    const h = home();
    fill(h);
    const vault = new Vault(h.db);
    vault.setup('master pass 1');
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const client = fakeClient(
      [
        () => ({
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 't1', name: 'search_transactions', input: { text: 'משכורת', month: null, category: null, direction: 'in' } } as never,
            { type: 'tool_use', id: 't2', name: 'remember', input: { note: 'כשהוא אומר "אין לי" זה בדרך כלל אחרי חודש סליקה חלש.' } } as never,
          ],
        }),
        () => ({ content: [{ type: 'text', text: 'נכנסו החודש 9,000 ₪ משכורת. זה בסיס יציב.' } as never] }),
      ],
      seen,
    );
    const coach = new Coach(h.db, vault, () => client);
    await coach.setKey('sk-ant-test-key-1234567890');
    const r = await coach.chat('אין לי כסף לכלום', '2026-10-15');

    expect(r.reply).toContain('בסיס יציב');
    expect(r.remembered).toHaveLength(1);
    const system = (seen[0].system as { text: string }[]).map((b) => b.text).join('\n');
    expect(system).toContain('עסק עם הכנסה מסליקת אשראי');
    expect(system).toContain('משכורת קבועה');
    expect(seen[0].model).toBe('claude-opus-5-5');
    expect(seen[0].fallbacks).toBe('default');
    // The tool results went back in one user turn.
    const toolTurn = seen[1].messages.at(-1)!;
    expect(Array.isArray(toolTurn.content) && toolTurn.content.map((b) => (b as { type: string }).type)).toEqual(['tool_result', 'tool_result']);
    expect(JSON.stringify(toolTurn.content)).toContain('9000');
    // The second request sees the note, the next conversation sees the history.
    expect(coach.state().memory[0].note).toContain('סליקה חלש');
    expect(coach.state().history.map((m) => m.role)).toEqual(['user', 'assistant']);

    // Nothing readable at rest: not the key, the chat or the note.
    const raw = JSON.stringify([h.db.prepare('SELECT * FROM coach_messages').all(), h.db.prepare('SELECT * FROM coach_memory').all(), h.db.prepare("SELECT value FROM meta WHERE key = 'anthropic_key'").get()]);
    expect(raw).not.toContain('אין לי');
    expect(raw).not.toContain('סליקה חלש');
    expect(raw).not.toContain('sk-ant-test');

    // A forgotten password takes the sealed coach data with it.
    vault.reset();
    expect(coach.enabled()).toBe(false);
    expect((h.db.prepare('SELECT COUNT(*) AS n FROM coach_messages').get() as { n: number }).n).toBe(0);
  });

  it('chooses one focus a day', async () => {
    const h = home();
    fill(h);
    const vault = new Vault(h.db);
    vault.setup('master pass 1');
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const focus = { title: 'החודש נכנסו 27,000 ₪', body: 'גם בחודש חלש הבית מכוסה.', action: 'להעביר 300 ₪ לקופת החגים' };
    const client = fakeClient([() => ({ content: [{ type: 'text', text: JSON.stringify(focus) } as never] }), () => ({ content: [{ type: 'text', text: JSON.stringify({ ...focus, title: 'אחר' }) } as never] })], seen);
    const coach = new Coach(h.db, vault, () => client);
    expect(await coach.focus('2026-10-15', false)).toBeNull(); // no key yet
    await coach.setKey('sk-ant-test-key-1234567890');
    expect(await coach.focus('2026-10-15', false)).toMatchObject(focus);
    expect(await coach.focus('2026-10-15', false)).toMatchObject(focus);
    expect(seen).toHaveLength(1);
    expect(seen[0].output_config?.format?.type).toBe('json_schema');
    expect((await coach.focus('2026-10-16', false))?.title).toBe('אחר');
  });
});

// ---------- security ----------

const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const h = home();
  const vault = new Vault(h.db);
  const sync = { status: () => ({ running: null }), enqueue: () => {}, enqueueAll: () => {} } as unknown as SyncService;
  const app = express();
  app.use('/api', createApi({ db: h.db, vault, categorizer: h.categorizer, sync, onUnlock: () => {} }));
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const call = (method: string, p: string, opts: { body?: unknown; token?: string; host?: string } = {}) =>
    new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
      const req = http.request(
        {
          port,
          method,
          path: `/api${p}`,
          headers: { host: opts.host ?? 'localhost', ...(data ? { 'content-type': 'application/json' } : {}), ...(opts.token ? { 'x-session': opts.token } : {}) },
        },
        (res) => {
          let s = '';
          res.on('data', (c) => (s += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: s ? JSON.parse(s) : {} }));
        },
      );
      req.on('error', reject);
      req.end(data);
    });
  return { ...h, vault, call };
}

describe('security', () => {
  it('keeps the phone away from the risky actions and logs every login', async () => {
    const s = await start();
    const token = (await s.call('POST', '/setup', { body: { password: 'master pass 1' } })).body.token as string;
    setMeta(s.db, 'remote_host', 'my-pc.tail1234.ts.net');
    const phone = (await s.call('POST', '/unlock', { body: { password: 'master pass 1' }, host: 'my-pc.tail1234.ts.net' })).body.token as string;

    expect((await s.call('GET', '/categories', { token: phone, host: 'my-pc.tail1234.ts.net' })).status).toBe(200);
    for (const [method, p] of [
      ['POST', '/backup'],
      ['POST', '/connections'],
      ['PUT', '/coach/key'],
      ['PUT', '/security'],
    ]) {
      expect((await s.call(method, p, { token: phone, host: 'my-pc.tail1234.ts.net', body: {} })).body.error).toBe('COMPUTER_ONLY');
    }
    const sec = (await s.call('GET', '/security', { token })).body;
    expect(sec.onPhone).toBe(false);
    expect((sec.logins as { phone: boolean }[]).map((l) => l.phone)).toEqual([true, false]);

    // Signing out everywhere ends the phone's session too.
    await s.call('POST', '/security/sign-out-all', { token });
    expect((await s.call('GET', '/categories', { token: phone, host: 'my-pc.tail1234.ts.net' })).status).toBe(401);
  });

  it('locks a session left idle and pauses after many wrong passwords', async () => {
    const s = await start();
    const token = (await s.call('POST', '/setup', { body: { password: 'master pass 1' } })).body.token as string;
    expect((await s.call('PUT', '/security', { token, body: { autoLockMinutes: 5 } })).status).toBe(200);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 6 * 60_000;
      expect((await s.call('GET', '/categories', { token })).status).toBe(401);
    } finally {
      Date.now = realNow;
    }
    // The vault stays open for the nightly sync; the password opens a new session.
    expect(s.vault.isUnlocked()).toBe(true);
    expect((await s.call('POST', '/unlock', { body: { password: 'master pass 1' } })).status).toBe(200);
  }, 60_000);

  it('blocks guessing after ten wrong passwords', async () => {
    const s = await start();
    await s.call('POST', '/setup', { body: { password: 'master pass 1' } });
    const realTimeout = globalThis.setTimeout;
    // Skip the growing delay between attempts.
    globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout;
    try {
      for (let i = 0; i < 10; i++) expect((await s.call('POST', '/unlock', { body: { password: `wrong ${i}` } })).status).toBe(401);
      const r = await s.call('POST', '/unlock', { body: { password: 'master pass 1' } });
      expect(r.status).toBe(429);
      expect(r.body.error).toBe('TOO_MANY_ATTEMPTS');
    } finally {
      globalThis.setTimeout = realTimeout;
    }
  }, 120_000);
});
