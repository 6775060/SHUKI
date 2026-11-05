import { getMeta, setMeta, type DB } from './db.js';
import { addMonths } from './insights.js';
import { incomeMix } from './profile.js';
import { savingsView } from './savings.js';

// Three steady habits of a calm household: a short weekly look back, tithing
// that keeps pace with what actually came in, and a cushion for a weak month.

const VAT = 0.18;
const round = (n: number) => Math.round(n);

// ---------- the week that ended on Shabbat ----------

export interface WeekNumbers {
  key: string; // the Shabbat that closed the week, YYYY-MM-DD
  from: string;
  to: string;
  income: number;
  expenses: number;
  salary: number;
  business: number;
  topCategories: { name: string; total: number }[];
  biggest: { description: string; amount: number; date: string } | null;
  vsUsual: number | null; // expenses against the average week of the last 8
}

// The most recent Shabbat on or before today (Saturday).
export function lastShabbat(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  return d.toISOString().slice(0, 10);
}

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function weekNumbers(db: DB, today: string): WeekNumbers {
  const to = lastShabbat(today);
  const from = plusDays(to, -6);
  const sum = (where: string, a: string, b: string) =>
    (db
      .prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.kind <> 'transfer' AND t.date BETWEEN ? AND ? AND ${where}`)
      .get(a, b) as { s: number }).s;
  const income = sum('t.amount > 0', from, to);
  const expenses = -sum('t.amount < 0', from, to);
  const salary = sum("t.amount > 0 AND c.slug = 'income_salary'", from, to);
  const business = sum("t.amount > 0 AND t.scope = 'business' AND c.slug <> 'income_salary'", from, to);
  const topCategories = (
    db
      .prepare(
        `SELECT c.name, -SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.amount < 0 AND c.kind = 'expense' AND t.scope <> 'business' AND t.date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 3`,
      )
      .all(from, to) as { name: string; total: number }[]
  ).map((r) => ({ name: r.name, total: round(r.total) }));
  const biggest = db
    .prepare(
      `SELECT t.description, -t.amount AS amount, t.date FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND c.kind = 'expense' AND t.date BETWEEN ? AND ? ORDER BY t.amount LIMIT 1`,
    )
    .get(from, to) as { description: string; amount: number; date: string } | undefined;
  const past = -sum('t.amount < 0', plusDays(from, -56), plusDays(from, -1)) / 8;
  return {
    key: to,
    from,
    to,
    income: round(income),
    expenses: round(expenses),
    salary: round(salary),
    business: round(business),
    topCategories,
    biggest: biggest ? { ...biggest, amount: round(biggest.amount) } : null,
    vsUsual: past > 0 ? expenses / past - 1 : null,
  };
}

// ---------- maaser ----------

export interface MaaserSettings {
  pct: number; // 10, or 20 for chomesh
  base: 'all' | 'net'; // all income, or after VAT and business expenses
  carry: number; // owed (+) or given ahead (−) from before this year
}

export interface MaaserView extends MaaserSettings {
  year: number;
  baseAmount: number;
  owed: number;
  given: number;
  balance: number; // still to give (+) or given ahead (−)
  thisMonth: { baseAmount: number; owed: number; given: number };
}

export function maaserSettings(db: DB): MaaserSettings {
  const raw = getMeta(db, 'maaser');
  return raw ? (JSON.parse(raw) as MaaserSettings) : { pct: 10, base: 'net', carry: 0 };
}

export function saveMaaserSettings(db: DB, s: MaaserSettings): void {
  setMeta(db, 'maaser', JSON.stringify({ pct: s.pct, base: s.base, carry: s.carry }));
}

function maaserBase(db: DB, from: string, to: string, base: MaaserSettings['base']): number {
  const q = (where: string) =>
    (db
      .prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.kind <> 'transfer' AND t.date >= ? AND t.date < ? AND ${where}`)
      .get(from, to) as { s: number }).s;
  const privateIn = q("t.amount > 0 AND t.scope <> 'business'");
  const bizIn = q("t.amount > 0 AND t.scope = 'business'");
  if (base === 'all') return privateIn + bizIn;
  // Business profit: income without the VAT in it, less business expenses (taxes included).
  const bizOut = -q("t.amount < 0 AND t.scope = 'business' AND c.slug <> 'vat'");
  return privateIn + Math.max(0, bizIn / (1 + VAT) - bizOut);
}

export function maaserView(db: DB, today: string): MaaserView {
  const s = maaserSettings(db);
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const given = (from: string, to: string) =>
    -(db
      .prepare("SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.slug = 'charity' AND t.amount < 0 AND t.date >= ? AND t.date < ?")
      .get(from, to) as { s: number }).s;
  const yFrom = `${year}-01-01`;
  const end = `${addMonths(month, 1)}-01`;
  const baseAmount = maaserBase(db, yFrom, end, s.base);
  const owed = (baseAmount * s.pct) / 100;
  const g = given(yFrom, end);
  const mBase = maaserBase(db, `${month}-01`, end, s.base);
  return {
    ...s,
    year,
    baseAmount: round(baseAmount),
    owed: round(owed),
    given: round(g),
    balance: round(owed + s.carry - g),
    thisMonth: { baseAmount: round(mBase), owed: round((mBase * s.pct) / 100), given: round(given(`${month}-01`, end)) },
  };
}

// ---------- a cushion for a weak month ----------

export interface CushionView {
  monthlyExpenses: number;
  steadyIncome: number; // salary in an average month
  weakBusiness: number; // the weakest business month of the last six
  weakGap: number; // what a weak month leaves uncovered
  months: number; // how many weak months the cushion should carry
  target: number;
  saved: number;
  savedSource: 'manual' | 'savings' | 'none';
  pct: number;
  monthlyStep: number; // to reach it within a year
}

export function cushionView(db: DB, today: string): CushionView {
  const month = today.slice(0, 7);
  const months = Number(getMeta(db, 'cushion_months') ?? 3);
  const done = incomeMix(db, month, 7).filter((m) => m.month < month);
  const withData = done.filter((m) => m.salary || m.business || m.other);
  const exp = (db
    .prepare(
      `SELECT COALESCE(SUM(-t.amount), 0) / 6.0 AS s FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount < 0 AND c.kind <> 'transfer' AND t.scope <> 'business' AND t.date >= ? AND t.date < ?`,
    )
    .get(`${addMonths(month, -6)}-01`, `${month}-01`) as { s: number }).s;
  const salary = withData.length ? withData.reduce((s, m) => s + m.salary, 0) / withData.length : 0;
  const biz = withData.map((m) => m.business).filter((b) => b > 0);
  const weakBusiness = biz.length ? Math.min(...biz) : 0;
  // What the business pays home in a weak month: its weak income less VAT and expenses, roughly.
  const bizShare = weakBusiness / (1 + VAT) * 0.75;
  const weakGap = Math.max(0, exp - salary - bizShare);
  const target = round(Math.max(weakGap * months, exp));
  const manual = getMeta(db, 'cushion_saved');
  let saved = 0;
  let savedSource: CushionView['savedSource'] = 'none';
  if (manual !== undefined) {
    saved = Number(manual);
    savedSource = 'manual';
  } else {
    try {
      const sv = savingsView(db, today);
      saved = sv.accounts.filter((a) => a.product === 'savings' && a.status === 'active').reduce((s, a) => s + a.balance, 0);
      if (saved > 0) savedSource = 'savings';
    } catch {
      /* no savings data */
    }
  }
  return {
    monthlyExpenses: round(exp),
    steadyIncome: round(salary),
    weakBusiness: round(weakBusiness),
    weakGap: round(weakGap),
    months,
    target,
    saved: round(saved),
    savedSource,
    pct: target > 0 ? Math.min(1, saved / target) : 1,
    monthlyStep: round(Math.max(0, target - saved) / 12),
  };
}
