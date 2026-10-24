import { transaction, type DB } from './db.js';

type Kind = 'expense' | 'income' | 'transfer';

interface CategorySeed {
  slug: string;
  name: string;
  grp: string;
  kind: Kind;
  patterns?: string[];
  accountKind?: 'bank' | 'card';
  scope?: 'business';
}

// Groups follow the spec (section 5.3). Patterns are case-insensitive substrings
// of the transaction description; the first matching rule by priority wins.
const SEED: CategorySeed[] = [
  // הכנסות
  { slug: 'income_business', name: 'הכנסה מהעסק', grp: 'הכנסות', kind: 'income' },
  { slug: 'income_child_allowance', name: 'קצבאות ביטוח לאומי', grp: 'הכנסות', kind: 'income', patterns: ['קצבת ילדים', 'ביטוח לאומי קצבה', 'בטוח לאומי-ק'] },
  { slug: 'income_other', name: 'הכנסה אחרת', grp: 'הכנסות', kind: 'income' },

  // קבועות חיוניות
  { slug: 'housing', name: 'דיור (שכירות/משכנתא)', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['משכנתא', 'שכר דירה', 'שכ"ד'] },
  { slug: 'arnona', name: 'ארנונה', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['ארנונה', 'עיריית', 'עירית', 'מועצה מקומית', 'מועצה אזורית'] },
  { slug: 'electricity', name: 'חשמל', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['חברת החשמל', 'חח"י', 'חשמל לישראל'] },
  { slug: 'water', name: 'מים', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['תאגיד מים', 'מי אביבים', 'הגיחון', 'מי שבע', 'מיתב', 'מי רמת גן', 'מי כרמל', 'מי נתניה', 'מי ברק', 'מי בית שמש', 'מי רעננה'] },
  { slug: 'gas', name: 'גז', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['אמישראגז', 'פזגז', 'סופרגז', 'דור גז'] },
  { slug: 'insurance', name: 'ביטוחים', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['ביטוח ישיר', 'הראל ביטוח', 'מגדל ביטוח', 'הפניקס', 'כלל ביטוח', 'מנורה', 'איילון', 'שומרה', 'ליברה', 'AIG', '9 מיליון', 'הכשרה ביטוח'] },
  { slug: 'telecom', name: 'תקשורת', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['בזק', 'פרטנר', 'סלקום', ' הוט ', ' HOT ', 'פלאפון', 'גולן טלקום', ' יס ', 'YES', ' 012 ', ' 019 ', 'רמי לוי תקשורת', 'וואלה מובייל', 'אקספון'] },
  { slug: 'house_committee', name: 'ועד בית', grp: 'קבועות חיוניות', kind: 'expense', patterns: ['ועד בית'] },

  // משתנות חיוניות
  { slug: 'food', name: 'מזון וסופר', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['שופרסל', 'רמי לוי', 'יוחננוף', 'ויקטורי', 'אושר עד', 'יינות ביתן', ' מגה ', 'טיב טעם', 'חצי חינם', 'קשת טעמים', 'פרש מרקט', 'מחסני השוק', 'סופר יהודה', 'סופר ספיר', 'ברכל', 'זול ובגדול', 'AM:PM', 'סופר', 'מכולת', 'ירקות', 'מאפי', 'מאפה', 'קצביה', 'אטליז'] },
  { slug: 'health', name: 'בריאות ותרופות', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['סופר-פארם', 'סופר פארם', 'ניו-פארם', 'ניו פארם', 'בית מרקחת', 'מכבי', 'כללית', 'מאוחדת', 'לאומית שירותי', 'רופא', 'מרפאה'] },
  { slug: 'dental', name: 'שיניים', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['שיניים', 'אורתודונט', 'דנטל', 'DENTAL'] },
  { slug: 'education', name: 'חינוך ילדים', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['תלמוד תורה', 'ת"ת', 'גן ילדים', 'צהרון', 'ישיבה', 'בית ספר', 'חוג'] },
  { slug: 'transport', name: 'תחבורה', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['רב-קו', 'רב קו', 'אגד', ' דן ', 'מוניות', 'GETT', 'גט טקסי', 'רכבת ישראל', 'פנגו', 'סלופארק', 'חניון', 'כביש 6', 'נתיבי איילון'] },
  { slug: 'fuel', name: 'דלק', grp: 'משתנות חיוניות', kind: 'expense', patterns: [' פז ', ' דלק ', 'סונול', 'דור אלון', ' TEN ', 'טן דלק', 'yellow', ' ילו ', 'אלונית'] },
  { slug: 'car', name: 'רכב (טיפולים, טסט)', grp: 'משתנות חיוניות', kind: 'expense', patterns: ['מוסך', 'צמיגים', 'טסט', 'רישוי'] },

  // שנתיות (קופות)
  { slug: 'holidays', name: 'חגים', grp: 'הוצאות שנתיות', kind: 'expense' },
  { slug: 'celebrations', name: 'שמחות ומתנות', grp: 'הוצאות שנתיות', kind: 'expense' },
  { slug: 'clothing', name: 'ביגוד והנעלה', grp: 'הוצאות שנתיות', kind: 'expense', patterns: ['פוקס', 'קסטרו', 'H&M', 'זארה', 'ZARA', 'גולף', 'רנואר', 'שילב', 'נעלי', 'אדידס', 'נייקי'] },
  { slug: 'vacation', name: 'חופשות', grp: 'הוצאות שנתיות', kind: 'expense', patterns: ['מלון', 'צימר', 'BOOKING', 'אל על', 'ישראייר', 'ארקיע'] },
  { slug: 'home_repairs', name: 'בית ותיקונים', grp: 'הוצאות שנתיות', kind: 'expense', patterns: [' ACE ', 'הום סנטר', 'איקאה', 'IKEA', 'טמבור', 'אינסטלטור', 'חשמלאי'] },

  // נתינה
  { slug: 'charity', name: 'מעשר וצדקה', grp: 'נתינה', kind: 'expense', patterns: ['צדקה', 'קופת העיר', 'עזר מציון', 'קופת רבי מאיר', 'ועד הרבנים', 'גמ"ח', 'נדרים פלוס'] },

  // איכות חיים
  { slug: 'leisure', name: 'בילויים ומסעדות', grp: 'איכות חיים', kind: 'expense', patterns: ['מסעדה', 'פיצה', 'קפה', 'גלידה', 'וולט', 'WOLT', 'תן ביס', '10BIS', 'מקדונלד', 'בורגר'] },
  { slug: 'subscriptions', name: 'מנויים ודיגיטל', grp: 'איכות חיים', kind: 'expense', patterns: ['NETFLIX', 'SPOTIFY', 'APPLE.COM', 'GOOGLE', 'AMAZON', 'MICROSOFT', 'ADOBE', 'OPENAI', 'ANTHROPIC', 'CLAUDE'] },
  { slug: 'shopping', name: 'קניות כלליות', grp: 'איכות חיים', kind: 'expense', patterns: ['ALIEXPRESS', 'עלי אקספרס', 'KSP', ' באג ', 'מחסני חשמל', 'שקם אלקטריק', 'מקס סטוק', 'MAX STOCK'] },

  // עסק
  { slug: 'biz_materials', name: 'עסק: חומרים וציוד', grp: 'עסק', kind: 'expense', scope: 'business' },
  { slug: 'biz_marketing', name: 'עסק: שיווק ופרסום', grp: 'עסק', kind: 'expense', scope: 'business', patterns: ['FACEBK', 'FACEBOOK', 'META ADS', 'GOOGLE ADS'] },
  { slug: 'biz_software', name: 'עסק: תוכנות', grp: 'עסק', kind: 'expense', scope: 'business' },
  { slug: 'biz_fees', name: 'עסק: עמלות בנק וסליקה', grp: 'עסק', kind: 'expense', patterns: ['עמלה', 'עמלת', 'דמי ניהול חשבון'] },
  { slug: 'biz_accountant', name: 'עסק: רואה חשבון', grp: 'עסק', kind: 'expense', scope: 'business', patterns: ['רואה חשבון', 'רו"ח'] },
  { slug: 'vat', name: 'מע"מ', grp: 'מסים', kind: 'expense', patterns: ['מע"מ', ' מעמ ', 'מס ערך מוסף'] },
  { slug: 'income_tax', name: 'מס הכנסה (מקדמות)', grp: 'מסים', kind: 'expense', patterns: ['מס הכנסה', 'פקיד שומה'] },
  { slug: 'bituach_leumi', name: 'ביטוח לאומי', grp: 'מסים', kind: 'expense', patterns: ['ביטוח לאומי', 'בטוח לאומי', 'המוסד לביטוח לאומי'] },

  // חובות וחיסכון
  { slug: 'loans', name: 'החזר הלוואות', grp: 'חובות', kind: 'expense', patterns: ['הלוואה', 'החזר הלואה', 'פרעון הלוואה'] },
  { slug: 'interest', name: 'ריבית ועמלות מינוס', grp: 'חובות', kind: 'expense', patterns: ['ריבית חובה', 'ריבית על משיכת יתר'] },
  { slug: 'pension', name: 'פנסיה, גמל והשתלמות', grp: 'חיסכון ונכסים', kind: 'expense', patterns: ['אלטשולר', 'הראל פנסיה', 'הפניקס פנסיה', 'מיטב', 'מור גמל', 'אנליסט', 'ילין לפידות', 'קרן השתלמות', 'קופת גמל'] },
  { slug: 'savings', name: 'חיסכון והשקעות', grp: 'חיסכון ונכסים', kind: 'expense', patterns: ['פיקדון', 'פקדון', 'חיסכון'] },

  // העברות (לא נספרות כהוצאה או כהכנסה)
  { slug: 'card_payment', name: 'חיוב כרטיס אשראי (בבנק)', grp: 'העברות', kind: 'transfer', accountKind: 'bank', patterns: ['ישראכרט', 'מקס איט', 'MAX IT', 'לאומי קארד', 'כרטיסי אשראי', ' כאל', ' ויזה', 'אמריקן אקספרס', 'דיינרס'] },
  { slug: 'internal_transfer', name: 'העברה בין החשבונות שלי', grp: 'העברות', kind: 'transfer' },
  { slug: 'cash_withdrawal', name: 'משיכת מזומן', grp: 'העברות', kind: 'transfer', patterns: ['משיכת מזומן', 'כספומט', 'משיכה מבנקט'] },

  { slug: 'uncategorized', name: 'לא מסווג', grp: 'אחר', kind: 'expense' },
];

export function seedCategoriesAndRules(db: DB): void {
  const insertCat = db.prepare('INSERT INTO categories (slug, name, grp, kind, sort) VALUES (?, ?, ?, ?, ?)');
  const insertRule = db.prepare(
    'INSERT INTO rules (pattern, category_id, scope, account_kind, priority, is_default) VALUES (?, ?, ?, ?, ?, 1)',
  );
  transaction(db, () => {
    SEED.forEach((c, i) => {
      const id = insertCat.run(c.slug, c.name, c.grp, c.kind, i).lastInsertRowid;
      // Rules scoped to an account kind are more specific, so they win.
      const priority = c.accountKind ? 10 : 0;
      for (const p of c.patterns ?? []) insertRule.run(p, id, c.scope ?? null, c.accountKind ?? null, priority);
    });
  });
}
