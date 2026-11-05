import type { DB } from './db.js';
import { merchantKey, normalize } from './categorize.js';

// Suggestions that tidy up categorization without sending anything outside the
// computer. Two sources: a lexicon of what a merchant name usually means
// ("קצב" is a butcher, so food) and the user's own choices (a word that
// always went to one category before probably goes there again).

interface LexEntry {
  slug: string;
  words: string[];
  why: string;
  // Prefix match: "ירק" catches "ירקות", "הירק". Plain entries match whole words.
  prefix?: boolean;
}

const LEXICON: LexEntry[] = [
  { slug: 'food', why: 'שם של קצביה, ירקן, מאפייה או מכולת', prefix: true, words: ['קצב', 'אטליז', 'בשר', 'עוף', 'עופות', 'ירק', 'פירות', 'פרי', 'מאפ', 'לחם', 'חלות', 'מכולת', 'מרכול', 'מרקט', 'סופר', 'שוק', 'דגים', 'מעדני', 'גרעיני', 'פיצוח', 'תבלינ', 'חלבי', 'ממתק', 'מתוק', 'שוקולד', 'יינות', 'קונדיטור'] },
  { slug: 'leisure', why: 'שם של מסעדה, פיצרייה, בית קפה או אוכל בחוץ', prefix: true, words: ['פיצ', 'פלאפל', 'שווארמ', 'שוארמ', 'סטקי', 'המבורג', 'בורגר', 'מסעד', 'קפה', 'גלידה', 'סושי', 'שניצל', 'מזנון', 'ביסטרו', 'גריל', 'בייגל', 'טוסט', 'ארומה', 'רולדין', 'מקדונלד', 'דומינו', 'WOLT', 'TENBIS', 'תן ביס', 'סיבוס', 'CIBUS'] },
  { slug: 'shopping', why: 'שם של חנות כללית, קניון או אתר קניות', prefix: true, words: ['קניון', 'מינסו', 'מיניסו', 'MINISO', 'מקס סטוק', 'MAX STOCK', 'ALIEXPRESS', 'AMAZON', 'איקאה', 'IKEA', 'כלי בית', 'אלקטר', 'KSP', 'באג', 'מחסני חשמל', 'שקם'] },
  { slug: 'clothing', why: 'שם של חנות בגדים או נעליים', prefix: true, words: ['בגד', 'אופנ', 'הנעל', 'נעל', 'גרבי', 'חליפ', 'כובע', 'FOX', 'CASTRO', 'ZARA', 'H&M', 'TERMINAL X', 'גולף', 'SHEIN', 'שילב', 'מגפי'] },
  { slug: 'education', why: 'שם של מוסד לימודים, ספרים או ציוד לימודי', prefix: true, words: ['תלמוד', 'ישיבת', 'כולל', 'סמינר', 'גן ילדים', 'גני ילדים', 'מעון', 'צהרון', 'מחברות', 'כלי כתיבה', 'ציוד משרדי', 'חוג'] },
  { slug: 'health', why: 'שם של בית מרקחת, מרפאה או אופטיקה', prefix: true, words: ['פארם', 'מרקחת', 'אופטיק', 'משקפ', 'מרפא', 'רופא', 'קליני', 'פיזיו', 'קופת חולים', 'מכבי', 'כללית', 'מאוחדת', 'לאומית'] },
  { slug: 'dental', why: 'שם של מרפאת שיניים', prefix: true, words: ['שיניים', 'אורתודונט', 'דנטל', 'DENTAL'] },
  { slug: 'kids', why: 'צעצועים או חוגים לילדים', prefix: true, words: ['צעצוע', 'טויס', 'TOYS', 'קידס', 'משחקי'] },
  { slug: 'judaica', why: 'ספרים או תשמישי קדושה', prefix: true, words: ['ספרי', 'ספרים', 'יודאיקה', 'תשמישי', 'סת"ם', 'מזוז', 'תפילין', 'טלית'] },
  { slug: 'gifts', why: 'חנות מתנות', prefix: true, words: ['מתנ', 'GIFT'] },
  { slug: 'gym', why: 'מכון כושר או ספורט', prefix: true, words: ['כושר', 'גרייט שייפ', 'GREAT SHAPE', 'FITNESS', 'GYM', 'בריכה', 'קאנטרי'] },
  { slug: 'grooming', why: 'מספרה או טיפוח', prefix: true, words: ['מספר', 'ברבר', 'BARBER'] },
  { slug: 'transport', why: 'חניה, תחבורה ציבורית או מונית', prefix: true, words: ['חני', 'פנגו', 'PANGO', 'סלופארק', 'CELLOPARK', 'מוני', 'GETT', 'אגד', 'רב קו', 'רכבת', 'כביש 6', 'החברה הכלכלית'] },
  { slug: 'fuel', why: 'שם של תחנת דלק', prefix: true, words: ['סונול', 'דלק', 'פז ', 'דור אלון', 'TEN', 'תן דלק', 'YELLOW'] },
  { slug: 'car', why: 'מוסך, צמיגים או טסט', prefix: true, words: ['מוסך', 'צמיג', 'טסט', 'רישוי', 'שמשות', 'פנצ'] },
  { slug: 'telecom', why: 'אינטרנט, סינון או טלפון', prefix: true, words: ['נטפרי', 'NETFREE', 'רימון', 'בזק', 'פרטנר', 'סלקום', 'פלאפון', 'הוט', 'גולן טלקום', 'אקספון', 'מובייל'] },
  { slug: 'subscriptions', why: 'מנוי דיגיטלי או אפליקציה', prefix: true, words: ['SPOTIFY', 'APPLE', 'ITUNES', 'GOOGLE', 'ICLOUD', 'MICROSOFT', 'DROPBOX', 'NETFLIX', 'YOUTUBE'] },
  { slug: 'charity', why: 'שם של מוסד צדקה או ארגון חסד', prefix: true, words: ['צדקה', 'קופת העיר', 'קופת רבי מאיר', 'ועד הרבנים', 'מעשר', 'תרומ', 'חסד', 'עזר מציון', 'יד שרה', 'איחוד הצלה', 'זק"א'] },
  { slug: 'holidays', why: 'קניות לחג', prefix: true, words: ['ארבעת המינים', 'סוכ', 'מצות', 'משלוח מנות', 'נרות', 'יודאיקה', 'חנוכי'] },
  { slug: 'celebrations', why: 'אולם, קייטרינג, צלם או מתנות', prefix: true, words: ['אולם', 'אולמי', 'קייטרינג', 'צלם', 'הזמנות', 'שמחות', 'פרחי'] },
  { slug: 'home_repairs', why: 'חומרי בניין, תיקונים או כלי עבודה', prefix: true, words: ['חומרי בני', 'אינסטל', 'חשמלאי', 'טמבור', 'צבע', 'ACE', 'הום סנטר', 'מנעולן', 'זגג', 'נגר', 'מיזוג', 'כלי עבודה'] },
  { slug: 'vacation', why: 'מלון, צימר או נופש', prefix: true, words: ['מלון', 'צימר', 'נופש', 'HOTEL', 'BOOKING', 'אירבנב', 'AIRBNB'] },
  { slug: 'insurance', why: 'חברת ביטוח', prefix: true, words: ['ביטוח'] },
  { slug: 'gas', why: 'חברת גז', prefix: true, words: ['גז ', 'אמישראגז', 'פזגז', 'סופרגז'] },
  { slug: 'biz_marketing', why: 'חיוב פרסום (פייסבוק/גוגל)', prefix: true, words: ['ADS', 'FACEBK', 'FACEBOOK', 'META ', 'GOOGLE ADS', 'פרסום'] },
  { slug: 'biz_software', why: 'תוכנה לעבודה', prefix: true, words: ['ADOBE', 'CANVA', 'FIGMA', 'WIX', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE', 'ZOOM', 'NOTION', 'MONDAY', 'GODADDY'] },
  { slug: 'income_tax', why: 'מס שנוכה במקור (בדרך כלל על ריבית או רווח)', prefix: true, words: ['מס במקור', 'ניכוי מס'] },
  { slug: 'interest', why: 'עמלה או ריבית של הבנק', prefix: true, words: ['עמלת', 'עמלה', 'ריבית', 'דמי ניהול חשבון'] },
  { slug: 'cash_withdrawal', why: 'משיכת מזומן', prefix: true, words: ['כספומט', 'משיכת מזומן', 'משיכה מכספומט', 'ATM'] },
  { slug: 'pension', why: 'קרן פנסיה, גמל או השתלמות', prefix: true, words: ['פנסי', 'גמל', 'השתלמות', 'מיטב', 'אלטשולר', 'מור גמל', 'אנליסט', 'ילין'] },
];

// Words that say nothing about what a place sells.
const STOP = new Set(['בע"מ', 'בעמ', 'בע', 'מ', 'סניף', 'בני', 'ברק', 'ירושלים', 'תל', 'אביב', 'רמת', 'גן', 'אשדוד', 'בית', 'שמש', 'אלעד', 'ביתר', 'עילית', 'מודיעין', 'חיפה', 'פתח', 'תקווה', 'רחוב', 'רח', 'קניון', 'בעיר', 'ישראל', 'השקמה', 'בעמ.', 'LTD', 'IL', 'ISRAEL', 'TEL', 'AVIV', 'COM', 'WWW', 'ה', 'של', 'את', 'ו']);

export interface CategorySuggestion {
  key: string;
  description: string;
  ids: number[];
  count: number;
  total: number;
  categoryId: number;
  categoryName: string;
  reason: string;
  confidence: 'high' | 'medium';
}

interface Row {
  id: number;
  description: string;
  amount: number;
  category_id: number | null;
  slug: string | null;
}

function words(description: string): string[] {
  return normalize(description)
    .replace(/\d+/g, ' ')
    .replace(/["']/g, '')
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function lexiconMatch(description: string): { slug: string; why: string; hit: string } | null {
  const text = ` ${normalize(description).replace(/["']/g, '')} `;
  const tokens = text.trim().split(' ');
  for (const e of LEXICON) {
    for (const w of e.words) {
      const n = normalize(w).replace(/["']/g, '');
      if (!n) continue;
      const hit = n.includes(' ') || w.endsWith(' ')
        ? text.includes(` ${n} `) || text.includes(` ${n}`)
        : tokens.some((t) => (e.prefix ? t.startsWith(n) || (/^[הלבומש]/.test(t) && t.slice(1).startsWith(n)) : t === n));
      // Short Latin words ("TEN", "ADS") only count as a whole word or a code like ADS503….
      if (hit && /^[A-Z]{2,4}$/.test(n) && !tokens.some((t) => t === n || new RegExp(`^${n}\\d`).test(t))) continue;
      if (hit) return { slug: e.slug, why: e.why, hit: w.trim() };
    }
  }
  return null;
}

export function categorySuggestions(db: DB): CategorySuggestion[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.description, t.amount, t.category_id, c.slug
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id`,
    )
    .all() as unknown as Row[];
  const cats = new Map(
    (db.prepare('SELECT id, slug, name, kind FROM categories').all() as { id: number; slug: string | null; name: string; kind: string }[]).map((c) => [c.id, c]),
  );
  const bySlug = new Map([...cats.values()].filter((c) => c.slug).map((c) => [c.slug!, c]));
  const isOpen = (r: Row) => r.category_id === null || r.slug === 'uncategorized';

  // What each word has meant so far in the user's own categorization.
  const learned = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (isOpen(r) || r.amount >= 0) continue;
    const c = cats.get(r.category_id!);
    if (!c || c.kind !== 'expense') continue;
    for (const w of new Set(words(r.description))) {
      const m = learned.get(w) ?? new Map<number, number>();
      m.set(r.category_id!, (m.get(r.category_id!) ?? 0) + 1);
      learned.set(w, m);
    }
  }

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!isOpen(r) || r.amount >= 0) continue;
    const k = merchantKey(r.description) || r.description;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const out: CategorySuggestion[] = [];
  for (const [key, list] of groups) {
    const description = list[0].description;
    const base = { key, description, ids: list.map((r) => r.id), count: list.length, total: Math.round(list.reduce((s, r) => s - r.amount, 0) * 100) / 100 };

    // The user's own history first: it knows this family better than any list.
    let best: { categoryId: number; n: number; share: number; word: string } | null = null;
    for (const w of words(description)) {
      const m = learned.get(w);
      if (!m) continue;
      const total = [...m.values()].reduce((s, n) => s + n, 0);
      const [categoryId, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n >= 2 && n / total >= 0.8 && (!best || n > best.n)) best = { categoryId, n, share: n / total, word: w };
    }
    if (best) {
      const c = cats.get(best.categoryId)!;
      out.push({ ...base, categoryId: c.id, categoryName: c.name, reason: `המילה "${best.word}" הופיעה ב-${best.n} תנועות שסיווגת ל${c.name}`, confidence: best.share === 1 && best.n >= 3 ? 'high' : 'medium' });
      continue;
    }

    const lex = lexiconMatch(description);
    const c = lex && bySlug.get(lex.slug);
    if (lex && c) out.push({ ...base, categoryId: c.id, categoryName: c.name, reason: `"${lex.hit}" – ${lex.why}`, confidence: 'medium' });
  }
  return out.sort((a, b) => b.total - a.total);
}

// ---------- tidying the category list ----------

export interface CategoryCleanup {
  kind: 'merge' | 'regroup' | 'unused';
  categoryId: number;
  categoryName: string;
  txnCount: number;
  total: number;
  intoId?: number;
  intoName?: string;
  grp?: string;
  reason: string;
}

export function categoryCleanups(db: DB, today: string): CategoryCleanup[] {
  const since = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
  const cats = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.grp, c.kind,
         (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.date >= ?) AS n,
         (SELECT COALESCE(SUM(-t.amount), 0) FROM transactions t WHERE t.category_id = c.id AND t.date >= ?) AS total,
         (SELECT COUNT(*) FROM funds f WHERE f.category_id = c.id) AS funds
       FROM categories c`,
    )
    .all(since, since) as { id: number; slug: string | null; name: string; grp: string; kind: string; n: number; total: number; funds: number }[];
  const bySlug = new Map(cats.filter((c) => c.slug).map((c) => [c.slug!, c]));
  const out: CategoryCleanup[] = [];

  for (const c of cats) {
    if (c.slug || c.kind !== 'expense') continue; // built-ins stay; they anchor the reports
    const base = { categoryId: c.id, categoryName: c.name, txnCount: c.n, total: Math.round(c.total) };
    const lex = lexiconMatch(c.name);
    const twin = lex ? bySlug.get(lex.slug) : undefined;
    const sameName = cats.find((o) => o.id !== c.id && o.kind === 'expense' && (o.name.includes(c.name) || c.name.includes(o.name)));

    if (c.n === 0 && c.funds === 0) {
      out.push({ ...base, kind: 'unused', reason: 'לא הייתה בה אף תנועה בשנה האחרונה.' });
    } else if (sameName) {
      out.push({ ...base, kind: 'merge', intoId: sameName.id, intoName: sameName.name, reason: `השם דומה ל"${sameName.name}" – כנראה אותו דבר בשתי קטגוריות.` });
    } else if (twin && c.n <= 3 && c.total < 500) {
      out.push({ ...base, kind: 'merge', intoId: twin.id, intoName: twin.name, reason: `רק ${c.n} תנועות בשנה, ו"${lex!.hit}" שייך בדרך כלל ל${twin.name}. קטגוריה קטנה מפזרת את התמונה.` });
    } else if (twin && c.grp !== twin.grp) {
      out.push({ ...base, kind: 'regroup', grp: twin.grp, intoId: twin.id, intoName: twin.name, reason: `נמצאת ב"${c.grp}". לפי השם היא שייכת ל"${twin.grp}" (כמו ${twin.name}) – כך היא תיספר במקום הנכון בגרפים.` });
    }
  }

  return out;
}
