import crypto from 'node:crypto';
import { transaction, type DB } from './db.js';
import { Categorizer, normalize } from './categorize.js';

export interface IncomingTxn {
  date: string; // ISO date or datetime
  processedDate?: string;
  amount: number; // negative = money out
  originalAmount?: number;
  originalCurrency?: string;
  description: string;
  memo?: string;
  identifier?: string;
  status?: 'completed' | 'pending';
  installmentNumber?: number;
  installmentTotal?: number;
  // Set for manual entries so two identical ones are both kept.
  uniqueKey?: string;
}

export interface AccountRef {
  id: number;
  kind: 'bank' | 'card' | 'cash';
  default_scope: 'private' | 'business';
}

export interface IngestResult {
  added: number;
  updated: number;
}

export function dayOf(date: string): string {
  return date.slice(0, 10);
}

function baseKey(accountId: number, t: IncomingTxn): string {
  // Deliberately excludes status, processed date and identifier: a pending
  // transaction often gains those once it completes, and must stay one row.
  return [accountId, dayOf(t.date), t.amount.toFixed(2), normalize(t.description), t.installmentNumber ?? '', t.uniqueKey ?? ''].join('|');
}

// Two identical purchases on the same day (two coffees) are both real, so each
// repeat within one batch gets an ordinal. Both scraper runs and file imports
// see the full day, so the ordinals line up between runs.
export function hashBatch(accountId: number, txns: IncomingTxn[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const key = baseKey(accountId, t);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return crypto.createHash('sha256').update(`${key}#${n}`).digest('hex');
  });
}

export function ingestTransactions(
  db: DB,
  categorizer: Categorizer,
  account: AccountRef,
  txns: IncomingTxn[],
  source: 'scraper' | 'import' | 'manual',
  prunePendingSince?: string,
): IngestResult {
  const hashes = hashBatch(account.id, txns);
  const find = db.prepare('SELECT id, status FROM transactions WHERE hash = ?');
  const insert = db.prepare(`
    INSERT INTO transactions (account_id, hash, date, processed_date, amount, original_amount, original_currency,
      description, memo, identifier, status, installment_number, installment_total, category_id, scope, source)
    VALUES (@account_id, @hash, @date, @processed_date, @amount, @original_amount, @original_currency,
      @description, @memo, @identifier, @status, @installment_number, @installment_total, @category_id, @scope, @source)
  `);
  const complete = db.prepare(
    "UPDATE transactions SET status = 'completed', processed_date = ?, identifier = COALESCE(?, identifier) WHERE id = ?",
  );

  let added = 0;
  let updated = 0;
  transaction(db, () => {
    txns.forEach((t, i) => {
      const status = t.status ?? 'completed';
      const existing = find.get(hashes[i]) as { id: number; status: string } | undefined;
      if (existing) {
        if (existing.status === 'pending' && status === 'completed') {
          complete.run(t.processedDate ?? null, t.identifier ?? null, existing.id);
          updated++;
        }
        return;
      }
      const { categoryId, scope } = categorizer.categorize({
        description: t.description,
        memo: t.memo,
        amount: t.amount,
        accountKind: account.kind,
        accountScope: account.default_scope,
      });
      insert.run({
        account_id: account.id,
        hash: hashes[i],
        date: dayOf(t.date),
        processed_date: t.processedDate ? dayOf(t.processedDate) : null,
        amount: t.amount,
        original_amount: t.originalAmount ?? null,
        original_currency: t.originalCurrency ?? null,
        description: t.description.trim(),
        memo: t.memo?.trim() || null,
        identifier: t.identifier ?? null,
        status,
        installment_number: t.installmentNumber ?? null,
        installment_total: t.installmentTotal ?? null,
        category_id: categoryId,
        scope,
        source,
      });
      added++;
    });
    if (prunePendingSince) {
      // A pending charge that vanished from the source was cancelled or reposted
      // under a different description; the completed version arrives separately.
      const seen = new Set(hashes);
      const pending = db
        .prepare("SELECT id, hash FROM transactions WHERE account_id = ? AND status = 'pending' AND date >= ?")
        .all(account.id, dayOf(prunePendingSince)) as { id: number; hash: string }[];
      const del = db.prepare('DELETE FROM transactions WHERE id = ?');
      for (const p of pending) if (!seen.has(p.hash)) del.run(p.id);
    }
  });
  return { added, updated };
}

export function upsertAccount(
  db: DB,
  a: {
    connectionId: number | null;
    kind: 'bank' | 'card' | 'cash';
    companyId: string | null;
    accountNumber: string;
    label: string;
    defaultScope: 'private' | 'business';
    balance?: number;
    balanceDate?: string;
  },
): AccountRef {
  const existing = db
    .prepare('SELECT id, kind, default_scope FROM accounts WHERE company_id IS ? AND account_number = ?')
    .get(a.companyId, a.accountNumber) as AccountRef | undefined;
  if (existing) {
    if (a.balance !== undefined) {
      db.prepare('UPDATE accounts SET balance = ?, balance_date = ?, connection_id = COALESCE(?, connection_id) WHERE id = ?').run(
        a.balance,
        a.balanceDate ?? new Date().toISOString(),
        a.connectionId,
        existing.id,
      );
    }
    return existing;
  }
  const id = db
    .prepare(
      'INSERT INTO accounts (connection_id, kind, company_id, account_number, label, default_scope, balance, balance_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(a.connectionId, a.kind, a.companyId, a.accountNumber, a.label, a.defaultScope, a.balance ?? null, a.balanceDate ?? null)
    .lastInsertRowid as number;
  return { id, kind: a.kind, default_scope: a.defaultScope };
}

// Money moved between the user's own bank accounts (e.g. owner pay from the
// business account to the home account) shows up twice: out of one, into the
// other. Pair them by exact opposite amount within three days and mark both as
// an internal transfer so they don't inflate income and expenses.
export function linkInternalTransfers(db: DB, categorizer: Categorizer): number {
  const transferId = categorizer.categoryIdBySlug('internal_transfer');
  const pairs = db
    .prepare(
      `SELECT o.id AS outId, i.id AS inId
       FROM transactions o
       JOIN accounts oa ON oa.id = o.account_id AND oa.kind = 'bank'
       JOIN transactions i ON i.amount = -o.amount AND i.account_id <> o.account_id
         AND abs(julianday(i.date) - julianday(o.date)) <= 3
       JOIN accounts ia ON ia.id = i.account_id AND ia.kind = 'bank'
       JOIN categories oc ON oc.id = o.category_id
       JOIN categories ic ON ic.id = i.category_id
       WHERE o.amount < 0 AND o.category_locked = 0 AND i.category_locked = 0
         AND oc.kind <> 'transfer' AND ic.kind <> 'transfer'
         AND oc.slug IN ('uncategorized', 'income_other', 'income_business')
         AND ic.slug IN ('uncategorized', 'income_other', 'income_business')
       ORDER BY o.date, o.id, abs(julianday(i.date) - julianday(o.date))`,
    )
    .all() as { outId: number; inId: number }[];
  const used = new Set<number>();
  const mark = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let linked = 0;
  transaction(db, () => {
    for (const p of pairs) {
      if (used.has(p.outId) || used.has(p.inId)) continue;
      used.add(p.outId).add(p.inId);
      mark.run(transferId, p.outId);
      mark.run(transferId, p.inId);
      linked++;
    }
  });
  return linked;
}
