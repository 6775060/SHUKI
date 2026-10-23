import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { Categorizer } from '../src/categorize.js';
import { ingestTransactions, upsertAccount, type IncomingTxn } from '../src/ingest.js';
import { categoryComparison, detectRecurring, forecast, merchantKey, safeToSpend, spendingPace } from '../src/insights.js';

let db: DB;
let cat: Categorizer;

beforeEach(() => {
  db = openDb('', ':memory:');
  cat = new Categorizer(db);
});

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function account(kind: 'bank' | 'card', scope: 'private' | 'business', n: string, balance?: number) {
  return upsertAccount(db, { connectionId: null, kind, companyId: 't', accountNumber: n, label: n, defaultScope: scope, balance });
}

describe('merchantKey', () => {
  it('ignores branch numbers and punctuation', () => {
    expect(merchantKey('שופרסל דיל 123')).toBe(merchantKey('שופרסל-דיל 456'));
  });
});

describe('detectRecurring', () => {
  it('finds fixed subscriptions and bi-monthly bills, not variable monthly visits', () => {
    const card = account('card', 'private', 'c');
    const bank = account('bank', 'private', 'b');
    const fuel = [210, 260, 185, 240, 199, 230];
    const cardTx: IncomingTxn[] = months.flatMap((m, i) => [
      { date: `${m}-08`, amount: i >= 4 ? -59.9 : -49.9, description: 'NETFLIX.COM' },
      { date: `${m}-06`, amount: -fuel[i], description: 'סונול' },
    ]);
    const bankTx: IncomingTxn[] = months
      .filter((_, i) => i % 2 === 0)
      .map((m, i) => ({ date: `${m}-11`, amount: -(680 + i * 10), description: 'עיריית בני ברק ארנונה' }));
    ingestTransactions(db, cat, card, cardTx, 'import');
    ingestTransactions(db, cat, bank, bankTx, 'import');

    const r = detectRecurring(db, '2026-10-23');
    const names = r.map((x) => x.name);
    expect(names).toContain('NETFLIX.COM');
    expect(names).not.toContain('סונול');
    const netflix = r.find((x) => x.name === 'NETFLIX.COM')!;
    expect(netflix.priceChangePct).toBeCloseTo(0.2, 1);
    expect(netflix.nextDate).toBe('2026-11-08');
    const arnona = r.find((x) => x.name.includes('ארנונה'))!;
    expect(arnona.periodMonths).toBe(2);
    expect(arnona.nextDate).toBe('2026-11-11');
  });
});

describe('category comparison', () => {
  it('compares against the average of previous months', () => {
    const card = account('card', 'private', 'c');
    ingestTransactions(
      db,
      cat,
      card,
      ['2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) => ({ date: `${m}-05`, amount: i === 3 ? -1300 : -1000, description: 'שופרסל' })),
      'import',
    );
    const food = categoryComparison(db, '2026-10').find((c) => c.slug === 'food')!;
    expect(food.total).toBe(1300);
    expect(food.avg).toBe(1000);
    expect(food.steady).toBe(true);
    expect(food.deltaPct).toBeCloseTo(0.3);
  });
});

describe('pace', () => {
  it('projects month-end from what is usually left to spend', () => {
    const card = account('card', 'private', 'c');
    const tx: IncomingTxn[] = [];
    for (const m of ['2026-07', '2026-08', '2026-09']) tx.push({ date: `${m}-05`, amount: -1000, description: 'א' }, { date: `${m}-25`, amount: -500, description: 'ב' });
    tx.push({ date: '2026-10-05', amount: -1200, description: 'א' });
    ingestTransactions(db, cat, card, tx, 'import');
    const p = spendingPace(db, '2026-10', '2026-10-10');
    expect(p.spentToDate).toBe(1200);
    expect(p.avgToDate).toBe(1000);
    expect(p.avgFull).toBe(1500);
    expect(p.projected).toBe(1700);
  });
});

describe('forecast and safe-to-spend', () => {
  it('flags the first day the balance would go negative', () => {
    const bank = account('bank', 'private', 'b', 1000);
    const card = account('card', 'private', 'c');
    ingestTransactions(db, cat, card, [{ date: '2026-10-20', processedDate: '2026-11-10', amount: -1500, description: 'מקרר' }], 'import');
    const fc = forecast(db, '2026-10-23', [], 30)!;
    expect(fc.start).toBe(1000);
    expect(fc.firstNegative).toBe('2026-11-10');
    expect(bank.id).toBeGreaterThan(0);
  });

  it('uses only the home account and keeps business money out', () => {
    account('bank', 'private', 'home', 3100);
    account('bank', 'business', 'biz', 20000);
    const s = safeToSpend(db, '2026-10-22', [], [
      { id: 1, name: 'חגים', icon: null, annualAmount: 1200, monthly: 100, dueMonth: null, nextDue: null, categoryId: null, categoryName: null, spentLast12: 0, spentThisYear: 0 },
    ])!;
    expect(s.available).toBe(3000);
    expect(s.daysLeft).toBe(10);
    expect(s.perDay).toBe(300);
  });
});
