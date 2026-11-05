import type { DB } from './db.js';
import { addMonths } from './insights.js';
import { syncAlerts } from './sync-health.js';

// "Can I trust these numbers?" One answer, and if not, exactly what is off.
// Each check looks for a way the totals could quietly be wrong.

export interface CheckItem {
  key: string;
  level: 'critical' | 'warning';
  title: string;
  action: string;
  page: string;
  params?: Record<string, string>;
}

export interface DataCheck {
  ok: boolean;
  checked: string[];
  items: CheckItem[];
}

const ils = (n: number) => `₪${Math.round(Math.abs(n)).toLocaleString('he-IL')}`;

// How each card company shows up as a charge in the bank account.
const CARD_WORDS: { companies: string[]; words: string[]; name: string }[] = [
  { companies: ['isracard', 'amex'], words: ['ישראכרט', 'אמריקן אקספרס'], name: 'ישראכרט' },
  { companies: ['max'], words: ['מקס איט', 'MAX IT', 'לאומי קארד'], name: 'מקס' },
  { companies: ['visaCal'], words: ['כאל', 'כ.א.ל', 'ויזה'], name: 'כאל' },
];

export function dataCheck(db: DB, today: string): DataCheck {
  const items: CheckItem[] = [];
  const month = today.slice(0, 7);
  const from = `${addMonths(month, -2)}-01`;

  // 1. Every source synced recently.
  for (const a of syncAlerts(db, today).filter((a) => a.level !== 'info')) {
    items.push({ key: `sync-${a.key}`, level: a.level === 'critical' ? 'critical' : 'warning', title: a.title, action: a.action, page: a.page });
  }

  // 2. A card that is paid from the bank but not connected: its purchases are
  // missing, because the bank charge itself counts as a transfer.
  const connectedCards = new Set((db.prepare("SELECT DISTINCT company_id FROM accounts WHERE kind = 'card' AND company_id IS NOT NULL").all() as { company_id: string }[]).map((r) => r.company_id));
  const charges = db
    .prepare(
      `SELECT t.description, -t.amount AS amount FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
       WHERE c.slug = 'card_payment' AND a.kind = 'bank' AND t.amount < 0 AND t.date >= ?`,
    )
    .all(from) as { description: string; amount: number }[];
  for (const card of CARD_WORDS) {
    if (card.companies.some((c) => connectedCards.has(c))) continue;
    const hits = charges.filter((c) => card.words.some((w) => c.description.includes(w)));
    const total = hits.reduce((s, c) => s + c.amount, 0);
    if (hits.length && total >= 200) {
      items.push({
        key: `card-${card.name}`,
        level: 'critical',
        title: `${card.name}: ${ils(total)} חויבו בבנק ב-3 החודשים האחרונים, אבל הכרטיס לא מחובר`,
        action: `הקניות בכרטיס לא מופיעות בהוצאות, ולכן ההוצאות נראות נמוכות מהמציאות. כדאי לחבר את ${card.name} במסך החיבורים, או לייבא את הפירוט שלו כקובץ.`,
        page: 'connections',
      });
    }
  }

  // 3. The same purchase counted twice (e.g. from a file and from the bank).
  const dups = db
    .prepare(
      `SELECT a.date, a.description, a.amount FROM transactions a JOIN transactions b
         ON b.account_id = a.account_id AND b.date = a.date AND b.amount = a.amount AND b.id > a.id AND b.source <> a.source
       WHERE a.date >= ? LIMIT 20`,
    )
    .all(from) as { date: string; description: string; amount: number }[];
  if (dups.length) {
    items.push({
      key: 'dups',
      level: 'warning',
      title: `${dups.length} תנועות שאולי נספרו פעמיים`,
      action: `אותו סכום, באותו יום ובאותו חשבון, גם מקובץ וגם מהסנכרון (למשל ${dups[0].description}, ${ils(dups[0].amount)}). כדאי להציץ ולמחוק את הכפולה.`,
      page: 'transactions',
      params: { month: dups[0].date.slice(0, 7) },
    });
  }

  // 4. Uncategorized spending big enough to skew the picture.
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN c.slug = 'uncategorized' THEN -t.amount END), 0) AS unc, COALESCE(SUM(-t.amount), 0) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.amount < 0 AND c.kind <> 'transfer' AND substr(t.date, 1, 7) = ?`,
    )
    .get(month) as { unc: number; total: number };
  if (sums.total > 0 && sums.unc / sums.total >= 0.08 && sums.unc >= 300) {
    items.push({
      key: 'uncategorized',
      level: 'warning',
      title: `${ils(sums.unc)} מההוצאות החודש עוד לא מסווגים`,
      action: `זה ${Math.round((sums.unc / sums.total) * 100)}% מההוצאות, ולכן התמונה לפי קטגוריות חלקית. כמה דקות של סיווג מתקנות.`,
      page: 'transactions',
      params: { month, uncategorized: '1' },
    });
  }

  // 5. A bank balance that is old says nothing about today.
  const stale = db
    .prepare("SELECT label, balance_date FROM accounts WHERE kind = 'bank' AND balance IS NOT NULL AND balance_date IS NOT NULL AND julianday(?) - julianday(substr(balance_date, 1, 10)) > 4")
    .all(today) as { label: string; balance_date: string }[];
  for (const s of stale) {
    if (items.some((i) => i.title.startsWith(s.label))) continue;
    items.push({ key: `bal-${s.label}`, level: 'warning', title: `${s.label}: היתרה מ-${s.balance_date.slice(0, 10).split('-').reverse().join('/')}`, action: 'היתרה וה"מה אפשר להוציא" מחושבים ממנה. סנכרון יעדכן אותה.', page: 'connections' });
  }

  return {
    ok: items.length === 0,
    checked: ['כל החיבורים סונכרנו לאחרונה', 'כל כרטיס שמחויב בבנק מחובר', 'אין תנועות כפולות', 'רוב ההוצאות מסווגות', 'יתרות הבנק עדכניות'],
    items: items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1)),
  };
}
