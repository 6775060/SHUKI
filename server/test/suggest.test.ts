import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { Categorizer } from '../src/categorize.js';
import { ingestTransactions, upsertAccount } from '../src/ingest.js';
import { categoryCleanups, categorySuggestions, lexiconMatch } from '../src/suggest.js';

describe('lexicon', () => {
  it.each([
    ['חרדים לקצב', 'food'],
    ['עולם הירק הירוק', 'food'],
    ['חלומות מתוקים', 'food'],
    ['גרעיני עפולה', 'food'],
    ['סטקית עמרם', 'leisure'],
    ['קניון רפאלי', 'shopping'],
    ['מיניסו - קניון איילון', 'shopping'],
    ['תמנון - ויטה רמת גן', undefined],
    ['ADS5031283215', 'biz_marketing'],
    ['תשלום מס במקור', 'income_tax'],
    ['נטפרי', 'telecom'],
    ['החברה הכלכלית לבני ב', 'transport'],
  ])('%s → %s', (name, slug) => {
    expect(lexiconMatch(name)?.slug).toBe(slug);
  });

  it('does not guess for names that say nothing', () => {
    expect(lexiconMatch('התחנה')).toBeNull();
    expect(lexiconMatch('TENNIS CLUB')).toBeNull();
  });
});

describe('suggestions', () => {
  it('learns from what the user already categorized, and tidies small categories', () => {
    const db = openDb('', ':memory:');
    const cat = new Categorizer(db);
    const acc = upsertAccount(db, { connectionId: null, kind: 'card', companyId: 'max', accountNumber: '1', label: 'מקס', defaultScope: 'private' });
    ingestTransactions(db, cat, acc, [
      { date: '2026-06-01', amount: -50, description: 'בית עמנואל סניף 1' },
      { date: '2026-06-02', amount: -60, description: 'בית עמנואל סניף 2' },
      { date: '2026-06-03', amount: -18, description: 'מפעלי עמנואל' },
      { date: '2026-06-04', amount: -85, description: 'חרדים לקצב' },
    ], 'import');
    const food = (db.prepare("SELECT id FROM categories WHERE slug = 'food'").get() as { id: number }).id;
    db.prepare("UPDATE transactions SET category_id = ?, category_locked = 1 WHERE description LIKE 'בית עמנואל%'").run(food);
    db.prepare("UPDATE transactions SET category_id = (SELECT id FROM categories WHERE slug = 'uncategorized') WHERE description NOT LIKE 'בית עמנואל%'").run();

    const s = categorySuggestions(db);
    expect(s.find((x) => x.description === 'מפעלי עמנואל')).toMatchObject({ categoryId: food });
    expect(s.find((x) => x.description === 'חרדים לקצב')).toMatchObject({ categoryId: food });

    db.prepare("INSERT INTO categories (name, grp, kind) VALUES ('פיצה של שישי', 'הקטגוריות שלי', 'expense')").run();
    db.prepare("INSERT INTO categories (name, grp, kind) VALUES ('ריק', 'הקטגוריות שלי', 'expense')").run();
    const pizza = (db.prepare("SELECT id FROM categories WHERE name = 'פיצה של שישי'").get() as { id: number }).id;
    for (let i = 0; i < 6; i++) ingestTransactions(db, cat, acc, [{ date: `2026-0${i + 1}-15`, amount: -100, description: `פיצה שמש ${i}` }], 'import');
    db.prepare("UPDATE transactions SET category_id = ? WHERE description LIKE 'פיצה שמש%'").run(pizza);
    const c = categoryCleanups(db, '2026-07-01');
    expect(c.find((x) => x.categoryName === 'פיצה של שישי')).toMatchObject({ kind: 'regroup', grp: 'איכות חיים' });
    expect(c.find((x) => x.categoryName === 'ריק')?.kind).toBe('unused');
  });
});
