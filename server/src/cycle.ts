import type { DB } from './db.js';
import { getMeta } from './db.js';
import { addMonths, merchantKey, type FundView, type Recurring } from './insights.js';
import { futureInstallments } from './stats.js';

// The home cash-flow cycle. For a self-employed person the month really starts
// when owner pay lands in the home account, not on the 1st. Inside a cycle:
// expected income − fixed commitments − installments − fund set-asides leaves
// a variable budget, handed out week by week (Sunday–Saturday). Spending paid
// from a fund, fixed charges and installments don't touch the weekly budget.

const round = (n: number) => Math.round(n);

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

function dateIn(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface CycleSettings {
  startDay: number;
  startDayDetected: number;
  startDayIsAuto: boolean;
  weeklyJoy: number;
}

// The day the biggest money of the month reaches the home account.
export function detectStartDay(db: DB, today: string): number {
  const rows = db
    .prepare(
      `SELECT t.date, t.amount FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.kind = 'bank' AND a.default_scope = 'private' AND t.amount >= 1000 AND t.date >= ?`,
    )
    .all(`${addMonths(today.slice(0, 7), -4)}-01`) as { date: string; amount: number }[];
  const biggest = new Map<string, { date: string; amount: number }>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (!biggest.has(m) || biggest.get(m)!.amount < r.amount) biggest.set(m, r);
  }
  if (biggest.size < 2) return 1;
  return Math.min(28, Math.max(1, Math.round(median([...biggest.values()].map((r) => Number(r.date.slice(8, 10)))))));
}

export function cycleSettings(db: DB, today: string): CycleSettings {
  const detected = detectStartDay(db, today);
  const manual = Number(getMeta(db, 'cycle_start_day') ?? 0);
  const joy = getMeta(db, 'weekly_joy');
  return {
    startDay: manual || detected,
    startDayDetected: detected,
    startDayIsAuto: !manual,
    weeklyJoy: joy === undefined ? 70 : Number(joy),
  };
}

export function cycleBounds(today: string, startDay: number): { start: string; end: string } {
  const month = today.slice(0, 7);
  let start = dateIn(month, startDay);
  if (start > today) start = dateIn(addMonths(month, -1), startDay);
  const end = addDays(dateIn(addMonths(start.slice(0, 7), 1), startDay), -1);
  return { start, end };
}

// ---------- the cycle view ----------

export interface CycleView {
  start: string;
  end: string;
  day: number;
  days: number;
  income: { expected: number; received: number; basis: 'history' | 'received' | 'none' };
  fixed: { monthly: number; items: { name: string; amount: number }[] };
  installments: number;
  funds: number;
  joy: number;
  variableBudget: number;
  variableSpent: number;
  projectedVariable: number;
  forecastEnd: number;
  week: {
    start: string;
    end: string;
    budget: number;
    spent: number;
    left: number;
    joy: number;
    daysLeft: number;
  };
  settings: CycleSettings;
}

export function cycleView(db: DB, today: string, recurring: Recurring[], funds: FundView[]): CycleView {
  const settings = cycleSettings(db, today);
  const { start, end } = cycleBounds(today, settings.startDay);
  const days = daysBetween(start, end) + 1;
  const day = daysBetween(start, today) + 1;

  // Income into the home account, per cycle. Owner pay from the business counts
  // here even though it's an internal transfer overall.
  const inflow = db.prepare(
    `SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.kind = 'bank' AND a.default_scope = 'private' AND t.amount > 0 AND t.date >= ? AND t.date <= ?`,
  );
  const received = (inflow.get(start, today) as { s: number }).s;
  const past: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const s = dateIn(addMonths(start.slice(0, 7), -i), settings.startDay);
    const e = addDays(dateIn(addMonths(start.slice(0, 7), -i + 1), settings.startDay), -1);
    const v = (inflow.get(s, e) as { s: number }).s;
    if (v > 0) past.push(v);
  }
  const typical = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
  const expected = Math.max(typical, received);
  const basis = typical > 0 ? 'history' : received > 0 ? 'received' : 'none';

  // Fixed: recurring personal charges, as a monthly amount.
  const fixedItems = recurring
    .filter((r) => r.amount < 0 && r.scope !== 'business' && !r.isTax)
    .map((r) => ({ name: r.name, amount: round(-r.amount / r.periodMonths) }));
  const fixedMonthly = fixedItems.reduce((s, r) => s + r.amount, 0);
  const inst = futureInstallments(db).series.reduce((s, r) => s + r.perPayment, 0);
  const fundsMonthly = funds.reduce((s, f) => s + f.monthly, 0);
  // Joy money is set aside first, like a fund, so it is there even in a tight
  // week – the moment the kid asks for a burekas is exactly when it matters.
  const joyMonthly = (settings.weeklyJoy * days) / 7;
  const variableBudget = Math.max(0, expected - fixedMonthly - inst - fundsMonthly - joyMonthly);

  // Variable spending: personal, not fixed, not installments, not from a fund.
  const fixedKeys = new Set(recurring.map((r) => r.key));
  const fundCats = new Set(funds.map((f) => f.categoryId).filter((x): x is number => x !== null));
  const spendRows = (from: string, to: string) =>
    (
      db
        .prepare(
          `SELECT t.date, t.amount, t.description, t.category_id AS categoryId, t.installment_total AS inst
           FROM transactions t JOIN categories c ON c.id = t.category_id
           WHERE t.scope = 'private' AND c.kind = 'expense' AND c.grp <> 'מסים' AND t.date >= ? AND t.date <= ?`,
        )
        .all(from, to) as { date: string; amount: number; description: string; categoryId: number; inst: number | null }[]
    ).filter((r) => (r.inst ?? 0) <= 1 && !fundCats.has(r.categoryId) && !fixedKeys.has(`${r.amount < 0 ? 'out' : 'in'}:${merchantKey(r.description)}`));
  const sumSpend = (rows: { amount: number }[]) => rows.reduce((s, r) => s - r.amount, 0);

  const cycleRows = spendRows(start, today);
  const variableSpent = sumSpend(cycleRows);
  const last90 = sumSpend(spendRows(addDays(today, -90), today)) / 90;
  const projectedVariable = variableSpent + last90 * (days - day);
  const forecastEnd = expected - fixedMonthly - inst - fundsMonthly - joyMonthly - projectedVariable;

  // This week: a fresh share of the variable budget every Sunday. Money left
  // unspent in earlier weeks rolls forward; an overspent week is not carried
  // as a debt (the cycle forecast already shows the whole picture).
  const weekStartRaw = addDays(today, -dayOfWeek(today));
  const weekStart = weekStartRaw < start ? start : weekStartRaw;
  const weekEndRaw = addDays(weekStartRaw, 6);
  const weekEnd = weekEndRaw > end ? end : weekEndRaw;
  const perDay = variableBudget / days;
  const budgetBeforeWeek = perDay * daysBetween(start, weekStart);
  const spentBeforeWeek = sumSpend(cycleRows.filter((r) => r.date < weekStart));
  const weekSpent = sumSpend(cycleRows.filter((r) => r.date >= weekStart));
  const weekBudget = perDay * (daysBetween(weekStart, weekEnd) + 1) + Math.max(0, budgetBeforeWeek - spentBeforeWeek);

  return {
    start,
    end,
    day,
    days,
    income: { expected: round(expected), received: round(received), basis },
    fixed: { monthly: round(fixedMonthly), items: fixedItems.sort((a, b) => b.amount - a.amount) },
    installments: round(inst),
    funds: round(fundsMonthly),
    joy: round(joyMonthly),
    variableBudget: round(variableBudget),
    variableSpent: round(variableSpent),
    projectedVariable: round(projectedVariable),
    forecastEnd: round(forecastEnd),
    week: {
      start: weekStart,
      end: weekEnd,
      budget: round(weekBudget),
      spent: round(weekSpent),
      left: round(weekBudget - weekSpent),
      joy: settings.weeklyJoy,
      daysLeft: daysBetween(today, weekEnd) + 1,
    },
    settings,
  };
}

// ---------- card bills ----------

export interface CardBill {
  accountId: number;
  label: string;
  nextDate: string | null;
  amount: number;
  chargeDay: number | null;
  daysUntil: number | null;
}

export function cardBills(db: DB, today: string): CardBill[] {
  const cards = db.prepare("SELECT id, label FROM accounts WHERE kind = 'card' ORDER BY label").all() as { id: number; label: string }[];
  return cards.map((c) => {
    const next = db
      .prepare(
        `SELECT t.processed_date AS date, SUM(t.amount) AS amount FROM transactions t
         WHERE t.account_id = ? AND t.processed_date > ? GROUP BY t.processed_date ORDER BY t.processed_date LIMIT 1`,
      )
      .get(c.id, today) as { date: string; amount: number } | undefined;
    const days = (
      db.prepare('SELECT DISTINCT processed_date AS d FROM transactions WHERE account_id = ? AND processed_date IS NOT NULL ORDER BY d DESC LIMIT 6').all(c.id) as { d: string }[]
    ).map((r) => Number(r.d.slice(8, 10)));
    return {
      accountId: c.id,
      label: c.label,
      nextDate: next?.date ?? null,
      amount: next ? round(-next.amount) : 0,
      chargeDay: days.length ? median(days) : null,
      daysUntil: next ? daysBetween(today, next.date) : null,
    };
  });
}

// ---------- owner pay (Profit First) ----------

export interface OwnerPay {
  sustainable: number | null;
  actualAvg: number | null;
  months: number;
  businessNetAvg: number | null;
}

// What the business can pay home every month without strain: the average
// business surplus over recent full months (after VAT, Bituach Leumi and
// expenses already left the account), keeping 10% back as a reserve.
export function ownerPay(db: DB, today: string): OwnerPay {
  const thisMonth = today.slice(0, 7);
  const from = `${addMonths(thisMonth, -6)}-01`;
  const to = `${thisMonth}-01`;
  const net = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS m, SUM(t.amount) AS net FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.scope = 'business' AND c.kind <> 'transfer' AND t.date >= ? AND t.date < ? GROUP BY m`,
    )
    .all(from, to) as { m: string; net: number }[];
  const pay = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS m, -SUM(t.amount) AS paid FROM transactions t
       JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
       WHERE a.default_scope = 'business' AND a.kind = 'bank' AND c.slug = 'internal_transfer' AND t.amount < 0
         AND t.date >= ? AND t.date < ? GROUP BY m`,
    )
    .all(`${addMonths(thisMonth, -3)}-01`, to) as { m: string; paid: number }[];
  if (net.length < 2) return { sustainable: null, actualAvg: pay.length ? round(pay.reduce((s, r) => s + r.paid, 0) / pay.length) : null, months: net.length, businessNetAvg: null };
  const avgNet = net.reduce((s, r) => s + r.net, 0) / net.length;
  return {
    sustainable: Math.max(0, Math.floor((avgNet * 0.9) / 100) * 100),
    actualAvg: pay.length ? round(pay.reduce((s, r) => s + r.paid, 0) / pay.length) : null,
    months: net.length,
    businessNetAvg: round(avgNet),
  };
}
