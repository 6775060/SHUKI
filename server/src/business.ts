import crypto from 'node:crypto';
import type { DB } from './db.js';
import { getMeta, setMeta, transaction } from './db.js';
import type { Vault } from './vault.js';
import { addMonths, categoryComparison, merchantKey, monthlyTrend, type CategoryCompare, type MonthPoint } from './insights.js';
import { ownerPay, type OwnerPay } from './cycle.js';
import { clean, parseAmount, parseDate, readRows, type Cell } from './importer.js';
import { incomeProfile, type BusinessModel } from './profile.js';

// Everything about running the business, kept off the home dashboard:
// profitability, VAT, owner pay, clients, clearing fees, documents, and
// tips to grow profit that apply to this business's actual numbers.

const VAT = 0.18;
const round = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 100);
const ils = (n: number) => `₪${Math.round(Math.abs(n)).toLocaleString('he-IL')}`;

export type DocSource = 'sumit' | 'grow' | 'paperless' | 'other';

export interface BusinessDoc {
  source: DocSource;
  kind: 'income' | 'expense' | 'payment';
  externalId: string;
  date: string;
  number?: string;
  counterparty?: string;
  amount: number; // gross, positive
  vat?: number;
  fee?: number;
  status?: string;
}

export function saveDocs(db: DB, docs: BusinessDoc[]): { added: number; updated: number } {
  const upsert = db.prepare(`
    INSERT INTO business_docs (source, kind, external_id, doc_date, number, counterparty, amount, vat, fee, status)
    VALUES (@source, @kind, @externalId, @date, @number, @counterparty, @amount, @vat, @fee, @status)
    ON CONFLICT(source, external_id) DO UPDATE SET
      doc_date = excluded.doc_date, number = excluded.number, counterparty = excluded.counterparty,
      amount = excluded.amount, vat = excluded.vat, fee = excluded.fee, status = excluded.status`);
  const exists = db.prepare('SELECT 1 FROM business_docs WHERE source = ? AND external_id = ?');
  let added = 0;
  let updated = 0;
  transaction(db, () => {
    for (const d of docs) {
      if (exists.get(d.source, d.externalId)) updated++;
      else added++;
      upsert.run({
        source: d.source,
        kind: d.kind,
        externalId: d.externalId,
        date: d.date,
        amount: d.amount,
        number: d.number ?? null,
        counterparty: d.counterparty ?? null,
        vat: d.vat ?? null,
        fee: d.fee ?? null,
        status: d.status ?? null,
      });
    }
  });
  return { added, updated };
}

// ---------- file import (SUMIT / Grow / Paperless exports) ----------

const COLS = {
  date: ['תאריך מסמך', 'תאריך עסקה', 'תאריך חשבונית', 'תאריך', 'date'],
  number: ['מספר מסמך', 'מס\' מסמך', 'מספר חשבונית', 'מספר עסקה', 'אסמכתא', 'מספר', 'number'],
  party: ['שם לקוח', 'לקוח', 'שם הספק', 'ספק', 'שם העסק', 'בית עסק', 'שם', 'משלם', 'customer', 'supplier', 'name'],
  amount: ['סה"כ כולל מע"מ', 'סכום כולל מע"מ', 'סה"כ לתשלום', 'סכום ברוטו', 'סה"כ', 'סכום העסקה', 'סכום', 'total', 'amount'],
  vat: ['מע"מ', 'vat'],
  fee: ['עמלה', 'עמלות', 'fee'],
  type: ['סוג מסמך', 'סוג', 'type'],
  status: ['סטטוס', 'מצב', 'status'],
};

function find(headers: string[], names: string[], exclude: number[] = []): number | undefined {
  for (const n of names) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && h.toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  for (const n of names) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && h.toLowerCase().includes(n.toLowerCase()));
    if (i !== -1) return i;
  }
  return undefined;
}

export async function parseDocsFile(filename: string, buf: Buffer, source: DocSource, defaultKind: BusinessDoc['kind']): Promise<{ docs: BusinessDoc[]; skipped: number; headers: string[] }> {
  const rows = await readRows(filename, buf);
  let h = -1;
  let map: Record<keyof typeof COLS, number | undefined> | null = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const headers = rows[i].map(clean);
    const date = find(headers, COLS.date);
    if (date === undefined) continue;
    const amount = find(headers, COLS.amount, [date]);
    if (amount === undefined) continue;
    const used = [date, amount];
    // "מע"מ" also appears inside "סה"כ כולל מע"מ", so match it exactly or not at all.
    const vat = headers.findIndex((x, idx) => !used.includes(idx) && (x === 'מע"מ' || x.toLowerCase() === 'vat' || x === 'סכום מע"מ'));
    map = {
      date,
      amount,
      number: find(headers, COLS.number, used),
      party: find(headers, COLS.party, used),
      vat: vat === -1 ? undefined : vat,
      fee: find(headers, COLS.fee, used),
      type: find(headers, COLS.type, used),
      status: find(headers, COLS.status, used),
    };
    h = i;
    break;
  }
  if (!map) throw new Error('HEADER_NOT_FOUND');
  const docs: BusinessDoc[] = [];
  let skipped = 0;
  const cell = (r: Cell[], i: number | undefined) => (i === undefined ? null : (r[i] ?? null));
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(cell(r, map.date));
    const amount = parseAmount(cell(r, map.amount));
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const type = clean(cell(r, map.type));
    // Credit notes reduce income; mark them negative.
    const isCredit = /זיכוי|ביטול|credit/i.test(type);
    const number = clean(cell(r, map.number)) || undefined;
    const party = clean(cell(r, map.party)) || undefined;
    docs.push({
      source,
      kind: /קבלה|receipt/i.test(type) && defaultKind === 'income' ? 'payment' : defaultKind,
      externalId: number ? `${type}|${number}` : crypto.createHash('sha1').update(`${date}|${amount}|${party ?? ''}`).digest('hex').slice(0, 16),
      date,
      number,
      counterparty: party,
      amount: isCredit ? -Math.abs(amount) : Math.abs(amount),
      vat: parseAmount(cell(r, map.vat)) ?? undefined,
      fee: parseAmount(cell(r, map.fee)) ?? undefined,
      status: clean(cell(r, map.status)) || undefined,
    });
  }
  return { docs, skipped, headers: rows[h].map(clean) };
}

// ---------- SUMIT API (experimental) ----------

// SUMIT's API takes POST requests with Credentials { CompanyID, APIKey } in the
// body. The document-list endpoint and fields could not be verified while
// building this, so the response is read defensively and a clear error is
// returned if the shape is unexpected; file export stays as the fallback.
export async function fetchSumitDocuments(creds: { companyId: string; apiKey: string }, from: string, to: string): Promise<BusinessDoc[]> {
  const res = await fetch('https://api.sumit.co.il/accounting/documents/list/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      Credentials: { CompanyID: Number(creds.companyId), APIKey: creds.apiKey },
      DateFrom: `${from}T00:00:00`,
      DateTo: `${to}T23:59:59`,
      IncludeDrafts: false,
    }),
  });
  if (!res.ok) throw new Error(`SUMIT_HTTP_${res.status}`);
  const body = (await res.json()) as { Status?: unknown; UserErrorMessage?: string; Data?: Record<string, unknown> };
  if (body.UserErrorMessage) throw new Error(`SUMIT: ${body.UserErrorMessage}`);
  const data = body.Data ?? (body as Record<string, unknown>);
  const list = (Object.values(data).find((v) => Array.isArray(v)) ?? []) as Record<string, unknown>[];
  if (!Array.isArray(list)) throw new Error('SUMIT_UNEXPECTED_SHAPE');
  const pick = (o: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
    return undefined;
  };
  return list.flatMap((d) => {
    const date = parseDate(String(pick(d, ['Date', 'DocumentDate', 'CreationDate']) ?? ''));
    const amount = Number(pick(d, ['DocumentValue', 'TotalAmount', 'Amount', 'Total']) ?? NaN);
    if (!date || !Number.isFinite(amount)) return [];
    const type = String(pick(d, ['TypeName', 'Type', 'DocumentType']) ?? '');
    const customer = pick(d, ['CustomerName', 'Customer']) as unknown;
    const name = typeof customer === 'object' && customer ? String((customer as Record<string, unknown>).Name ?? '') : String(customer ?? '');
    const id = String(pick(d, ['DocumentID', 'ID', 'DocumentNumber']) ?? `${date}|${amount}`);
    return [
      {
        source: 'sumit' as const,
        kind: /קבלה|receipt/i.test(type) && !/חשבונית/.test(type) ? ('payment' as const) : ('income' as const),
        externalId: id,
        date,
        number: String(pick(d, ['DocumentNumber', 'Number']) ?? '') || undefined,
        counterparty: name || undefined,
        amount: /זיכוי|credit/i.test(type) ? -Math.abs(amount) : amount,
        vat: Number(pick(d, ['VAT', 'VATAmount']) ?? NaN) || undefined,
      },
    ];
  });
}

export async function syncSumit(db: DB, vault: Vault, today: string): Promise<{ added: number; updated: number }> {
  const sealed = getMeta(db, 'sumit_creds');
  if (!sealed) throw new Error('NOT_CONNECTED');
  try {
    const docs = await fetchSumitDocuments(vault.open(sealed), `${addMonths(today.slice(0, 7), -12)}-01`, today);
    const r = saveDocs(db, docs);
    setMeta(db, 'sumit_last_sync', new Date().toISOString());
    db.prepare("DELETE FROM meta WHERE key = 'sumit_error'").run();
    return r;
  } catch (err) {
    setMeta(db, 'sumit_error', (err as Error).message);
    throw err;
  }
}

// ---------- the business view ----------

export interface Tip {
  key: string;
  icon: string;
  title: string;
  why: string;
  action: string;
  impact: number | null; // estimated ₪ per month
  relevance: 'high' | 'medium';
}

export interface BusinessData {
  month: string;
  trend: MonthPoint[];
  income: number;
  expenses: number;
  net: number;
  margin: number | null;
  avgIncome: number | null;
  avgNet: number | null;
  vat: { sales: number; purchases: number; estimate: number };
  taxReservePct: number;
  allocation: { label: string; pct: number; amount: number }[];
  ownerPay: OwnerPay;
  categories: CategoryCompare[];
  clients: { name: string; total: number; share: number; count: number }[];
  clientSource: 'documents' | 'bank';
  incomeModel: BusinessModel;
  activeClients: number[];
  fees: { total: number; pctOfTurnover: number | null; bySource: { name: string; total: number }[] };
  docs: {
    count: number;
    lastDate: string | null;
    openInvoices: { number: string | null; counterparty: string | null; date: string; amount: number; days: number }[];
    expensesWithoutInvoice: { date: string; description: string; amount: number }[];
  };
  tips: Tip[];
}

export function businessData(db: DB, month: string, today: string): BusinessData {
  const trend = monthlyTrend(db, month, 12);
  const cur = trend[trend.length - 1];
  const isCurrent = month === today.slice(0, 7);
  const complete = trend.filter((p) => (isCurrent ? p.month < month : p.month <= month) && (p.bizIncome > 0 || p.bizExpenses > 0));
  const last6 = complete.slice(-6);
  const avgIncome = last6.length ? last6.reduce((s, p) => s + p.bizIncome, 0) / last6.length : null;
  const avgNet = last6.length ? last6.reduce((s, p) => s + p.bizIncome - p.bizExpenses, 0) / last6.length : null;

  const range = [`${month}-01`, `${addMonths(month, 1)}-01`];
  const deductible = (
    db
      .prepare(
        `SELECT COALESCE(SUM(-t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.scope = 'business' AND t.amount < 0 AND c.kind = 'expense'
           AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'biz_fees', 'pension', 'savings', 'loans', 'interest')
           AND t.date >= ? AND t.date < ?`,
      )
      .get(range[0], range[1]) as { s: number }
  ).s;
  const vatSales = (cur.bizIncome * VAT) / (1 + VAT);
  const vatPurchases = (deductible * VAT) / (1 + VAT);
  const taxReservePct = Number(getMeta(db, 'tax_reserve_pct') ?? 15);

  // Profit First: split this month's business income the moment it lands.
  const afterVat = cur.bizIncome - vatSales;
  const profitPct = 5;
  const ownerPct = 50;
  const allocation = [
    { label: 'מע"מ – לא שלך', pct: Math.round((VAT / (1 + VAT)) * 1000) / 10, amount: round(vatSales) },
    { label: 'מס הכנסה וביטוח לאומי', pct: taxReservePct, amount: round((afterVat * taxReservePct) / 100) },
    { label: 'משכורת לבית', pct: ownerPct, amount: round((afterVat * ownerPct) / 100) },
    { label: 'רווח וכרית לעסק', pct: profitPct, amount: round((afterVat * profitPct) / 100) },
    { label: 'הוצאות תפעול', pct: 100 - taxReservePct - ownerPct - profitPct, amount: round((afterVat * (100 - taxReservePct - ownerPct - profitPct)) / 100) },
  ];

  const categories = categoryComparison(db, month, 'business');

  // Clients: prefer issued invoices; fall back to bank deposit descriptions.
  const from3 = `${addMonths(month, -2)}-01`;
  // Invoices if there are any; otherwise clearing payments (Grow).
  const docsOf = (kind: string) =>
    db.prepare('SELECT counterparty AS name, amount FROM business_docs WHERE kind = ? AND doc_date >= ? AND doc_date < ?').all(kind, from3, range[1]) as {
      name: string | null;
      amount: number;
    }[];
  const invoices = docsOf('income');
  const docRows = invoices.length ? invoices : docsOf('payment');
  const clientSource: BusinessData['clientSource'] = docRows.length ? 'documents' : 'bank';
  const rows = docRows.length
    ? docRows.map((r) => ({ name: r.name ?? 'ללא שם', amount: r.amount }))
    : (db
        .prepare(
          `SELECT t.description AS name, t.amount FROM transactions t JOIN categories c ON c.id = t.category_id
           WHERE t.scope = 'business' AND t.amount > 0 AND c.kind <> 'transfer' AND t.date >= ? AND t.date < ?`,
        )
        .all(from3, range[1]) as { name: string; amount: number }[]);
  const clientMap = new Map<string, { name: string; total: number; count: number }>();
  for (const r of rows) {
    const k = merchantKey(r.name) || r.name;
    const e = clientMap.get(k) ?? { name: r.name.replace(/^העברה מלקוח\s*/, ''), total: 0, count: 0 };
    e.total += r.amount;
    e.count++;
    clientMap.set(k, e);
  }
  const clientTotal = [...clientMap.values()].reduce((s, e) => s + e.total, 0);
  const clients = [...clientMap.values()].sort((a, b) => b.total - a.total).map((e) => ({ ...e, total: round(e.total), share: clientTotal ? e.total / clientTotal : 0 }));

  const activeClients = trend.map((p) => {
    const r = db
      .prepare(
        `SELECT t.description FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.scope = 'business' AND t.amount > 0 AND c.kind <> 'transfer' AND substr(t.date, 1, 7) = ?`,
      )
      .all(p.month) as { description: string }[];
    return new Set(r.map((x) => merchantKey(x.description))).size;
  });

  // Clearing and bank fees.
  const feeBank = db
    .prepare(
      `SELECT t.description AS name, -SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.slug = 'biz_fees' AND t.date >= ? AND t.date < ? GROUP BY t.description`,
    )
    .all(from3, range[1]) as { name: string; total: number }[];
  const feeDocs = (db.prepare('SELECT source AS name, SUM(fee) AS total FROM business_docs WHERE fee IS NOT NULL AND doc_date >= ? AND doc_date < ? GROUP BY source').all(from3, range[1]) as { name: string; total: number }[]).map(
    (r) => ({ name: r.name === 'grow' ? 'עמלות סליקה – Grow' : r.name === 'sumit' ? 'עמלות – SUMIT' : `עמלות – ${r.name}`, total: Math.abs(r.total) }),
  );
  const feesBy = [...feeDocs, ...feeBank].sort((a, b) => b.total - a.total);
  const feeTotal = feesBy.reduce((s, r) => s + r.total, 0);
  const turnover3 = trend.slice(-3).reduce((s, p) => s + p.bizIncome, 0);

  // Documents.
  const docCount = db.prepare('SELECT COUNT(*) AS n, MAX(doc_date) AS d FROM business_docs').get() as { n: number; d: string | null };
  const openInvoices = findOpenInvoices(db, today);
  const expensesWithoutInvoice = findUninvoicedExpenses(db, month);

  const data: BusinessData = {
    month,
    trend,
    income: round(cur.bizIncome),
    expenses: round(cur.bizExpenses),
    net: round(cur.bizIncome - cur.bizExpenses),
    margin: cur.bizIncome > 0 ? (cur.bizIncome - cur.bizExpenses) / cur.bizIncome : null,
    avgIncome: avgIncome === null ? null : round(avgIncome),
    avgNet: avgNet === null ? null : round(avgNet),
    vat: { sales: round(vatSales), purchases: round(vatPurchases), estimate: round(Math.max(0, vatSales - vatPurchases)) },
    taxReservePct,
    allocation,
    ownerPay: ownerPay(db, today),
    categories,
    clients,
    clientSource,
    incomeModel: incomeProfile(db, today).business,
    activeClients,
    fees: { total: round(feeTotal), pctOfTurnover: turnover3 > 0 ? feeTotal / turnover3 : null, bySource: feesBy.map((r) => ({ ...r, total: round(r.total) })) },
    docs: { count: docCount.n, lastDate: docCount.d, openInvoices, expensesWithoutInvoice },
    tips: [],
  };
  data.tips = profitTips(data, last6);
  return data;
}

// An income invoice with no matching deposit (same amount ±1%, within 45 days
// after it) in a business account is likely still unpaid.
function findOpenInvoices(db: DB, today: string): BusinessData['docs']['openInvoices'] {
  const invoices = db
    .prepare(
      `SELECT number, counterparty, doc_date AS date, amount FROM business_docs
       WHERE kind = 'income' AND amount > 0 AND doc_date >= date(?, '-120 days') AND (status IS NULL OR status NOT LIKE '%שולם%')`,
    )
    .all(today) as { number: string | null; counterparty: string | null; date: string; amount: number }[];
  const paid = db.prepare(
    `SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.default_scope = 'business' AND t.amount BETWEEN ? AND ? AND t.date >= ? AND t.date <= date(?, '+45 days') LIMIT 1`,
  );
  const receipt = db.prepare("SELECT 1 FROM business_docs WHERE kind = 'payment' AND number IS NOT NULL AND counterparty IS ? AND abs(amount - ?) < 1 LIMIT 1");
  return invoices
    .filter((i) => !paid.get(i.amount * 0.99, i.amount * 1.01, i.date, i.date) && !receipt.get(i.counterparty, i.amount))
    .map((i) => ({ ...i, days: Math.round((Date.parse(today) - Date.parse(i.date)) / 86400000) }))
    .filter((i) => i.days >= 7)
    .sort((a, b) => b.days - a.days)
    .slice(0, 12);
}

// Business card/bank expenses with no expense invoice of the same amount
// within a week (from Paperless). Only shown once expense documents exist.
function findUninvoicedExpenses(db: DB, month: string): BusinessData['docs']['expensesWithoutInvoice'] {
  const has = db.prepare("SELECT 1 FROM business_docs WHERE kind = 'expense' UNION ALL SELECT 1 FROM receipts WHERE status = 'read' LIMIT 1").get();
  if (!has) return [];
  const rows = db
    .prepare(
      `SELECT t.date, t.description, -t.amount AS amount FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.scope = 'business' AND t.amount < -50 AND c.kind = 'expense'
         AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.txn_id = t.id)
         AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'biz_fees', 'pension', 'loans', 'interest')
         AND t.date >= ? AND t.date < ?`,
    )
    .all(`${addMonths(month, -1)}-01`, `${addMonths(month, 1)}-01`) as { date: string; description: string; amount: number }[];
  const match = db.prepare("SELECT 1 FROM business_docs WHERE kind = 'expense' AND abs(amount - ?) <= 1 AND abs(julianday(doc_date) - julianday(?)) <= 7 LIMIT 1");
  return rows.filter((r) => !match.get(r.amount, r.date)).slice(0, 15);
}

// ---------- profit tips ----------

function profitTips(d: BusinessData, last6: MonthPoint[]): Tip[] {
  const tips: Tip[] = [];
  // Income through card clearing has no invoices or named clients to chase,
  // and the "sources" are the clearing companies, not customers.
  const clearing = d.incomeModel === 'clearing';
  const avgIncome = d.avgIncome ?? 0;
  if (avgIncome <= 0) return tips;

  const margin = d.avgNet !== null ? d.avgNet / avgIncome : null;
  const growth = last6.length >= 4 ? last6.slice(-2).reduce((s, p) => s + p.bizIncome, 0) / 2 / (last6.slice(0, 2).reduce((s, p) => s + p.bizIncome, 0) / 2) - 1 : null;

  // Pricing: the highest-leverage lever, almost always relevant.
  tips.push({
    key: 'pricing',
    icon: '🏷️',
    title: clearing ? 'העלאת מחיר של 7%' : 'העלאת מחיר של 7% ללקוחות ותיקים',
    why:
      growth !== null && growth < 0.05
        ? `ההכנסה העסקית כמעט לא גדלה בחצי השנה האחרונה (${growth >= 0 ? '+' : ''}${pct(growth)}%). העלאת מחיר היא הדרך המהירה ביותר להגדיל רווח – בלי עוד שעות עבודה.`
        : 'העלאת מחיר היא הדרך המהירה ביותר להגדיל רווח – בלי עוד שעות עבודה. רוב העצמאים מתמחרים נמוך מדי.',
    action: clearing
      ? 'לבחור שניים-שלושה מוצרים או שירותים מבוקשים ולעדכן את המחיר שלהם מהחודש הבא. רוב הקונים לא עוזבים בגלל שינוי קטן.'
      : 'לבחור לקוח ותיק אחד או שניים, ולהודיע מראש על עדכון מחיר מהחודש הבא. רוב הלקוחות נשארים.',
    impact: round(avgIncome * 0.07),
    relevance: growth !== null && growth < 0.05 ? 'high' : 'medium',
  });

  const top2 = d.clients.slice(0, 2).reduce((s, c) => s + c.share, 0);
  if (!clearing && d.clients.length >= 2 && top2 >= 0.55) {
    tips.push({
      key: 'concentration',
      icon: '🧱',
      title: 'לפזר את הסיכון בין יותר לקוחות',
      why: `${pct(top2)}% מההכנסה ב-3 החודשים האחרונים הגיעה משני לקוחות. אם אחד מהם עוצר – זה כואב.`,
      action: 'לבקש מלקוח מרוצה המלצה או הפניה אחת החודש, ולהציע לו משהו בתמורה.',
      impact: null,
      relevance: top2 >= 0.7 ? 'high' : 'medium',
    });
  }

  const volatility = last6.length >= 3 ? stdev(last6.map((p) => p.bizIncome)) / avgIncome : 0;
  if (volatility > 0.25) {
    tips.push({
      key: 'retainer',
      icon: '🔁',
      title: clearing ? 'להוסיף הכנסה שחוזרת כל חודש' : 'חבילה חודשית קבועה במקום עבודות בודדות',
      why: `ההכנסה משתנה בכ-${pct(volatility)}% מחודש לחודש. הכנסה חוזרת מייצבת את התזרים ואת השקט.`,
      action: clearing
        ? 'להציע לקונים קבועים מנוי, כרטיסייה או חבילה בתשלום קבוע בכרטיס. גם חלק קטן מההכנסה שמגיע בקביעות מרגיע את החודש.'
        : 'להציע ללקוח קבוע חבילת שירות חודשית (ריטיינר) במחיר מעט נמוך יותר תמורת התחייבות.',
      impact: null,
      relevance: volatility > 0.4 ? 'high' : 'medium',
    });
  }

  if (d.fees.pctOfTurnover !== null && d.fees.pctOfTurnover > 0.015 && d.fees.total > 150) {
    tips.push({
      key: 'fees',
      icon: '💳',
      title: 'להוזיל עמלות סליקה ובנק',
      why: `עמלות ב-3 החודשים האחרונים: ${ils(d.fees.total)} – ${(d.fees.pctOfTurnover * 100).toFixed(1)}% מהמחזור.`,
      action: clearing
        ? 'הסליקה היא כל ההכנסה שלך, אז לכל עשירית אחוז יש משקל. לבקש מחברת הסליקה הצעה מחודשת (אפשר להשוות ל-Grow, SUMIT וחברות אחרות) ולבדוק גם את עמלות הבנק על הזיכויים.'
        : 'לבקש מחברת הסליקה ומהבנק הצעה מחודשת (אפשר להשוות ל-Grow, SUMIT וחברות אחרות), ולהציע ללקוחות גדולים העברה בנקאית.',
      impact: round((d.fees.total / 3) * 0.3),
      relevance: d.fees.pctOfTurnover > 0.025 ? 'high' : 'medium',
    });
  }

  if (margin !== null && margin < 0.35) {
    const top = d.categories.filter((c) => c.avg > 0).sort((a, b) => b.avg - a.avg)[0];
    tips.push({
      key: 'margin',
      icon: '📐',
      title: 'לבדוק את ההוצאות העסקיות',
      why: `נשאר בעסק כ-${pct(margin)}% מההכנסה אחרי הוצאות (כולל מסים).${top ? ` ההוצאה הגדולה: ${top.name}, כ-${ils(top.avg)} בחודש.` : ''}`,
      action: 'לעבור על 5 ההוצאות העסקיות הגדולות ולשאול על כל אחת: היא מכניסה כסף? אפשר בזול יותר?',
      impact: top ? round(top.avg * 0.15) : null,
      relevance: margin < 0.2 ? 'high' : 'medium',
    });
  }

  const marketing = d.categories.find((c) => c.slug === 'biz_marketing');
  if (marketing && marketing.avg > 0) {
    tips.push({
      key: 'marketing',
      icon: '📣',
      title: 'למדוד מה השיווק מחזיר',
      why: `השיווק עולה כ-${ils(marketing.avg)} בחודש (${pct(marketing.avg / avgIncome)}% מההכנסה).`,
      action: clearing
        ? 'להשוות את ימי ההכנסה הגבוהים בסליקה לימים שבהם רץ פרסום. אחרי חודשיים יהיה ברור מה עובד – ומה אפשר לעצור.'
        : 'לשאול כל לקוח חדש "איך הגעת אליי?" ולרשום. אחרי חודשיים יהיה ברור מה עובד – ומה אפשר לעצור.',
      impact: null,
      relevance: marketing.avg / avgIncome > 0.08 ? 'high' : 'medium',
    });
  }

  if (!clearing && d.docs.openInvoices.length) {
    const total = d.docs.openInvoices.reduce((s, i) => s + i.amount, 0);
    tips.push({
      key: 'collect',
      icon: '📬',
      title: `לגבות ${d.docs.openInvoices.length} חשבוניות פתוחות`,
      why: `כ-${ils(total)} בחשבוניות שהוצאו ועוד לא נראה תשלום מולן בבנק.`,
      action: 'תזכורת עדינה ללקוח היום. כדאי לקבוע תנאי תשלום קבועים (למשל שוטף + 30) ולהזכיר אוטומטית.',
      impact: null,
      relevance: 'high',
    });
  }

  const op = d.ownerPay;
  if (op.sustainable !== null && op.actualAvg !== null && op.actualAvg > op.sustainable * 1.1) {
    tips.push({
      key: 'ownerpay',
      icon: '⚖️',
      title: 'המשכורת לבית גבוהה ממה שהעסק מייצר',
      why: `בממוצע עובר הביתה ${ils(op.actualAvg)}, והעסק מייצר כ-${ils(op.sustainable)} בחודש אחרי הוצאות ומסים.`,
      action: clearing ? 'או להגדיל הכנסה (תמחור, מכירות), או להתאים זמנית את המשכורת – כדי שהעסק לא יישחק.' : 'או להגדיל הכנסה (תמחור, לקוחות), או להתאים זמנית את המשכורת – כדי שהעסק לא יישחק.',
      impact: null,
      relevance: 'high',
    });
  }

  if (op.sustainable !== null && op.actualAvg !== null && op.actualAvg < op.sustainable * 0.8) {
    tips.push({
      key: 'ownerpay_low',
      icon: '🏠',
      title: 'העסק יכול לשלם לבית יותר',
      why: `העסק מייצר כ-${ils(op.sustainable)} בחודש אחרי הוצאות ומסים, והבית מקבל בממוצע ${ils(op.actualAvg)}. אם בבית מרגישים מחסור – ייתכן שהכסף פשוט נשאר בעסק.`,
      action: 'לקבוע משכורת חודשית קבועה מהעסק לבית, באותו יום בכל חודש. את העודף להשאיר כרית לעסק או להעביר לחיסכון.',
      impact: round(op.sustainable - op.actualAvg),
      relevance: 'high',
    });
  }

  if (d.docs.expensesWithoutInvoice.length >= 3) {
    const total = d.docs.expensesWithoutInvoice.reduce((s, e) => s + e.amount, 0);
    tips.push({
      key: 'invoices',
      icon: '🧾',
      title: 'לאסוף חשבוניות להוצאות העסקיות',
      why: `${d.docs.expensesWithoutInvoice.length} הוצאות עסקיות (${ils(total)}) בלי חשבונית (מ-Paperless, מהמייל או מתיקיית ה-Drive). בלי חשבונית אין קיזוז מע"מ – כ-${ils((total * VAT) / (1 + VAT))}.`,
      action: 'לבקש מהספקים חשבונית ולהעלות ל-Paperless.',
      impact: round(((total * VAT) / (1 + VAT)) / 2),
      relevance: 'high',
    });
  }

  const order = { high: 0, medium: 1 };
  return tips.sort((a, b) => order[a.relevance] - order[b.relevance] || (b.impact ?? 0) - (a.impact ?? 0));
}

function stdev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
