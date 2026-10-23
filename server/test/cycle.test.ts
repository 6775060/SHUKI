import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, setMeta, type DB } from '../src/db.js';
import { Categorizer } from '../src/categorize.js';
import { ingestTransactions, upsertAccount } from '../src/ingest.js';
import { cardBills, cycleBounds, cycleView, detectStartDay, ownerPay } from '../src/cycle.js';
import { businessData, parseDocsFile, saveDocs } from '../src/business.js';

let db: DB;
let cat: Categorizer;

beforeEach(() => {
  db = openDb('', ':memory:');
  cat = new Categorizer(db);
});

const acc = (kind: 'bank' | 'card', scope: 'private' | 'business', n: string, balance?: number) =>
  upsertAccount(db, { connectionId: null, kind, companyId: 't', accountNumber: n, label: n, defaultScope: scope, balance });

describe('cycle bounds', () => {
  it('starts on the start day and ends the day before the next one', () => {
    expect(cycleBounds('2026-10-23', 3)).toEqual({ start: '2026-10-03', end: '2026-11-02' });
    expect(cycleBounds('2026-10-02', 3)).toEqual({ start: '2026-09-03', end: '2026-10-02' });
    expect(cycleBounds('2026-02-28', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('detects the day owner pay lands at home', () => {
    const home = acc('bank', 'private', 'h');
    ingestTransactions(db, cat, home, ['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => ({ date: `${m}-03`, amount: 9000, description: 'העברה מחשבון' })), 'import');
    expect(detectStartDay(db, '2026-10-23')).toBe(3);
  });
});

describe('cycle view', () => {
  it('splits expected income into fixed, funds, joy and a weekly variable budget', () => {
    const home = acc('bank', 'private', 'h', 5000);
    const card = acc('card', 'private', 'c');
    const pay = ['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => ({ date: `${m}-03`, amount: 9300, description: 'משכורת מהעסק' }));
    ingestTransactions(db, cat, home, pay, 'import');
    ingestTransactions(db, cat, card, [{ date: '2026-10-19', amount: -400, description: 'שופרסל' }], 'import');
    setMeta(db, 'weekly_joy', '70');
    const recurring = [
      { key: 'out:שכר דירה', name: 'שכר דירה', categoryName: null, categorySlug: 'housing', amount: -4200, periodMonths: 1 as const, monthsSeen: 4, lastDate: '2026-10-01', nextDate: '2026-11-01', annual: -50400, priceChangePct: null, isNew: false, isTax: false, accountKind: 'bank', scope: 'private' as const },
    ];
    const c = cycleView(db, '2026-10-22', recurring, []);
    expect(c.start).toBe('2026-10-03');
    expect(c.income.expected).toBe(9300);
    expect(c.fixed.monthly).toBe(4200);
    expect(c.joy).toBe(310); // 70 × 31 / 7
    expect(c.variableBudget).toBe(9300 - 4200 - 310);
    expect(c.week.start).toBe('2026-10-18'); // Sunday
    expect(c.week.spent).toBe(400);
    expect(c.week.joy).toBe(70);
    expect(c.week.left).toBe(c.week.budget - 400);
  });
});

describe('cards and owner pay', () => {
  it('shows the next charge per card', () => {
    const card = acc('card', 'private', 'max');
    ingestTransactions(
      db,
      cat,
      card,
      [
        { date: '2026-10-05', processedDate: '2026-11-10', amount: -300, description: 'א' },
        { date: '2026-10-07', processedDate: '2026-11-10', amount: -200, description: 'ב' },
      ],
      'import',
    );
    expect(cardBills(db, '2026-10-23')[0]).toMatchObject({ nextDate: '2026-11-10', amount: 500, daysUntil: 18 });
  });

  it('computes sustainable owner pay from business surplus', () => {
    const biz = acc('bank', 'business', 'b');
    const tx = ['2026-07', '2026-08', '2026-09'].flatMap((m) => [
      { date: `${m}-05`, amount: 20000, description: 'העברה מלקוח' },
      { date: `${m}-15`, amount: -5000, description: 'מע"מ' },
    ]);
    ingestTransactions(db, cat, biz, tx, 'import');
    expect(ownerPay(db, '2026-10-23').sustainable).toBe(13500); // 15,000 × 90%
  });
});

describe('business documents', () => {
  it('imports a SUMIT-style export, credit notes negative', async () => {
    const csv = 'סוג מסמך,מספר מסמך,תאריך מסמך,שם לקוח,סה"כ כולל מע"מ,מע"מ\nחשבונית מס,5001,02/10/2026,אברהם לוי,4720,720\nחשבונית זיכוי,5004,03/10/2026,דוד פרץ,236,36\n';
    const r = await parseDocsFile('s.csv', Buffer.from(csv), 'sumit', 'income');
    expect(r.docs.map((d) => [d.number, d.counterparty, d.amount, d.vat])).toEqual([
      ['5001', 'אברהם לוי', 4720, 720],
      ['5004', 'דוד פרץ', -236, 36],
    ]);
    expect(saveDocs(db, r.docs)).toEqual({ added: 2, updated: 0 });
    expect(saveDocs(db, r.docs)).toEqual({ added: 0, updated: 2 });
  });

  it('flags an invoice with no matching deposit as open', async () => {
    acc('bank', 'business', 'b');
    saveDocs(db, [{ source: 'sumit', kind: 'income', externalId: '1', date: '2026-09-01', number: '1', counterparty: 'דוד', amount: 2360 }]);
    const d = businessData(db, '2026-10', '2026-10-23');
    expect(d.docs.openInvoices).toHaveLength(1);
    expect(d.docs.openInvoices[0]).toMatchObject({ counterparty: 'דוד', days: 52 });
  });
});
