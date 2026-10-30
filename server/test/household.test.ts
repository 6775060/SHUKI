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
import { savingOpportunities } from '../src/opportunities.js';
import { dataCheck } from '../src/datacheck.js';
import { Receipts } from '../src/receipts.js';
import { cushionView, lastShabbat, maaserView, saveMaaserSettings, weekNumbers } from '../src/household.js';
import { Push, isShabbatQuiet } from '../src/push.js';
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
      { date: `${m}-20`, description: `סאמיט זיכוי סליקה ${m}`, amount: 2500 },
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
    expect(slugOf(h.db, 'סאמיט זיכוי סליקה 2026-05')).toBe('income_clearing');
    expect(slugOf(h.db, 'משכורת 2026-05')).toBe('income_salary');
    // A card bill paid from the bank is still a transfer, not income.
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-09-15', description: 'ישראכרט חיוב', amount: -3000 }], 'import');
    expect(slugOf(h.db, 'ישראכרט חיוב')).toBe('card_payment');

    const p = incomeProfile(h.db, '2026-10-15');
    expect(p).toEqual({ business: 'clearing', salary: true, auto: true });
    const mix = incomeMix(h.db, '2026-09', 6);
    expect(mix.at(-1)).toEqual({ month: '2026-09', salary: 9000, business: 20500, other: 0 });
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

describe('what to look at', () => {
  it('finds expenses worth a conversation and says if they are worth the effort', () => {
    const h = home();
    fill(h);
    for (const m of ['2026-06', '2026-07', '2026-08', '2026-09']) {
      ingestTransactions(h.db, h.categorizer, h.priv, [
        { date: `${m}-08`, description: 'NETFLIX.COM', amount: -55 },
        { date: `${m}-09`, description: 'SPOTIFY', amount: -25 },
        { date: `${m}-11`, description: 'הראל ביטוח רכב', amount: -380 },
        { date: `${m}-12`, description: 'מגדל ביטוח בריאות', amount: -210 },
      ], 'import');
    }
    const { opportunities, groups } = savingOpportunities(h.db, '2026-10-15');
    const keys = opportunities.map((o) => o.key);
    expect(keys).toContain('lever-telecom');
    expect(keys).toContain('lever-insurance');
    expect(keys.some((k) => k.startsWith('sub-'))).toBe(true);
    const ins = opportunities.find((o) => o.key === 'lever-insurance')!;
    expect(ins.monthly).toBe(590);
    expect(ins.saveYearly).toBe(Math.round(590 * 12 * 0.2));
    expect(ins.worth).toBe('high');
    // Most worth it first.
    expect(opportunities[0].worth).toBe('high');
    expect(groups.map((g) => g.key).sort()).toEqual(['insurance', 'subscriptions']);
    expect(groups.find((g) => g.key === 'insurance')!.items.map((i) => i.monthly)).toEqual([380, 210]);
  });

  it('says when the numbers cannot be trusted, and why', () => {
    const h = home();
    fill(h);
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-10-02', description: 'ישראכרט חיוב חודשי', amount: -3100 }], 'import');
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-10-03', description: 'שופרסל', amount: -412 }], 'import');
    h.db.prepare("INSERT INTO transactions (account_id, date, amount, description, category_id, scope, status, source, hash) SELECT account_id, date, amount, description, category_id, scope, status, 'scraper', hash || 'x' FROM transactions WHERE description = 'שופרסל'").run();
    const c = dataCheck(h.db, '2026-10-15');
    expect(c.ok).toBe(false);
    expect(c.items.map((i) => i.key)).toEqual(expect.arrayContaining(['card-ישראכרט', 'dups']));
    expect(c.items[0].level).toBe('critical');
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

describe('steady habits', () => {
  it('reviews the week that ended on Shabbat', () => {
    expect(lastShabbat('2026-10-31')).toBe('2026-10-31'); // a Saturday
    expect(lastShabbat('2026-11-03')).toBe('2026-10-31');
    const h = home();
    fill(h);
    const w = weekNumbers(h.db, '2026-09-13');
    expect([w.from, w.to]).toEqual(['2026-09-06', '2026-09-12']);
    expect(w.salary).toBe(9000);
    expect(w.business).toBe(4000);
  });

  it('keeps maaser in step with what came in', () => {
    const h = home();
    fill(h);
    ingestTransactions(h.db, h.categorizer, h.priv, [{ date: '2026-09-15', description: 'קופת העיר', amount: -1500 }], 'import');
    const all = maaserView(h.db, '2026-09-20');
    expect(all.pct).toBe(10);
    // net: salary 6×9000 + business (6 months of clearing, less VAT; no business costs)
    const biz = (14000 * 5 + 6000 + 4000 * 6 + 2500 * 6) / 1.18;
    expect(all.baseAmount).toBe(Math.round(9000 * 6 + biz));
    expect(all.given).toBe(1500);
    expect(all.balance).toBe(Math.round(all.owed - 1500));
    saveMaaserSettings(h.db, { pct: 20, base: 'all', carry: 1000 });
    const c = maaserView(h.db, '2026-09-20');
    expect(c.baseAmount).toBe(9000 * 6 + 14000 * 5 + 6000 + 4000 * 6 + 2500 * 6);
    expect(c.balance).toBe(Math.round(c.baseAmount * 0.2 + 1000 - 1500));
  });

  it('sizes a cushion by the weak month', () => {
    const h = home();
    fill(h);
    const c = cushionView(h.db, '2026-10-15');
    expect(c.monthlyExpenses).toBe(5770);
    expect(c.steadyIncome).toBe(9000);
    expect(c.weakBusiness).toBe(12500);
    // The salary alone covers the house, so the cushion is one month of expenses.
    expect(c.weakGap).toBe(0);
    expect(c.target).toBe(5770);
    expect(c.savedSource).toBe('none');
  });

  it('sends what matters to the phone, but not on Shabbat', async () => {
    expect(isShabbatQuiet(new Date(2026, 9, 30, 16))).toBe(true); // Friday afternoon
    expect(isShabbatQuiet(new Date(2026, 9, 31, 12))).toBe(true);
    expect(isShabbatQuiet(new Date(2026, 9, 31, 21, 30))).toBe(false);
    expect(isShabbatQuiet(new Date(2026, 10, 1, 9))).toBe(false);

    const h = home();
    fill(h);
    const vault = new Vault(h.db);
    vault.setup('master pass 1');
    const sent: { title: string; body: string }[] = [];
    const push = new Push(h.db, vault, (async (_s: unknown, payload: string) => {
      sent.push(JSON.parse(payload));
      return {} as never;
    }) as never);
    expect(push.publicKey()).toMatch(/^[A-Za-z0-9_-]{60,}$/);
    push.subscribe({ endpoint: 'https://push.example/1', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } });
    const sunday = new Date(2026, 10, 1, 10);
    await push.check(sunday); // first look sets the starting point
    ingestTransactions(h.db, h.categorizer, h.priv, [
      { date: '2026-10-31', description: 'חברת החשמל', amount: -1600 }, // usually 450
      { date: '2026-10-31', description: 'בזק', amount: -120 }, // as always
      { date: '2026-10-31', description: 'מוסך חדש', amount: -2200 }, // a new place
    ], 'import');
    expect(await push.check(new Date(2026, 9, 31, 12))).toEqual([]); // Shabbat: waits
    const out = await push.check(sunday);
    expect(out).toHaveLength(2);
    expect(sent.map((s) => s.title)).toEqual(['💳 חיוב חריג: ₪1,600', '💳 חיוב חריג: ₪2,200']);
    expect(sent[0].body).toContain('בדרך כלל כ-₪450');
    expect(await push.check(sunday)).toEqual([]);
  });
});

describe('invoices', () => {
  it('collects them from a folder, reads them and finds their transaction', async () => {
    const h = home();
    const vault = new Vault(h.db);
    vault.setup('master pass 1');
    ingestTransactions(h.db, h.categorizer, h.biz, [
      { date: '2026-10-06', description: 'אופיס דיפו', amount: -472 },
      { date: '2026-10-07', description: 'אחר', amount: -472 },
      { date: '2026-10-09', description: 'פרסום גוגל', amount: -300 },
    ], 'import');
    const folder = path.join(h.dir, 'drive', 'חשבוניות');
    fs.mkdirSync(path.join(folder, '2026'), { recursive: true });
    fs.writeFileSync(path.join(folder, '2026', 'office.pdf'), '%PDF-1.4 office depot');
    fs.writeFileSync(path.join(folder, 'flyer.jpg'), 'not an invoice');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'ignored');

    const answers: Record<string, unknown> = {
      'office.pdf': { is_invoice: true, vendor: 'אופיס דיפו בע"מ', date: '2026-10-05', total: 472, vat: 72, number: '1001' },
      'flyer.jpg': { is_invoice: false, vendor: null, date: null, total: null, vat: null, number: null },
    };
    const client = {
      models: { retrieve: async () => ({}) },
      beta: {
        messages: {
          create: async (p: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
            const name = JSON.stringify(p.messages[0].content).match(/שם הקובץ: ([^"]+)/)![1];
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answers[name]) }] };
          },
        },
      },
    } as unknown as Anthropic;
    const coach = new Coach(h.db, vault, () => client);
    const receipts = new Receipts(h.db, vault, coach, h.dir);
    receipts.setFolder(folder);
    expect(receipts.scanFolder()).toBe(2);
    expect(receipts.scanFolder()).toBe(0); // seen already
    expect(await receipts.readPending()).toBe(0); // no key yet: nothing is read
    await coach.setKey('sk-ant-test-key-1234567890');
    expect(await receipts.readPending()).toBe(1);

    const list = receipts.list();
    const office = list.find((r) => r.fileName === 'office.pdf')!;
    expect(office).toMatchObject({ status: 'read', vendor: 'אופיס דיפו בע"מ', amount: 472 });
    // Two charges of ₪472; the vendor's name decides.
    expect(office.txn?.description).toBe('אופיס דיפו');
    expect(list.find((r) => r.fileName === 'flyer.jpg')!.status).toBe('not_invoice');
    // The same file uploaded again is not stored twice.
    expect(receipts.add('upload', 'x', 'office.pdf', fs.readFileSync(path.join(folder, '2026', 'office.pdf')), 'application/pdf')).toBeNull();
    // Matched expenses no longer count as missing an invoice.
    expect(businessData(h.db, '2026-10', '2026-10-20').docs.expensesWithoutInvoice.map((e) => e.description)).toEqual(['אחר', 'פרסום גוגל']);
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

  it('counts a salary by the employer name the bank writes', async () => {
    const s = await start();
    const token = (await s.call('POST', '/setup', { body: { password: 'master pass 1' } })).body.token as string;
    ingestTransactions(s.db, s.categorizer, s.priv, [{ date: '2026-09-10', description: 'מפעלי הדוגמה בע"מ', amount: 8200 }], 'import');
    expect(slugOf(s.db, 'מפעלי הדוגמה בע"מ')).toBe('income_other');
    const r = await s.call('POST', '/profile/employer', { token, body: { name: 'מפעלי הדוגמה' } });
    expect(r.body.changed).toBe(1);
    expect(r.body.employers).toEqual([{ id: expect.any(Number), name: 'מפעלי הדוגמה' }]);
    expect(slugOf(s.db, 'מפעלי הדוגמה בע"מ')).toBe('income_salary');
    const id = (r.body.employers as { id: number }[])[0].id;
    expect(((await s.call('DELETE', `/profile/employer/${id}`, { token })).body.employers as unknown[]).length).toBe(0);
    expect(slugOf(s.db, 'מפעלי הדוגמה בע"מ')).toBe('income_other');
  });

  it('locks a session left idle and pauses after many wrong passwords', async () => {
    const s = await start();
    const token = (await s.call('POST', '/setup', { body: { password: 'master pass 1' } })).body.token as string;
    expect((await s.call('PUT', '/security', { token, body: { autoLockMinutes: 15 } })).status).toBe(200);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 16 * 60_000;
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
