import { describe, expect, it, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb, type DB } from '../src/db.js';
import { Vault, encrypt, decrypt } from '../src/vault.js';
import { Categorizer } from '../src/categorize.js';
import { ingestTransactions, upsertAccount, type AccountRef } from '../src/ingest.js';
import { parseStatement, parseAmount, parseDate } from '../src/importer.js';
import { monthSummary } from '../src/stats.js';
import { listInstitutions } from '../src/institutions.js';

let db: DB;
let cat: Categorizer;

beforeEach(() => {
  db = openDb('', ':memory:');
  cat = new Categorizer(db);
});

function slugOf(id: number): string {
  return (db.prepare('SELECT slug FROM categories WHERE id = ?').get(id) as { slug: string }).slug;
}

function account(kind: 'bank' | 'card', scope: 'private' | 'business' = 'private', n = '1'): AccountRef {
  return upsertAccount(db, { connectionId: null, kind, companyId: 'test', accountNumber: `${kind}-${n}`, label: kind, defaultScope: scope });
}

describe('vault', () => {
  it('round-trips and rejects a wrong password', () => {
    const v = new Vault(db);
    v.setup('correct horse');
    const sealed = v.seal({ username: 'a', password: 'b' });
    v.lock();
    expect(() => v.open(sealed)).toThrow();
    expect(v.unlock('wrong password')).toBe(false);
    expect(v.unlock('correct horse')).toBe(true);
    expect(v.open(sealed)).toEqual({ username: 'a', password: 'b' });
  });

  it('detects tampering', () => {
    const key = Buffer.alloc(32, 7);
    const payload = encrypt(key, 'secret');
    const parts = payload.split(':');
    parts[3] = Buffer.from('other!').toString('base64');
    expect(() => decrypt(key, parts.join(':'))).toThrow();
  });
});

describe('institutions', () => {
  it('lists the user institutions first with Hebrew labels', () => {
    const ids = listInstitutions().map((i) => i.id);
    expect(ids.slice(0, 5)).toEqual(['pagi', 'hapoalim', 'discount', 'max', 'isracard']);
    const isracard = listInstitutions().find((i) => i.id === 'isracard')!;
    expect(isracard.kind).toBe('card');
    expect(isracard.loginFields.map((f) => f.key)).toEqual(['id', 'card6Digits', 'password']);
  });
});

describe('categorizer', () => {
  const run = (description: string, amount = -50, accountKind: 'bank' | 'card' = 'card', accountScope: 'private' | 'business' = 'private') =>
    slugOf(cat.categorize({ description, amount, accountKind, accountScope }).categoryId);

  it('matches common Israeli merchants', () => {
    expect(run('שופרסל דיל ב"ש')).toBe('food');
    expect(run('סופר-פארם רמת גן')).toBe('health');
    expect(run('פז-ילו 123')).toBe('fuel');
    expect(run('חברת החשמל לישראל')).toBe('electricity');
    expect(run('NETFLIX.COM')).toBe('subscriptions');
  });

  it('respects word boundaries for short patterns', () => {
    expect(run('מיכאל כהן')).toBe('uncategorized');
    expect(run('כאל חיוב', -900, 'bank')).toBe('card_payment');
    expect(run('דן אוטובוסים')).toBe('transport');
  });

  it('only treats card companies as transfers on bank accounts', () => {
    expect(run('ישראכרט', -2000, 'bank')).toBe('card_payment');
    expect(run('ישראכרט', -2000, 'card')).toBe('uncategorized');
  });

  it('defaults income by account scope', () => {
    expect(run('העברה מלקוח', 1200, 'bank', 'business')).toBe('income_business');
    expect(run('העברה', 300, 'bank', 'private')).toBe('income_other');
  });

  it('lets user rules win over defaults', () => {
    const leisure = cat.categoryIdBySlug('leisure');
    db.prepare('INSERT INTO rules (pattern, category_id) VALUES (?, ?)').run('שופרסל', leisure);
    cat.reload();
    expect(run('שופרסל אונליין')).toBe('leisure');
  });
});

describe('ingest', () => {
  it('dedupes repeated syncs but keeps two identical purchases', () => {
    const acc = account('card');
    const batch = [
      { date: '2026-10-01T00:00:00.000Z', amount: -12, description: 'קפה' },
      { date: '2026-10-01T00:00:00.000Z', amount: -12, description: 'קפה' },
    ];
    expect(ingestTransactions(db, cat, acc, batch, 'scraper').added).toBe(2);
    expect(ingestTransactions(db, cat, acc, batch, 'scraper').added).toBe(0);
    expect(ingestTransactions(db, cat, acc, batch, 'import').added).toBe(0);
  });

  it('completes a pending transaction instead of duplicating it', () => {
    const acc = account('card');
    ingestTransactions(db, cat, acc, [{ date: '2026-10-05', amount: -80, description: 'רמי לוי', status: 'pending' }], 'scraper');
    const r = ingestTransactions(db, cat, acc, [{ date: '2026-10-05', amount: -80, description: 'רמי לוי', status: 'completed', identifier: '991' }], 'scraper');
    expect(r).toEqual({ added: 0, updated: 1 });
    const row = db.prepare('SELECT status, identifier FROM transactions').get();
    expect(row).toEqual({ status: 'completed', identifier: '991' });
  });

  it('drops pending charges that disappeared from the source', () => {
    const acc = account('card');
    ingestTransactions(db, cat, acc, [{ date: '2026-10-05', amount: -80, description: 'זמני', status: 'pending' }], 'scraper');
    ingestTransactions(db, cat, acc, [{ date: '2026-10-06', amount: -10, description: 'אחר' }], 'scraper', '2026-10-01');
    expect(db.prepare('SELECT description FROM transactions').all()).toEqual([{ description: 'אחר' }]);
  });

  it('marks business account transactions as business', () => {
    const acc = account('bank', 'business');
    ingestTransactions(db, cat, acc, [{ date: '2026-10-05', amount: 2400, description: 'העברה מלקוח' }], 'scraper');
    expect(db.prepare('SELECT scope FROM transactions').get()).toEqual({ scope: 'business' });
  });
});

describe('summary', () => {
  it('excludes card payments at the bank and counts future installments', () => {
    const bank = account('bank');
    const card = account('card');
    ingestTransactions(db, cat, bank, [
      { date: '2026-10-02', amount: 8000, description: 'משכורת' },
      { date: '2026-10-10', amount: -1500, description: 'ישראכרט' },
    ], 'scraper');
    ingestTransactions(db, cat, card, [
      { date: '2026-10-03', amount: -1000, description: 'שופרסל' },
      { date: '2026-10-04', amount: -500, description: 'מקרר', installmentNumber: 2, installmentTotal: 10 },
    ], 'scraper');
    const s = monthSummary(db, '2026-10');
    expect(s.income).toBe(8000);
    expect(s.expenses).toBe(1500);
    expect(s.futureInstallments.total).toBe(4000);
    expect(s.byCategory.find((c) => c.name === 'מזון וסופר')?.total).toBe(1000);
  });
});

describe('importer', () => {
  it('parses Israeli number and date formats', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('₪ -45.90')).toBe(-45.9);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseDate('05/10/26')).toBe('2026-10-05');
    expect(parseDate('5.10.2026')).toBe('2026-10-05');
    expect(parseDate(46300)).toBe('2026-10-05'); // Excel serial date
  });

  it('reads a bank CSV with debit/credit columns', async () => {
    const csv = 'דוח תנועות\nתאריך,הפעולה,חובה,זכות,יתרה\n01/10/2026,העברה מלקוח,,2400,5000\n02/10/2026,חברת החשמל,350,,4650\n';
    const r = await parseStatement('a.csv', Buffer.from(csv), 'bank');
    expect(r.txns).toEqual([
      { date: '2026-10-01', amount: 2400, description: 'העברה מלקוח', installmentNumber: undefined, installmentTotal: undefined },
      { date: '2026-10-02', amount: -350, description: 'חברת החשמל', installmentNumber: undefined, installmentTotal: undefined },
    ]);
  });

  it('reads an HTML "xls" card export and flips the sign', async () => {
    const html = `<table><tr><td>תאריך רכישה</td><td>שם בית העסק</td><td>סכום חיוב</td><td>פירוט נוסף</td></tr>
      <tr><td>03/10/2026</td><td>שופרסל</td><td>120.50</td><td></td></tr>
      <tr><td>04/10/2026</td><td>מחסני חשמל</td><td>300</td><td>תשלום 2 מתוך 6</td></tr></table>`;
    const r = await parseStatement('b.xls', Buffer.from(html), 'card');
    expect(r.txns.map((t) => [t.amount, t.installmentNumber, t.installmentTotal])).toEqual([
      [-120.5, undefined, undefined],
      [-300, 2, 6],
    ]);
  });

  it('reads an xlsx with a title row above the headers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['פירוט עסקאות']);
    ws.addRow(['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב']);
    ws.addRow([new Date(Date.UTC(2026, 9, 7)), 'NETFLIX', 49.9, 49.9]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseStatement('c.xlsx', buf, 'card');
    expect(r.txns).toHaveLength(1);
    expect(r.txns[0]).toMatchObject({ date: '2026-10-07', amount: -49.9, description: 'NETFLIX' });
  });
});

describe('sign-aware rules and internal transfers', () => {
  it('treats incoming Bituach Leumi child allowance as income', () => {
    const r = cat.categorize({ description: 'קצבת ילדים ביטוח לאומי', amount: 520, accountKind: 'bank', accountScope: 'private' });
    expect(slugOf(r.categoryId)).toBe('income_child_allowance');
    const out = cat.categorize({ description: 'ביטוח לאומי', amount: -900, accountKind: 'bank', accountScope: 'business' });
    expect(slugOf(out.categoryId)).toBe('bituach_leumi');
  });

  it('pairs owner pay from the business account with the deposit at home', async () => {
    const { linkInternalTransfers } = await import('../src/ingest.js');
    const biz = account('bank', 'business', 'biz');
    const home = account('bank', 'private', 'home');
    ingestTransactions(db, cat, biz, [{ date: '2026-10-03', amount: -6000, description: 'העברה לחשבון' }], 'import');
    ingestTransactions(db, cat, home, [{ date: '2026-10-04', amount: 6000, description: 'העברה מחשבון' }], 'import');
    expect(linkInternalTransfers(db, cat)).toBe(1);
    const s = monthSummary(db, '2026-10');
    expect(s.income).toBe(0);
    expect(s.expenses).toBe(0);
  });
});
