import type { DB } from './db.js';
import { clean, parseAmount, parseDate, readRows, type Cell } from './importer.js';

// Long-term savings in one place: pension, provident and study funds,
// investments. Filled by hand or from the clearing-house (מסלקה) / Har HaKesef
// export. Formats vary, so the header row is found by keywords.

export type Product = 'pension' | 'gemel' | 'hishtalmut' | 'gemel_invest' | 'managers' | 'investment' | 'savings' | 'other';

export const PRODUCT_LABEL: Record<Product, string> = {
  pension: 'קרן פנסיה',
  managers: 'ביטוח מנהלים',
  gemel: 'קופת גמל',
  hishtalmut: 'קרן השתלמות',
  gemel_invest: 'גמל להשקעה',
  investment: 'תיק השקעות',
  savings: 'חיסכון / פיקדון',
  other: 'אחר',
};

export interface SavingsAccount {
  id?: number;
  provider: string;
  product: Product;
  accountNumber: string;
  track: string | null;
  status: 'active' | 'inactive';
  balance: number;
  balanceDate: string | null;
  monthlyDeposit: number | null;
  feeBalancePct: number | null;
  feeDepositPct: number | null;
  owner?: string | null;
  note?: string | null;
}

const COLS = {
  provider: ['שם הגוף המנהל', 'גוף מנהל', 'הגוף המנהל', 'חברה מנהלת', 'שם החברה', 'שם היצרן', 'יצרן', 'חברה'],
  product: ['סוג מוצר', 'סוג המוצר', 'סוג תכנית', 'סוג התכנית', 'סוג קופה', 'סוג חיסכון', 'מוצר'],
  account: ['מספר פוליסה', 'מספר חשבון', 'מספר עמית', 'מספר קופה', 'מספר תכנית', 'פוליסה', 'חשבון'],
  track: ['מסלול השקעה', 'מסלול'],
  balance: ['יתרה צבורה', 'סכום צבור', 'סך החיסכון', 'סה"כ חיסכון', 'סך חיסכון', 'ערך פדיון', 'צבירה', 'יתרה', 'שווי'],
  status: ['סטטוס', 'מצב חשבון', 'מצב'],
  deposit: ['הפקדה חודשית', 'הפקדה אחרונה', 'סכום הפקדה', 'הפקדות חודשיות'],
  feeBalance: ['דמי ניהול מצבירה', 'דמי ניהול מהצבירה', 'דמי ניהול מחיסכון', 'מהצבירה', 'מצבירה', 'מחיסכון'],
  feeDeposit: ['דמי ניהול מהפקדה', 'דמי ניהול מההפקדה', 'מההפקדה', 'מהפקדה', 'מהפקדות'],
  date: ['תאריך נכונות', 'נכון לתאריך', 'תאריך עדכון', 'תאריך הנתונים', 'תאריך'],
};

type ColKey = keyof typeof COLS;

function detect(headers: string[]): Partial<Record<ColKey, number>> | null {
  const used = new Set<number>();
  const out: Partial<Record<ColKey, number>> = {};
  // Fees first: "דמי ניהול מצבירה" must not be taken as the balance column.
  const order: ColKey[] = ['feeBalance', 'feeDeposit', 'deposit', 'provider', 'product', 'account', 'track', 'balance', 'status', 'date'];
  for (const k of order) {
    for (const c of COLS[k]) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && h.includes(c));
      if (i !== -1) {
        out[k] = i;
        used.add(i);
        break;
      }
    }
  }
  return out.provider !== undefined && out.balance !== undefined ? out : null;
}

export function productOf(text: string): Product {
  const t = text.replace(/["']/g, '');
  if (/מנהלים/.test(t)) return 'managers';
  if (/השתלמות/.test(t)) return 'hishtalmut';
  if (/גמל.*השקע|השקעה.*גמל/.test(t)) return 'gemel_invest';
  if (/פנסי/.test(t)) return 'pension';
  if (/גמל|תגמולים|פיצויים/.test(t)) return 'gemel';
  if (/ביטוח/.test(t)) return 'managers';
  if (/השקע|תיק|ני"ע|ניירות/.test(t)) return 'investment';
  if (/פיקדון|פקדון|חיסכון/.test(t)) return 'savings';
  return 'other';
}

// Fees arrive as "0.25%", 0.25 or 0.0025. Management fees are never this small
// as a real percentage, so tiny numbers are read as fractions.
function parsePct(v: Cell, kind: 'balance' | 'deposit'): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = parseAmount(s.replace('%', ''));
  if (n === null || n < 0) return null;
  if (s.includes('%')) return n;
  if (kind === 'balance' ? n > 0 && n < 0.011 : n > 0 && n < 0.07) return Math.round(n * 10000) / 100;
  return n;
}

export async function parseSavingsFile(filename: string, buf: Buffer): Promise<{ headers: string[]; accounts: SavingsAccount[]; skipped: number }> {
  const rows = await readRows(filename, buf);
  let headerIdx = -1;
  let map: Partial<Record<ColKey, number>> | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    map = detect(rows[i].map(clean));
    if (map) {
      headerIdx = i;
      break;
    }
  }
  if (!map) throw new Error('HEADER_NOT_FOUND');
  const get = (row: Cell[], k: ColKey) => (map![k] !== undefined ? (row[map![k]!] ?? null) : null);
  const accounts: SavingsAccount[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    const provider = clean(get(row, 'provider'));
    const balance = parseAmount(get(row, 'balance'));
    if (!provider || balance === null || /סה"?כ|סיכום/.test(provider)) {
      skipped++;
      continue;
    }
    const productText = clean(get(row, 'product'));
    const status = clean(get(row, 'status'));
    accounts.push({
      provider,
      product: productOf(`${productText} ${productText ? '' : provider}`),
      accountNumber: clean(get(row, 'account')),
      track: clean(get(row, 'track')) || null,
      status: /לא\s*פעיל|לא-פעיל|מוקפא|inactive/i.test(status) ? 'inactive' : 'active',
      balance: Math.round(balance),
      balanceDate: parseDate(get(row, 'date')),
      monthlyDeposit: parseAmount(get(row, 'deposit')),
      feeBalancePct: parsePct(get(row, 'feeBalance'), 'balance'),
      feeDepositPct: parsePct(get(row, 'feeDeposit'), 'deposit'),
    });
  }
  return { headers: rows[headerIdx].map(clean), accounts, skipped };
}

export function saveSavings(db: DB, accounts: SavingsAccount[], source: 'manual' | 'import'): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const find = db.prepare('SELECT id FROM savings_accounts WHERE provider = ? AND product = ? AND account_number = ?');
  const ins = db.prepare(
    `INSERT INTO savings_accounts (provider, product, account_number, track, status, balance, balance_date, monthly_deposit, fee_balance_pct, fee_deposit_pct, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upd = db.prepare(
    `UPDATE savings_accounts SET track = COALESCE(?, track), status = ?, balance = ?, balance_date = COALESCE(?, balance_date),
       monthly_deposit = COALESCE(?, monthly_deposit), fee_balance_pct = COALESCE(?, fee_balance_pct), fee_deposit_pct = COALESCE(?, fee_deposit_pct),
       source = ?, updated_at = datetime('now') WHERE id = ?`,
  );
  for (const a of accounts) {
    const row = find.get(a.provider, a.product, a.accountNumber) as { id: number } | undefined;
    if (row) {
      upd.run(a.track, a.status, a.balance, a.balanceDate, a.monthlyDeposit, a.feeBalancePct, a.feeDepositPct, source, row.id);
      updated++;
    } else {
      ins.run(a.provider, a.product, a.accountNumber, a.track, a.status, a.balance, a.balanceDate, a.monthlyDeposit, a.feeBalancePct, a.feeDepositPct, source);
      added++;
    }
  }
  return { added, updated };
}

export function listSavings(db: DB): (SavingsAccount & { id: number; updatedAt: string; source: string })[] {
  return db
    .prepare(
      `SELECT id, provider, product, account_number AS accountNumber, track, status, balance, balance_date AS balanceDate,
         monthly_deposit AS monthlyDeposit, fee_balance_pct AS feeBalancePct, fee_deposit_pct AS feeDepositPct, owner, note, source, updated_at AS updatedAt
       FROM savings_accounts ORDER BY status, balance DESC`,
    )
    .all() as unknown as (SavingsAccount & { id: number; updatedAt: string; source: string })[];
}

export interface SavingsInsight {
  tone: 'good' | 'attention' | 'neutral';
  icon: string;
  title: string;
  body: string;
  yearly?: number;
}

// Benchmarks: what a reasonable, negotiated fee looks like today (the legal
// caps are 0.5% / 6% for pension funds and 1.05% for provident funds).
const FAIR: Partial<Record<Product, { balance: number; deposit?: number }>> = {
  pension: { balance: 0.22, deposit: 1.5 },
  gemel: { balance: 0.6 },
  hishtalmut: { balance: 0.6 },
  gemel_invest: { balance: 0.6 },
  managers: { balance: 0.8, deposit: 2 },
};

export function savingsView(db: DB, today: string) {
  const accounts = listSavings(db);
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const byProduct = Object.entries(
    accounts.reduce<Record<string, number>>((m, a) => ({ ...m, [a.product]: (m[a.product] ?? 0) + a.balance }), {}),
  )
    .map(([product, sum]) => ({ product, label: PRODUCT_LABEL[product as Product], total: sum }))
    .sort((a, b) => b.total - a.total);

  const yearAgo = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
  const bank = db
    .prepare(
      `SELECT COALESCE(SUM(-t.amount), 0) AS s, COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.slug = 'pension' AND t.amount < 0 AND t.date >= ?`,
    )
    .get(yearAgo) as { s: number; n: number };
  const bankMonthly = bank.n ? Math.round(bank.s / 12) : 0;

  const insights: SavingsInsight[] = [];
  let feeTotal = 0;
  let feeSave = 0;
  for (const a of accounts) {
    const fair = FAIR[a.product];
    const yearlyFee = (a.feeBalancePct ?? 0) / 100 * a.balance + ((a.feeDepositPct ?? 0) / 100) * (a.monthlyDeposit ?? 0) * 12;
    feeTotal += yearlyFee;
    if (!fair) continue;
    const overBalance = a.feeBalancePct !== null && a.feeBalancePct > fair.balance + 0.05;
    const overDeposit = fair.deposit !== undefined && a.feeDepositPct !== null && a.feeDepositPct > fair.deposit + 0.25;
    if (!overBalance && !overDeposit) continue;
    const save =
      (overBalance ? ((a.feeBalancePct! - fair.balance) / 100) * a.balance : 0) +
      (overDeposit ? ((a.feeDepositPct! - fair.deposit!) / 100) * (a.monthlyDeposit ?? 0) * 12 : 0);
    feeSave += save;
    if (save < 100) continue;
    insights.push({
      tone: 'attention',
      icon: '🏷️',
      title: `דמי ניהול גבוהים ב${a.provider} (${PRODUCT_LABEL[a.product]})`,
      body: `${overBalance ? `${a.feeBalancePct}% מהצבירה` : ''}${overBalance && overDeposit ? ' ו-' : ''}${overDeposit ? `${a.feeDepositPct}% מההפקדה` : ''}. היום אפשר לקבל בערך ${fair.balance}% מהצבירה${fair.deposit !== undefined ? ` ו-${fair.deposit}% מההפקדה` : ''}. שיחה אחת לסוכן או לחברה – כ-${Math.round(save).toLocaleString('he-IL')} ₪ בשנה, ובמצטבר עד הפרישה הרבה יותר.`,
      yearly: Math.round(save),
    });
  }

  const inactive = accounts.filter((a) => a.status === 'inactive' && ['pension', 'gemel', 'managers', 'hishtalmut'].includes(a.product));
  if (inactive.length) {
    insights.push({
      tone: 'attention',
      icon: '🧩',
      title: `${inactive.length === 1 ? 'חשבון אחד לא פעיל' : `${inactive.length} חשבונות לא פעילים`} (${Math.round(inactive.reduce((s, a) => s + a.balance, 0)).toLocaleString('he-IL')} ₪)`,
      body: `${inactive.map((a) => `${a.provider} – ${PRODUCT_LABEL[a.product]}`).join(', ')}. חשבון שלא מפקידים אליו ממשיך לשלם דמי ניהול. בדרך כלל כדאי לאחד אותו לחשבון הפעיל – בקשה אחת לסוכן או לחברה שאליה מעבירים.`,
    });
  }

  const active = (p: Product) => accounts.some((a) => a.product === p && a.status === 'active');
  if (accounts.length && !active('pension') && !active('managers')) {
    insights.push({
      tone: 'attention',
      icon: '🛡️',
      title: 'לא נמצאה קרן פנסיה פעילה',
      body: 'עצמאי חייב להפקיד לפנסיה מדי שנה, וההפקדה גם מזכה בהטבת מס. כדאי לוודא עם הסוכן שיש קרן פעילה ושההפקדות נכנסות.',
    });
  }
  if (accounts.length && !active('hishtalmut')) {
    insights.push({
      tone: 'neutral',
      icon: '🎓',
      title: 'אין קרן השתלמות פעילה',
      body: 'לעצמאים, הפקדה לקרן השתלמות מוכרת חלקית כהוצאה, עד תקרה שנתית, והרווח בה פטור ממס אחרי 6 שנים. שווה לשאול את רואה החשבון כמה כדאי להפקיד השנה.',
    });
  }

  const stale = accounts.filter((a) => a.balanceDate && a.balanceDate < new Date(Date.parse(today) - 200 * 86400000).toISOString().slice(0, 10));
  if (stale.length) {
    insights.push({
      tone: 'neutral',
      icon: '🔄',
      title: stale.length === 1 ? 'חשבון אחד עם נתונים ישנים' : `${stale.length} חשבונות עם נתונים ישנים`,
      body: 'היתרות עודכנו לפני יותר מחצי שנה. דוח מסלקה חדש (או הדוח הרבעוני מהחברה) ייתן תמונה מדויקת.',
    });
  }

  if (!insights.some((i) => i.tone === 'attention') && accounts.length) {
    insights.unshift({ tone: 'good', icon: '🌿', title: 'החיסכון לטווח ארוך מסודר', body: 'דמי הניהול סבירים ואין חשבונות נשכחים. כדאי לעבור על זה שוב פעם בשנה.' });
  }

  return {
    accounts,
    total: Math.round(total),
    byProduct,
    feeTotal: Math.round(feeTotal),
    feeSave: Math.round(feeSave),
    monthlyDeposits: Math.round(accounts.filter((a) => a.status === 'active').reduce((s, a) => s + (a.monthlyDeposit ?? 0), 0)),
    bankMonthly,
    insights,
  };
}
