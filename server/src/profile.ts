import { getMeta, setMeta, transaction, type DB } from './db.js';
import type { Categorizer } from './categorize.js';
import { addMonths } from './insights.js';

// How this household earns: business income that arrives through card clearing
// (no invoices per client) or from clients, and whether a steady salary comes in
// next to it. Insights and tips read this so they talk about the right things.

export type BusinessModel = 'clearing' | 'clients' | 'none';

export interface IncomeProfile {
  business: BusinessModel;
  salary: boolean;
  auto: boolean; // true while nothing was chosen by hand
}

export function incomeProfile(db: DB, today = new Date().toLocaleDateString('sv-SE')): IncomeProfile {
  const saved = getMeta(db, 'income_profile');
  if (saved) {
    const p = JSON.parse(saved) as Omit<IncomeProfile, 'auto'>;
    return { ...p, auto: false };
  }
  const from = `${addMonths(today.slice(0, 7), -6)}-01`;
  const sum = (where: string) =>
    (
      db
        .prepare(`SELECT COALESCE(SUM(t.amount), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.amount > 0 AND t.date >= ? AND ${where}`)
        .get(from) as { s: number }
    ).s;
  const clearing = sum("c.slug = 'income_clearing'");
  const biz = sum("t.scope = 'business' AND c.kind <> 'transfer'");
  const growPayments = (db.prepare("SELECT COUNT(*) AS n FROM business_docs WHERE source = 'grow'").get() as { n: number }).n;
  const invoices = (db.prepare("SELECT COUNT(*) AS n FROM business_docs WHERE kind = 'income'").get() as { n: number }).n;
  const hasBusiness = biz > 0 || !!db.prepare("SELECT 1 FROM accounts WHERE default_scope = 'business' LIMIT 1").get();
  const business: BusinessModel = !hasBusiness ? 'none' : (biz > 0 && clearing / biz >= 0.5) || (growPayments > 0 && invoices === 0) ? 'clearing' : 'clients';
  return { business, salary: sum("c.slug = 'income_salary'") > 0, auto: true };
}

export function saveIncomeProfile(db: DB, p: { business: BusinessModel; salary: boolean } | null): void {
  if (p) setMeta(db, 'income_profile', JSON.stringify({ business: p.business, salary: p.salary }));
  else db.prepare("DELETE FROM meta WHERE key = 'income_profile'").run();
}

export interface IncomeMix {
  month: string;
  salary: number;
  business: number;
  other: number;
}

// Where each month's income came from.
export function incomeMix(db: DB, endMonth: string, count = 6): IncomeMix[] {
  const from = `${addMonths(endMonth, -(count - 1))}-01`;
  const to = `${addMonths(endMonth, 1)}-01`;
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
         COALESCE(SUM(CASE WHEN c.slug = 'income_salary' THEN t.amount END), 0) AS salary,
         COALESCE(SUM(CASE WHEN c.slug <> 'income_salary' AND t.scope = 'business' THEN t.amount END), 0) AS business,
         COALESCE(SUM(CASE WHEN c.slug <> 'income_salary' AND t.scope <> 'business' THEN t.amount END), 0) AS other
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.amount > 0 AND c.kind <> 'transfer' AND t.date >= ? AND t.date < ?
       GROUP BY month`,
    )
    .all(from, to) as unknown as IncomeMix[];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(endMonth, i - (count - 1));
    const r = byMonth.get(month);
    return { month, salary: Math.round(r?.salary ?? 0), business: Math.round(r?.business ?? 0), other: Math.round(r?.other ?? 0) };
  });
}

// Runs once per new set of income rules (salary and clearing, then SUMIT):
// income filed under the generic categories moves where a rule now fits.
const INCOME_RULES_VERSION = '2';
export function applyNewIncomeRules(db: DB, categorizer: Categorizer): number {
  if (getMeta(db, 'income_rules_applied') === INCOME_RULES_VERSION) return 0;
  const rows = db
    .prepare(
      `SELECT t.id, t.description, t.memo, t.amount, t.category_id, t.scope, a.kind, a.default_scope
       FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
       WHERE t.category_locked = 0 AND t.amount > 0 AND c.slug IN ('income_business', 'income_other', 'uncategorized')`,
    )
    .all() as { id: number; description: string; memo: string | null; amount: number; category_id: number; scope: string; kind: 'bank' | 'card' | 'cash'; default_scope: 'private' | 'business' }[];
  const upd = db.prepare('UPDATE transactions SET category_id = ?, scope = ? WHERE id = ?');
  const target = new Set([categorizer.categoryIdBySlug('income_salary'), categorizer.categoryIdBySlug('income_clearing')]);
  let changed = 0;
  transaction(db, () => {
    for (const r of rows) {
      const c = categorizer.categorize({ description: r.description, memo: r.memo, amount: r.amount, accountKind: r.kind, accountScope: r.default_scope });
      if (target.has(c.categoryId)) {
        upd.run(c.categoryId, c.scope, r.id);
        changed++;
      }
    }
    setMeta(db, 'income_rules_applied', INCOME_RULES_VERSION);
  });
  return changed;
}
