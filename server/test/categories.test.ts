import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { Categorizer, merchantKey } from '../src/categorize.js';
import { ingestTransactions, upsertAccount } from '../src/ingest.js';

let db: DB;
let cat: Categorizer;

beforeEach(() => {
  db = openDb('', ':memory:');
  cat = new Categorizer(db);
});

const slugOf = (id: number) => (db.prepare('SELECT slug FROM categories WHERE id = ?').get(id) as { slug: string | null }).slug;
const card = () => upsertAccount(db, { connectionId: null, kind: 'card', companyId: 't', accountNumber: 'c', label: 'c', defaultScope: 'private' });

describe('new built-in categories', () => {
  it('recognizes a gym', () => {
    const r = cat.categorize({ description: 'הולמס פלייס רמת גן', amount: -289, accountKind: 'card', accountScope: 'private' });
    expect(slugOf(r.categoryId)).toBe('gym');
    expect(slugOf(cat.categorize({ description: 'מכון כושר אנרג׳י', amount: -150, accountKind: 'card', accountScope: 'private' }).categoryId)).toBe('gym');
  });
});

describe('merchant rules', () => {
  it('sends every charge from that business – any branch number – to the chosen category', () => {
    const mine = db.prepare("INSERT INTO categories (name, grp, kind) VALUES ('בריכה של הילדים', 'הקטגוריות שלי', 'expense')").run().lastInsertRowid as number;
    const key = merchantKey('קאנטרי גלים 0123');
    db.prepare("INSERT INTO rules (pattern, category_id, match) VALUES (?, ?, 'merchant')").run(key, mine);
    cat.reload();
    // Without the rule this would be "gym" (קאנטרי); the user's choice wins.
    const r = cat.categorize({ description: 'קאנטרי-גלים 9876', amount: -120, accountKind: 'card', accountScope: 'private' });
    expect(r.categoryId).toBe(mine);
    // A different business is untouched.
    expect(slugOf(cat.categorize({ description: 'קאנטרי אחר', amount: -120, accountKind: 'card', accountScope: 'private' }).categoryId)).toBe('gym');
  });

  it('applies to future transactions on ingest', () => {
    const id = db.prepare("INSERT INTO categories (name, grp, kind) VALUES ('קפה של בוקר', 'הקטגוריות שלי', 'expense')").run().lastInsertRowid as number;
    db.prepare("INSERT INTO rules (pattern, category_id, match) VALUES (?, ?, 'merchant')").run(merchantKey('ארומה תל אביב'), id);
    cat.reload();
    ingestTransactions(db, cat, card(), [{ date: '2026-11-02', amount: -18, description: 'ארומה תל אביב' }], 'scraper');
    expect(db.prepare('SELECT category_id AS c FROM transactions').get()).toEqual({ c: id });
  });
});
