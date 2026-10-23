import type { DB } from './db.js';
import { merchantKey } from './categorize.js';

export { merchantKey };

// Everything the dashboard shows beyond raw totals: trends, recurring charges,
// a cash-flow forecast, a health score and plain-Hebrew insights. All numbers
// come from the user's own transactions; estimates are labelled as such.

const VAT_RATE = 0.18;
const COUNTED = "c.kind <> 'transfer'";

export interface MonthPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
  bizIncome: number;
  bizExpenses: number;
}

export interface CategoryCompare {
  categoryId: number;
  slug: string | null;
  name: string;
  grp: string;
  total: number;
  avg: number;
  deltaPct: number | null;
  steady: boolean; // present in every one of the comparison months
}

export interface Recurring {
  key: string;
  name: string;
  categoryName: string | null;
  categorySlug: string | null;
  amount: number; // signed, typical charge
  periodMonths: 1 | 2;
  monthsSeen: number;
  lastDate: string;
  nextDate: string;
  annual: number;
  priceChangePct: number | null;
  isNew: boolean;
  isTax: boolean;
  accountKind: string;
  scope: 'private' | 'business' | null;
}

const TAX_SLUGS = new Set(['vat', 'income_tax', 'bituach_leumi']);
const BILL_SLUGS = new Set([
  ...TAX_SLUGS,
  'arnona', 'electricity', 'water', 'gas', 'insurance', 'telecom', 'house_committee', 'housing', 'loans', 'pension', 'biz_accountant',
]);
// Spending that comes in lumps by nature; compared against funds, not monthly averages.
const LUMPY_GROUPS = new Set(['הוצאות שנתיות', 'מסים']);
const LUMPY_SLUGS = new Set(['dental']);

export interface ForecastPoint {
  date: string;
  balance: number;
}

export interface Forecast {
  start: number;
  points: ForecastPoint[];
  low: ForecastPoint;
  firstNegative: string | null;
  assumptions: { dailyVariableSpend: number; dailyIrregularIncome: number; cardChargesAhead: number; recurringItems: number };
}

export interface HealthPart {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface Insight {
  tone: 'good' | 'neutral' | 'attention';
  icon: string;
  title: string;
  body: string;
  link?: { page: string; params?: Record<string, string> };
}

// ---------- dates ----------

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addOneMonthToDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const month = addMonths(`${y}-${String(m).padStart(2, '0')}`, 1);
  return `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, '0')}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 100);

// ---------- trend ----------

export function monthlyTrend(db: DB, endMonth: string, count = 12): MonthPoint[] {
  const start = addMonths(endMonth, -(count - 1));
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
         COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount END), 0) AS expenses,
         COALESCE(SUM(CASE WHEN t.amount > 0 AND t.scope = 'business' THEN t.amount END), 0) AS bizIncome,
         COALESCE(SUM(CASE WHEN t.amount < 0 AND t.scope = 'business' THEN -t.amount END), 0) AS bizExpenses
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date < ? AND ${COUNTED}
       GROUP BY 1`,
    )
    .all(`${start}-01`, `${addMonths(endMonth, 1)}-01`) as unknown as Omit<MonthPoint, 'net'>[];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: MonthPoint[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonths(start, i);
    const r = byMonth.get(month) ?? { month, income: 0, expenses: 0, bizIncome: 0, bizExpenses: 0 };
    out.push({ ...r, month, net: r.income - r.expenses });
  }
  return out;
}

// Months before `month` that actually have data, newest first, up to `n`.
function previousMonthsWithData(trend: MonthPoint[], month: string, n: number): MonthPoint[] {
  return trend
    .filter((p) => p.month < month && (p.income > 0 || p.expenses > 0))
    .slice(-n)
    .reverse();
}

// ---------- categories vs average ----------

export function categoryComparison(db: DB, month: string, scope?: 'private' | 'business'): CategoryCompare[] {
  const rows = db
    .prepare(
      `SELECT c.id AS categoryId, c.slug, c.name, c.grp, substr(t.date, 1, 7) AS month, -SUM(t.amount) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.kind = 'expense' AND t.date >= ? AND t.date < ? AND (? IS NULL OR t.scope = ?)
       GROUP BY c.id, month`,
    )
    .all(`${addMonths(month, -3)}-01`, `${addMonths(month, 1)}-01`, scope ?? null, scope ?? null) as { categoryId: number; slug: string | null; name: string; grp: string; month: string; total: number }[];
  const prevMonths = new Set(rows.filter((r) => r.month < month).map((r) => r.month));
  const divisor = Math.max(1, prevMonths.size);
  const map = new Map<number, CategoryCompare & { seen: number }>();
  for (const r of rows) {
    const e = map.get(r.categoryId) ?? { categoryId: r.categoryId, slug: r.slug, name: r.name, grp: r.grp, total: 0, avg: 0, deltaPct: null, steady: false, seen: 0 };
    if (r.month === month) e.total += r.total;
    else {
      e.avg += r.total / divisor;
      e.seen++;
    }
    map.set(r.categoryId, e);
  }
  return [...map.values()]
    .map(({ seen, ...e }) => ({ ...e, steady: seen === prevMonths.size, deltaPct: prevMonths.size && e.avg > 0 ? (e.total - e.avg) / e.avg : null }))
    .filter((e) => e.total > 0 || e.avg > 0)
    .sort((a, b) => b.total - a.total || b.avg - a.avg);
}

// ---------- recurring charges ----------

interface TxnRow {
  date: string;
  amount: number;
  description: string;
  categoryName: string | null;
  categorySlug: string | null;
  accountKind: string;
  installmentTotal: number | null;
  scope: 'private' | 'business' | null;
}

export function detectRecurring(db: DB, today: string): Recurring[] {
  const since = `${addMonths(today.slice(0, 7), -5)}-01`;
  const rows = db
    .prepare(
      `SELECT t.date, t.amount, t.description, c.name AS categoryName, c.slug AS categorySlug, a.kind AS accountKind,
         t.installment_total AS installmentTotal, t.scope
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND (c.kind IS NULL OR ${COUNTED})`,
    )
    .all(since, today) as unknown as TxnRow[];

  const groups = new Map<string, TxnRow[]>();
  for (const r of rows) {
    if (r.installmentTotal && r.installmentTotal > 1) continue; // shown as installments instead
    const key = `${r.amount < 0 ? 'out' : 'in'}:${merchantKey(r.description)}`;
    if (key.endsWith(':')) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: Recurring[] = [];
  const thisMonth = today.slice(0, 7);
  const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  for (const [key, list] of groups) {
    const months = [...new Set(list.map((r) => r.date.slice(0, 7)))].sort();
    if (months.length < 3) continue;
    if (list.length / months.length > 1.5) continue; // weekly shopping, not a fixed charge
    // Monthly or bi-monthly (arnona, electricity and VAT are often every two months).
    const gaps = months.slice(1).map((m, i) => monthIndex(m) - monthIndex(months[i]));
    const period = median(gaps) >= 1.5 ? 2 : 1;
    if (gaps.filter((g) => g !== period).length > 1) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = list.map((r) => Math.abs(r.amount));
    const mean = amounts.reduce((sum, x) => sum + x, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((sum, x) => sum + (x - mean) ** 2, 0) / amounts.length);
    const cv = mean ? sd / mean : 1;
    const last = list[list.length - 1];
    const isBill = BILL_SLUGS.has(last.categorySlug ?? '');
    if (isBill && last.amount < 0) {
      if (cv > 0.35) continue; // utility bills vary, within reason
    } else {
      // Subscriptions and allowances charge the same amount, allowing one
      // price change. Fuel or pharmacy visits once a month don't qualify.
      const rounded = list.map((r) => Math.round(Math.abs(r.amount)));
      const changes = rounded.slice(1).filter((x, i) => x !== rounded[i]).length;
      if (changes > 1) continue;
    }
    // Skip charges that seem to have stopped.
    if (monthIndex(last.date.slice(0, 7)) < monthIndex(thisMonth) - period) continue;
    const typical = median(amounts);
    const base = median(list.slice(0, -1).map((r) => Math.abs(r.amount)));
    const change = base > 0 ? (Math.abs(last.amount) - base) / base : 0;
    const sign = last.amount < 0 ? -1 : 1;
    const step = (date: string) => (period === 2 ? addOneMonthToDate(addOneMonthToDate(date)) : addOneMonthToDate(date));
    let next = step(last.date);
    while (next <= today) next = step(next);
    out.push({
      key,
      name: last.description,
      categoryName: last.categoryName,
      categorySlug: last.categorySlug,
      amount: sign * typical,
      periodMonths: period,
      monthsSeen: months.length,
      lastDate: last.date,
      nextDate: next,
      annual: (sign * typical * 12) / period,
      priceChangePct: !isBill && Math.abs(change) >= 0.08 ? change : null,
      isNew: months[0] >= addMonths(thisMonth, -3),
      isTax: TAX_SLUGS.has(last.categorySlug ?? ''),
      accountKind: last.accountKind,
      scope: last.scope,
    });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// ---------- spending pace ----------

export interface Pace {
  day: number;
  daysInMonth: number;
  spentToDate: number;
  avgToDate: number | null;
  avgFull: number | null;
  projected: number;
}

export function spendingPace(db: DB, month: string, today: string): Pace {
  const isCurrent = today.slice(0, 7) === month;
  const dim = daysInMonth(month);
  const day = isCurrent ? Number(today.slice(8, 10)) : dim;
  const spentThrough = (m: string, d: number) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(-t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
           WHERE t.amount < 0 AND ${COUNTED} AND c.grp <> 'מסים' AND t.date >= ? AND t.date <= ?`,
        )
        .get(`${m}-01`, `${m}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}`) as { s: number }
    ).s;
  const spentToDate = spentThrough(month, day);
  const prev = [1, 2, 3].map((i) => addMonths(month, -i)).filter((m) => spentThrough(m, 31) > 0);
  if (!prev.length) {
    return { day, daysInMonth: dim, spentToDate, avgToDate: null, avgFull: null, projected: isCurrent ? (spentToDate / day) * dim : spentToDate };
  }
  const avgToDate = prev.reduce((s, m) => s + spentThrough(m, day), 0) / prev.length;
  const avgFull = prev.reduce((s, m) => s + spentThrough(m, 31), 0) / prev.length;
  // What's typically left to spend after this day, added to what's spent so far.
  const projected = isCurrent ? spentToDate + Math.max(0, avgFull - avgToDate) : spentToDate;
  return { day, daysInMonth: dim, spentToDate, avgToDate, avgFull, projected };
}

export function dailySpending(db: DB, month: string): { date: string; total: number; count: number }[] {
  return db
    .prepare(
      `SELECT t.date, -SUM(t.amount) AS total, COUNT(*) AS count FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND ${COUNTED} AND t.date >= ? AND t.date < ? GROUP BY t.date ORDER BY t.date`,
    )
    .all(`${month}-01`, `${addMonths(month, 1)}-01`) as { date: string; total: number; count: number }[];
}

export function topMerchants(db: DB, month: string, n = 6): { name: string; total: number; count: number }[] {
  const rows = db
    .prepare(
      `SELECT t.description, -t.amount AS amount FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND c.kind = 'expense' AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'housing', 'loans') AND t.date >= ? AND t.date < ?`,
    )
    .all(`${month}-01`, `${addMonths(month, 1)}-01`) as { description: string; amount: number }[];
  const map = new Map<string, { name: string; total: number; count: number }>();
  for (const r of rows) {
    const k = merchantKey(r.description) || r.description;
    const e = map.get(k) ?? { name: r.description, total: 0, count: 0 };
    e.total += r.amount;
    e.count++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

// ---------- balances & forecast ----------

export function bankBalance(db: DB): number | null {
  const r = db.prepare("SELECT COUNT(balance) AS n, SUM(balance) AS s FROM accounts WHERE kind = 'bank'").get() as { n: number; s: number | null };
  return r.n ? (r.s ?? 0) : null;
}

// Card purchases already made but not yet charged to the bank.
export function upcomingCardCharges(db: DB, today: string, until?: string): { date: string; amount: number }[] {
  return db
    .prepare(
      `SELECT t.processed_date AS date, SUM(t.amount) AS amount
       FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
       WHERE a.kind = 'card' AND t.processed_date > ? AND (? IS NULL OR t.processed_date <= ?) AND ${COUNTED}
       GROUP BY t.processed_date ORDER BY t.processed_date`,
    )
    .all(today, until ?? null, until ?? null) as { date: string; amount: number }[];
}

export function forecast(db: DB, today: string, recurring: Recurring[], days = 60): Forecast | null {
  const start = bankBalance(db);
  if (start === null) return null;

  const since = addDays(today, -90);
  const recurringKeys = new Set(recurring.map((r) => r.key));
  const rows = db
    .prepare(
      `SELECT t.amount, t.description, a.kind AS accountKind, t.installment_total AS installmentTotal
       FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
       WHERE t.date > ? AND t.date <= ? AND ${COUNTED}`,
    )
    .all(since, today) as { amount: number; description: string; accountKind: string; installmentTotal: number | null }[];
  let variableOut = 0;
  let irregularIn = 0;
  for (const r of rows) {
    const key = `${r.amount < 0 ? 'out' : 'in'}:${merchantKey(r.description)}`;
    if (recurringKeys.has(key) || (r.installmentTotal ?? 0) > 1) continue;
    if (r.amount < 0) variableOut += -r.amount;
    else if (r.accountKind === 'bank') irregularIn += r.amount;
  }
  const dailyOut = variableOut / 90;
  const dailyIn = irregularIn / 90;

  const events = new Map<string, number>();
  const add = (date: string, amount: number) => events.set(date, (events.get(date) ?? 0) + amount);
  const horizon = addDays(today, days);
  const cardAhead = upcomingCardCharges(db, today, horizon);
  cardAhead.forEach((c) => add(c.date, c.amount));
  for (const r of recurring) {
    for (let d = r.nextDate; d <= horizon; d = r.periodMonths === 2 ? addOneMonthToDate(addOneMonthToDate(d)) : addOneMonthToDate(d)) add(d, r.amount);
  }

  const points: ForecastPoint[] = [{ date: today, balance: round(start) }];
  let bal = start;
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    bal += dailyIn - dailyOut + (events.get(date) ?? 0);
    points.push({ date, balance: round(bal) });
  }
  const low = points.reduce((m, p) => (p.balance < m.balance ? p : m), points[0]);
  return {
    start: round(start),
    points,
    low,
    firstNegative: points.find((p) => p.balance < 0)?.date ?? null,
    assumptions: {
      dailyVariableSpend: round(dailyOut),
      dailyIrregularIncome: round(dailyIn),
      cardChargesAhead: round(-cardAhead.reduce((s, c) => s + c.amount, 0)),
      recurringItems: recurring.length,
    },
  };
}

// ---------- business ----------

export interface BusinessView {
  hasBusiness: boolean;
  income: number;
  expenses: number;
  avgIncome: number | null;
  vatOnSales: number;
  vatOnPurchases: number;
  vatEstimate: number;
  topSources: { name: string; total: number; share: number }[];
}

export function businessView(db: DB, month: string, trend: MonthPoint[]): BusinessView {
  const hasBusiness = !!db.prepare("SELECT 1 FROM accounts WHERE default_scope = 'business' LIMIT 1").get();
  const cur = trend.find((p) => p.month === month);
  const prev = previousMonthsWithData(trend, month, 3).filter((p) => p.bizIncome > 0);
  const deductible = (
    db
      .prepare(
        `SELECT COALESCE(SUM(-t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.scope = 'business' AND t.amount < 0 AND c.kind = 'expense'
           AND c.slug NOT IN ('vat', 'income_tax', 'bituach_leumi', 'biz_fees', 'pension', 'savings', 'loans', 'interest')
           AND t.date >= ? AND t.date < ?`,
      )
      .get(`${month}-01`, `${addMonths(month, 1)}-01`) as { s: number }
  ).s;
  const income = cur?.bizIncome ?? 0;
  // Prices include VAT, so the VAT part of a gross amount is amount × 18/118.
  const vatOnSales = (income * VAT_RATE) / (1 + VAT_RATE);
  const vatOnPurchases = (deductible * VAT_RATE) / (1 + VAT_RATE);

  const srcRows = db
    .prepare(
      `SELECT t.description, t.amount FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.scope = 'business' AND t.amount > 0 AND ${COUNTED} AND t.date >= ? AND t.date < ?`,
    )
    .all(`${addMonths(month, -2)}-01`, `${addMonths(month, 1)}-01`) as { description: string; amount: number }[];
  const src = new Map<string, { name: string; total: number }>();
  for (const r of srcRows) {
    const k = merchantKey(r.description) || r.description;
    const e = src.get(k) ?? { name: r.description, total: 0 };
    e.total += r.amount;
    src.set(k, e);
  }
  const srcTotal = [...src.values()].reduce((s, e) => s + e.total, 0);
  return {
    hasBusiness,
    income,
    expenses: cur?.bizExpenses ?? 0,
    avgIncome: prev.length ? prev.reduce((s, p) => s + p.bizIncome, 0) / prev.length : null,
    vatOnSales: round(vatOnSales),
    vatOnPurchases: round(vatOnPurchases),
    vatEstimate: round(Math.max(0, vatOnSales - vatOnPurchases)),
    topSources: [...src.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((e) => ({ ...e, share: srcTotal ? e.total / srcTotal : 0 })),
  };
}

// ---------- health score ----------

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + ((clamp(x, Math.min(x0, x1), Math.max(x0, x1)) - x0) / (x1 - x0)) * (y1 - y0);

export function healthScore(
  db: DB,
  month: string,
  trend: MonthPoint[],
  balance: number | null,
  installmentsAhead: number,
  completeEnd: string,
): { score: number; label: string; parts: HealthPart[] } | null {
  // A month still in progress would understate income and expenses.
  const recent = previousMonthsWithData(trend, completeEnd, 3);
  if (!recent.length) return null;
  const income = recent.reduce((s, p) => s + p.income, 0) / recent.length;
  const expenses = recent.reduce((s, p) => s + p.expenses, 0) / recent.length;
  const parts: HealthPart[] = [];

  const rate = income > 0 ? (income - expenses) / income : -1;
  parts.push({
    key: 'savings',
    label: 'שיעור חיסכון',
    score: round(rate >= 0 ? lerp(rate, 0, 0.2, 45, 100) : lerp(rate, -0.25, 0, 0, 45)),
    detail: income > 0 ? `${pct(rate)}% מההכנסה נשאר בממוצע ב-${recent.length} החודשים האחרונים` : 'אין עדיין הכנסות במערכת',
  });

  if (balance !== null && expenses > 0) {
    const months = balance / expenses;
    parts.push({
      key: 'buffer',
      label: 'כרית ביטחון',
      score: round(months <= 0 ? lerp(months, -1, 0, 0, 15) : lerp(months, 0, 3, 15, 100)),
      detail: months > 0 ? `היתרה בבנק מכסה כ-${months.toFixed(1)} חודשי הוצאות` : 'היתרה בבנק נמוכה מהוצאות חודש',
    });
  }

  if (income > 0) {
    const load = installmentsAhead / income;
    parts.push({
      key: 'installments',
      label: 'תשלומים פתוחים',
      score: round(lerp(load, 0, 1, 100, 20)),
      detail: installmentsAhead > 0 ? `תשלומים עתידיים בגובה ${pct(load)}% מהכנסה חודשית` : 'אין עסקאות בתשלומים פתוחות',
    });
  }

  const withIncome = previousMonthsWithData(trend, completeEnd, 6).filter((p) => p.income > 0);
  if (withIncome.length >= 3) {
    const m = withIncome.reduce((s, p) => s + p.income, 0) / withIncome.length;
    const cv = Math.sqrt(withIncome.reduce((s, p) => s + (p.income - m) ** 2, 0) / withIncome.length) / m;
    parts.push({
      key: 'stability',
      label: 'יציבות הכנסה',
      score: round(lerp(cv, 0.1, 0.6, 100, 30)),
      detail: cv < 0.2 ? 'ההכנסה יציבה מחודש לחודש' : `ההכנסה משתנה בכ-${pct(cv)}% בין חודשים`,
    });
  }

  const cat = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN c.slug = 'uncategorized' THEN 1 ELSE 0 END) AS u
       FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.date >= ?`,
    )
    .get(`${addMonths(month, -2)}-01`) as { n: number; u: number | null };
  if (cat.n) {
    const share = 1 - (cat.u ?? 0) / cat.n;
    parts.push({ key: 'clarity', label: 'בהירות', score: round(lerp(share, 0.6, 1, 30, 100)), detail: `${pct(share)}% מהתנועות מסווגות` });
  }

  const weights: Record<string, number> = { savings: 3, buffer: 3, installments: 1.5, stability: 1.5, clarity: 1 };
  const totalW = parts.reduce((s, p) => s + weights[p.key], 0);
  const score = round(parts.reduce((s, p) => s + p.score * weights[p.key], 0) / totalW);
  const label = score >= 75 ? 'יציב וחזק' : score >= 55 ? 'בדרך הנכונה' : score >= 35 ? 'בבנייה' : 'זמן לתוכנית';
  return { score, label, parts };
}

// ---------- funds & safe-to-spend ----------

export interface FundView {
  id: number;
  name: string;
  icon: string | null;
  annualAmount: number;
  monthly: number;
  dueMonth: number | null;
  nextDue: string | null;
  categoryId: number | null;
  categoryName: string | null;
  spentLast12: number;
  spentThisYear: number;
}

export function listFunds(db: DB, today: string): FundView[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.icon, f.annual_amount AS annualAmount, f.due_month AS dueMonth, f.category_id AS categoryId, c.name AS categoryName
       FROM funds f LEFT JOIN categories c ON c.id = f.category_id ORDER BY f.sort, f.id`,
    )
    .all() as unknown as Omit<FundView, 'monthly' | 'nextDue' | 'spentLast12' | 'spentThisYear'>[];
  const spent = db.prepare(
    `SELECT COALESCE(SUM(-amount), 0) AS s FROM transactions WHERE category_id = ? AND date >= ? AND date <= ?`,
  );
  const year = today.slice(0, 4);
  const month = Number(today.slice(5, 7));
  return rows.map((f) => {
    let nextDue: string | null = null;
    if (f.dueMonth) {
      const y = f.dueMonth >= month ? Number(year) : Number(year) + 1;
      nextDue = `${y}-${String(f.dueMonth).padStart(2, '0')}`;
    }
    return {
      ...f,
      monthly: round(f.annualAmount / 12),
      nextDue,
      spentLast12: f.categoryId ? round((spent.get(f.categoryId, addDays(today, -365), today) as { s: number }).s) : 0,
      spentThisYear: f.categoryId ? round((spent.get(f.categoryId, `${year}-01-01`, today) as { s: number }).s) : 0,
    };
  });
}

// Suggested funds, prefilled with what the user actually spent last year.
export function fundSuggestions(db: DB, today: string): { name: string; icon: string; slug: string; categoryId: number | null; lastYear: number }[] {
  const base: { name: string; icon: string; slug: string }[] = [
    { name: 'ארנונה', icon: '🏠', slug: 'arnona' },
    { name: 'חגים', icon: '🕎', slug: 'holidays' },
    { name: 'שמחות ומתנות', icon: '🎁', slug: 'celebrations' },
    { name: 'שיניים', icon: '🦷', slug: 'dental' },
    { name: 'ביגוד והנעלה', icon: '👕', slug: 'clothing' },
    { name: 'חופשה', icon: '🌄', slug: 'vacation' },
    { name: 'רכב: טסט, ביטוח, טיפולים', icon: '🚗', slug: 'car' },
    { name: 'תיקונים בבית', icon: '🔧', slug: 'home_repairs' },
  ];
  const rows = db.prepare('SELECT name, category_id FROM funds').all() as { name: string; category_id: number | null }[];
  const existing = new Set(rows.map((r) => r.category_id).filter((x) => x !== null));
  const names = new Set(rows.map((r) => r.name.trim()));
  const cat = db.prepare('SELECT id FROM categories WHERE slug = ?');
  const spent = db.prepare('SELECT COALESCE(SUM(-amount), 0) AS s FROM transactions WHERE category_id = ? AND date >= ?');
  return base
    .map((b) => {
      const id = (cat.get(b.slug) as { id: number } | undefined)?.id ?? null;
      return { ...b, categoryId: id, lastYear: id ? round((spent.get(id, addDays(today, -365)) as { s: number }).s) : 0 };
    })
    .filter((b) => !names.has(b.name) && (!b.categoryId || !existing.has(b.categoryId)));
}

export interface SafeToSpend {
  perDay: number;
  daysLeft: number;
  available: number;
  parts: { label: string; amount: number }[];
  nextCardCharge: { date: string; amount: number } | null;
}

export function safeToSpend(
  db: DB,
  today: string,
  recurring: Recurring[],
  funds: FundView[],
): SafeToSpend | null {
  // Personal money only: the business account has its own obligations (VAT,
  // Bituach Leumi) and reaches home as owner pay.
  const row = db
    .prepare("SELECT COUNT(balance) AS n, SUM(balance) AS s FROM accounts WHERE kind = 'bank' AND default_scope = 'private'")
    .get() as { n: number; s: number | null };
  const balance = row.n ? (row.s ?? 0) : bankBalance(db);
  if (balance === null) return null;
  const month = today.slice(0, 7);
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10)) + 1;
  const personal = (r: Recurring) => r.accountKind === 'bank' && r.scope !== 'business' && r.nextDate <= monthEnd;
  const card = upcomingCardCharges(db, today, monthEnd).reduce((s, c) => s + c.amount, 0);
  const fixed = recurring.filter((r) => r.amount < 0 && personal(r)).reduce((s, r) => s + r.amount, 0);
  const income = recurring.filter((r) => r.amount > 0 && personal(r)).reduce((s, r) => s + r.amount, 0);
  const fundsMonthly = funds.reduce((s, f) => s + f.monthly, 0);
  const parts = [
    { label: 'יתרה בחשבון הבית', amount: round(balance) },
    { label: 'הכנסות קבועות שעוד ייכנסו החודש', amount: round(income) },
    { label: 'חיובי אשראי עד סוף החודש', amount: round(card) },
    { label: 'חיובים קבועים שעוד יירדו החודש', amount: round(fixed) },
    { label: 'הפרשה לקופות החודש', amount: -round(fundsMonthly) },
  ].filter((p, i) => i === 0 || p.amount !== 0);
  const available = parts.reduce((s, p) => s + p.amount, 0);
  const nextCard = upcomingCardCharges(db, monthEnd)[0];
  return {
    perDay: round(Math.max(0, available) / daysLeft),
    daysLeft,
    available: round(available),
    parts,
    nextCardCharge: nextCard ? { date: nextCard.date, amount: round(-upcomingCardCharges(db, monthEnd).filter((c) => c.date === nextCard.date).reduce((s, c) => s + c.amount, 0)) } : null,
  };
}

// ---------- plain-language insights ----------

const ils = (n: number) => `₪${Math.round(Math.abs(n)).toLocaleString('he-IL')}`;

export function buildInsights(args: {
  month: string;
  isCurrent: boolean;
  trend: MonthPoint[];
  categories: CategoryCompare[];
  recurring: Recurring[];
  pace: Pace;
  forecast: Forecast | null;
  business: BusinessView;
  merchants: { name: string; total: number; count: number }[];
  uncategorized: number;
  completeEnd: string;
  funds: FundView[];
}): Insight[] {
  const out: Insight[] = [];
  const { month, trend, categories, recurring, pace, forecast: fc, business, merchants } = args;

  if (fc?.firstNegative) {
    const d = fc.firstNegative.split('-');
    out.push({
      tone: 'attention',
      icon: '🧭',
      title: `לפי התחזית, היתרה עלולה לרדת מתחת לאפס בסביבות ${d[2]}/${d[1]}`,
      body: 'זו הערכה לפי הקצב הרגיל שלך. עכשיו, כשרואים את זה מראש, יש זמן לפעול: להקדים גבייה מלקוח, לדחות הוצאה גדולה או לפרוס תשלום.',
      link: { page: 'dashboard' },
    });
  } else if (fc && fc.points.length > 1) {
    out.push({
      tone: 'good',
      icon: '🌤️',
      title: 'התחזית ל-60 הימים הקרובים בלי מינוס',
      body: `הנקודה הנמוכה הצפויה היא ${ils(fc.low.balance)}. ההשתדלות שלך עובדת.`,
    });
  }

  if (args.isCurrent && pace.avgFull) {
    const diff = pace.projected - pace.avgFull;
    if (Math.abs(diff) / pace.avgFull >= 0.08) {
      out.push({
        tone: diff > 0 ? 'attention' : 'good',
        icon: diff > 0 ? '📈' : '📉',
        title: diff > 0 ? `בקצב הנוכחי, החודש יסתיים בכ-${ils(diff)} יותר מהרגיל` : `בקצב הנוכחי, החודש יסתיים בכ-${ils(diff)} פחות מהרגיל`,
        body: `עד היום יצאו ${ils(pace.spentToDate)}. חודש רגיל אצלך עד היום הזה: ${ils(pace.avgToDate ?? 0)}.`,
      });
    }
  }

  const lumpy = (c: CategoryCompare) => LUMPY_GROUPS.has(c.grp) || LUMPY_SLUGS.has(c.slug ?? '');
  // Only categories with spending every month have a meaningful "usual".
  const steady = categories.filter((c) => !lumpy(c) && c.steady);
  const spikes = steady.filter((c) => c.deltaPct !== null && c.deltaPct > 0.3 && c.total - c.avg > 200).sort((a, b) => b.total - b.avg - (a.total - a.avg));
  for (const c of spikes.slice(0, 2)) {
    out.push({
      tone: 'attention',
      icon: '🔎',
      title: `${c.name}: ${pct(c.deltaPct!)}% מעל הממוצע`,
      body: `החודש ${ils(c.total)}, לעומת ${ils(c.avg)} בחודש רגיל. אולי הוצאה חד-פעמית, ואולי שווה הצצה.`,
      link: { page: 'transactions', params: { month, categoryId: String(c.categoryId) } },
    });
  }
  const drops = steady.filter((c) => c.deltaPct !== null && c.deltaPct < -0.25 && c.avg - c.total > 200);
  if (drops[0]) {
    out.push({
      tone: 'good',
      icon: '🌱',
      title: `${drops[0].name}: ${pct(-drops[0].deltaPct!)}% פחות מהרגיל`,
      body: `החודש ${ils(drops[0].total)} לעומת ${ils(drops[0].avg)} בממוצע.`,
    });
  }

  const fundCats = new Set(args.funds.map((f) => f.categoryId));
  const unplanned = categories.filter((c) => LUMPY_GROUPS.has(c.grp) || LUMPY_SLUGS.has(c.slug ?? '')).filter((c) => c.grp !== 'מסים' && c.total >= 300 && !fundCats.has(c.categoryId));
  if (unplanned[0]) {
    out.push({
      tone: 'neutral',
      icon: '🏺',
      title: `${unplanned[0].name}: ${ils(unplanned[0].total)} החודש`,
      body: 'הוצאה שחוזרת פעם בכמה חודשים. קופה קטנה כל חודש הופכת אותה מ"הפתעה" ל"מתוכנן".',
      link: { page: 'funds' },
    });
  }

  const subs = recurring.filter((r) => r.amount < 0 && !r.isTax && r.scope !== 'business');
  if (subs.length) {
    const monthly = subs.reduce((s, r) => s - r.amount / r.periodMonths, 0);
    out.push({
      tone: 'neutral',
      icon: '🔁',
      title: `${subs.length} חיובים קבועים: ${ils(monthly)} בחודש`,
      body: `זה ${ils(monthly * 12)} בשנה. מעבר של 10 דקות על הרשימה פעם ברבעון חוסך לרוב כסף אמיתי.`,
      link: { page: 'insights' },
    });
  }
  for (const r of recurring.filter((r) => r.amount < 0 && r.scope !== 'business' && r.priceChangePct && r.priceChangePct > 0).slice(0, 2)) {
    out.push({
      tone: 'attention',
      icon: '🏷️',
      title: `${r.name} התייקר ב-${pct(r.priceChangePct!)}%`,
      body: `החיוב האחרון היה ${ils(r.amount * (1 + r.priceChangePct!))} במקום כ-${ils(r.amount)}. אפשר לבדוק אם זה מוצדק.`,
    });
  }

  const recent = previousMonthsWithData(trend, args.completeEnd, 3);
  if (recent.length >= 2) {
    const inc = recent.reduce((s, p) => s + p.income, 0);
    const exp = recent.reduce((s, p) => s + p.expenses, 0);
    if (inc > 0) {
      const rate = (inc - exp) / inc;
      out.push({
        tone: rate >= 0.1 ? 'good' : rate >= 0 ? 'neutral' : 'attention',
        icon: rate >= 0 ? '🏺' : '🧩',
        title: rate >= 0 ? `נשאר לך ${pct(rate)}% מההכנסה ב-${recent.length} החודשים האחרונים` : `ב-${recent.length} החודשים האחרונים יצא ${pct(-rate)}% יותר ממה שנכנס`,
        body:
          rate >= 0.1
            ? 'זה הבסיס לבניית נכסים. השלב הבא: להפנות חלק קבוע ממנו לחיסכון או להשקעה מיד כשההכנסה נכנסת.'
            : rate >= 0
              ? 'יש איזון. היעד הבא: 10% שנשארים כל חודש, "שלם לעצמך קודם".'
              : 'זה מידע, לא שיפוט. הצעד הראשון הוא לראות איפה הפער, והגרפים למטה מראים בדיוק את זה.',
      });
    }
  }

  if (merchants[0] && merchants[0].count >= 3) {
    out.push({
      tone: 'neutral',
      icon: '🛒',
      title: `הכי הרבה הלך ל${merchants[0].name}`,
      body: `${ils(merchants[0].total)} ב-${merchants[0].count} עסקאות החודש.`,
    });
  }

  if (args.uncategorized > 0) {
    out.push({
      tone: 'neutral',
      icon: '🏷️',
      title: `${args.uncategorized} תנועות מחכות לסיווג`,
      body: 'דקה של סיווג, והתובנות נעשות מדויקות יותר.',
      link: { page: 'transactions', params: { month, uncategorized: '1' } },
    });
  }

  const order = { attention: 0, good: 1, neutral: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
