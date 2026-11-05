import type { DB } from './db.js';

export interface MonthSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  byScope: { scope: string; income: number; expenses: number }[];
  byCategory: { categoryId: number; name: string; grp: string; total: number; count: number }[];
  uncategorizedCount: number;
  futureInstallments: { total: number; series: { description: string; perPayment: number; remaining: number; left: number }[] };
  balances: { id: number; label: string; kind: string; balance: number | null; balanceDate: string | null }[];
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

// Transfers (card payments at the bank, moves between own accounts) are left
// out so a card purchase is not counted twice.
const COUNTED = "c.kind <> 'transfer'";

export function monthSummary(db: DB, month: string): MonthSummary {
  const [from, to] = monthRange(month);
  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount END), 0) AS expenses
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date < ? AND ${COUNTED}`,
    )
    .get(from, to) as { income: number; expenses: number };

  const byScope = db
    .prepare(
      `SELECT COALESCE(t.scope, 'private') AS scope,
         COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount END), 0) AS expenses
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date < ? AND ${COUNTED}
       GROUP BY 1`,
    )
    .all(from, to) as MonthSummary['byScope'];

  const byCategory = db
    .prepare(
      `SELECT c.id AS categoryId, c.name, c.grp, -SUM(t.amount) AS total, COUNT(*) AS count
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date < ? AND c.kind = 'expense'
       GROUP BY c.id HAVING total <> 0 ORDER BY total DESC`,
    )
    .all(from, to) as MonthSummary['byCategory'];

  const uncategorizedCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE c.slug = 'uncategorized' AND t.date >= ? AND t.date < ?`,
      )
      .get(from, to) as { n: number }
  ).n;

  return {
    month,
    income: totals.income,
    expenses: totals.expenses,
    net: totals.income - totals.expenses,
    byScope,
    byCategory,
    uncategorizedCount,
    futureInstallments: futureInstallments(db),
    balances: db
      .prepare('SELECT id, label, kind, balance, balance_date AS balanceDate FROM accounts ORDER BY kind, label')
      .all() as MonthSummary['balances'],
  };
}

// For every installment plan, the latest payment seen tells how many are left.
export function futureInstallments(db: DB): MonthSummary['futureInstallments'] {
  const rows = db
    .prepare(
      `SELECT description, amount, installment_total AS total, MAX(installment_number) AS latest
       FROM transactions
       WHERE installment_total > 1 AND installment_number IS NOT NULL AND amount < 0
       GROUP BY account_id, description, installment_total, amount
       HAVING latest < total`,
    )
    .all() as { description: string; amount: number; total: number; latest: number }[];
  const series = rows
    .map((r) => ({ description: r.description, perPayment: -r.amount, left: r.total - r.latest, remaining: -r.amount * (r.total - r.latest) }))
    .sort((a, b) => b.remaining - a.remaining);
  return { total: series.reduce((s, r) => s + r.remaining, 0), series };
}

export function monthsWithData(db: DB): string[] {
  return (db.prepare("SELECT DISTINCT substr(date, 1, 7) AS m FROM transactions ORDER BY m DESC").all() as { m: string }[]).map((r) => r.m);
}
