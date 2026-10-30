import type { DB } from './db.js';
import { categoryComparison, detectRecurring, type Recurring } from './insights.js';
import { savingsView } from './savings.js';

// Expenses worth a conversation: what could come down, roughly by how much,
// and whether it is worth the effort. Savings are rough rules of thumb from
// the Israeli market, labelled as estimates; the effort is what it takes.

export type Worth = 'high' | 'medium' | 'low';

export interface Opportunity {
  key: string;
  icon: string;
  title: string;
  why: string;
  action: string;
  monthly: number; // what it costs now, per month
  saveYearly: number; // estimated saving per year
  effort: string;
  effortHours: number;
  worth: Worth;
}

export interface ExpenseGroup {
  key: string;
  icon: string;
  name: string;
  monthly: number;
  items: { name: string; monthly: number }[];
  note: string;
}

const round = (n: number) => Math.round(n);
const ils = (n: number) => `₪${Math.round(Math.abs(n)).toLocaleString('he-IL')}`;
const monthlyOf = (r: Recurring) => -r.amount / r.periodMonths;

// ₪ saved per hour of effort decides whether it is worth it.
function worthOf(saveYearly: number, hours: number): Worth {
  const perHour = saveYearly / Math.max(hours, 0.1);
  return perHour >= 500 ? 'high' : perHour >= 150 ? 'medium' : 'low';
}

interface Lever {
  icon: string;
  pct: number;
  effort: string;
  hours: number;
  action: (names: string) => string;
}

// Fixed charges that are open to negotiation, and what usually comes off.
const LEVERS: Record<string, Lever> = {
  telecom: {
    icon: '📞',
    pct: 0.3,
    effort: 'שיחה אחת, כ-20 דקות',
    hours: 0.35,
    action: (n) => `להתקשר ל${n}, לבקש את המחיר שמציעים ללקוחות חדשים, ולהגיד שבודקים מעבר. כמעט תמיד יש הנחה.`,
  },
  insurance: {
    icon: '🛡️',
    pct: 0.2,
    effort: 'השוואת הצעות, כשעה וחצי',
    hours: 1.5,
    action: () => 'לבדוק ב"הר הביטוח" שאין כפל, ולבקש שתי הצעות מתחרות לאותו כיסוי. סוכן אחד יכול לעשות את זה בשבילך.',
  },
  electricity: {
    icon: '💡',
    pct: 0.06,
    effort: 'טופס אחד, כ-15 דקות',
    hours: 0.25,
    action: () => 'לעבור לספק חשמל פרטי (למשל סלקום, פרטנר, הוט או אלקטרה פאוור). אותו חשמל ואותו מונה, ו-5% עד 7% הנחה.',
  },
  biz_fees: {
    icon: '💳',
    pct: 0.25,
    effort: 'שתי שיחות, כשעה',
    hours: 1,
    action: () => 'לבקש מהבנק ומחברת הסליקה מסלול עמלות מוזל, ולהזכיר הצעה של מתחרה. בנקים נוטים לוותר כשמבקשים.',
  },
  interest: {
    icon: '🧯',
    pct: 0.6,
    effort: 'פגישה או שיחה עם הבנק, כשעה',
    hours: 1,
    action: () => 'ריבית על מינוס היא מההוצאות היקרות ביותר. לבקש מהבנק להחליף את המינוס בהלוואה בריבית נמוכה, או לבנות כרית קטנה שתמנע אותו.',
  },
};

export function savingOpportunities(db: DB, today: string): { opportunities: Opportunity[]; groups: ExpenseGroup[] } {
  const month = today.slice(0, 7);
  const recurring = detectRecurring(db, today).filter((r) => r.amount < 0 && !r.isTax);
  const out: Opportunity[] = [];

  // Negotiable fixed charges, grouped by kind.
  const bySlug = new Map<string, Recurring[]>();
  for (const r of recurring) {
    if (!r.categorySlug) continue;
    bySlug.set(r.categorySlug, [...(bySlug.get(r.categorySlug) ?? []), r]);
  }
  for (const [slug, lever] of Object.entries(LEVERS)) {
    const items = bySlug.get(slug) ?? [];
    const monthly = items.reduce((s, r) => s + monthlyOf(r), 0);
    if (monthly < 40) continue;
    const save = monthly * 12 * lever.pct;
    const names = items.map((r) => r.name).slice(0, 3).join(', ');
    out.push({
      key: `lever-${slug}`,
      icon: lever.icon,
      title: `${items[0].categoryName ?? slug}: ${ils(monthly)} בחודש`,
      why: `${names}${items.length > 3 ? ' ועוד' : ''}. בדרך כלל אפשר להוריד כ-${Math.round(lever.pct * 100)}%.`,
      action: lever.action(items.length === 1 ? items[0].name : 'כל אחד מהם'),
      monthly: round(monthly),
      saveYearly: round(save),
      effort: lever.effort,
      effortHours: lever.hours,
      worth: worthOf(save, lever.hours),
    });
  }

  // Subscriptions: each one is a yes/no question, answered in minutes.
  for (const r of bySlug.get('subscriptions') ?? []) {
    const monthly = monthlyOf(r);
    if (monthly < 15) continue;
    out.push({
      key: `sub-${r.key}`,
      icon: '🔁',
      title: `${r.name}: ${ils(monthly)} בחודש`,
      why: `${ils(monthly * 12)} בשנה.${r.isNew ? ' מנוי חדש.' : ''} אם לא השתמשת בו החודש, כנראה שאפשר בלי.`,
      action: 'לשאול: השתמשתי בזה החודש? אם לא, לבטל. תמיד אפשר לחזור.',
      monthly: round(monthly),
      saveYearly: round(monthly * 12),
      effort: 'כ-5 דקות',
      effortHours: 0.1,
      worth: worthOf(monthly * 12, 0.1),
    });
  }

  // A price that went up quietly.
  for (const r of recurring.filter((r) => r.priceChangePct && r.priceChangePct >= 0.05 && r.categorySlug !== 'subscriptions')) {
    const monthly = monthlyOf(r);
    const extra = (monthly * r.priceChangePct!) / (1 + r.priceChangePct!);
    if (extra * 12 < 120) continue;
    out.push({
      key: `price-${r.key}`,
      icon: '🏷️',
      title: `${r.name} התייקר ב-${Math.round(r.priceChangePct! * 100)}%`,
      why: `תוספת של כ-${ils(extra)} בחודש, ${ils(extra * 12)} בשנה.`,
      action: 'שיחה קצרה: לשאול למה, ולבקש לחזור למחיר הקודם. הרבה פעמים מסכימים.',
      monthly: round(monthly),
      saveYearly: round(extra * 12),
      effort: 'שיחה אחת, כ-15 דקות',
      effortHours: 0.25,
      worth: worthOf(extra * 12, 0.25),
    });
  }

  // Everyday spending running above its own usual: a habit, so more effort.
  const habits: Record<string, { icon: string; pct: number; action: string }> = {
    leisure: { icon: '🍽️', pct: 0.25, action: 'לקבוע מראש סכום שבועי לבילויים ולמשלוחים, ולהוציא אותו בשמחה, בלי רגשות אשם.' },
    shopping: { icon: '🛍️', pct: 0.25, action: 'כלל 24 השעות: קנייה לא מתוכננת מעל 200 ₪ מחכה יום. מה שעדיין רוצים למחרת, קונים.' },
    food: { icon: '🛒', pct: 0.08, action: 'רשימת קניות לשבוע וקנייה גדולה אחת במקום כמה קטנות. גם השוואת סל בין שתי רשתות עוזרת.' },
  };
  for (const c of categoryComparison(db, month, 'private')) {
    const h = c.slug ? habits[c.slug] : undefined;
    if (!h || c.avg < 300) continue;
    const save = c.avg * 12 * h.pct;
    out.push({
      key: `habit-${c.slug}`,
      icon: h.icon,
      title: `${c.name}: כ-${ils(c.avg)} בחודש`,
      why: `בממוצע. שינוי הרגל קטן מוריד בדרך כלל כ-${Math.round(h.pct * 100)}%.`,
      action: h.action,
      monthly: round(c.avg),
      saveYearly: round(save),
      effort: 'שינוי הרגל, כמה שבועות',
      effortHours: 6,
      worth: worthOf(save, 6),
    });
  }

  // Pension and fund fees above what is common today.
  try {
    const sv = savingsView(db, today);
    if (sv.feeSave >= 300) {
      out.push({
        key: 'pension-fees',
        icon: '🏦',
        title: 'דמי ניהול בפנסיה ובקופות',
        why: `לפי הנתונים בעמוד החסכונות, דמי ניהול סבירים יחסכו כ-${ils(sv.feeSave)} בשנה, ובמצטבר עד הפרישה הרבה יותר.`,
        action: 'שיחה אחת לחברה או לסוכן: לבקש את דמי הניהול שמקבלים היום לקוחות חדשים.',
        monthly: round(sv.feeTotal / 12),
        saveYearly: round(sv.feeSave),
        effort: 'שיחה אחת, כחצי שעה',
        effortHours: 0.5,
        worth: worthOf(sv.feeSave, 0.5),
      });
    }
  } catch {
    /* no savings data */
  }

  const order = { high: 0, medium: 1, low: 2 };
  const opportunities = out.filter((o) => o.saveYearly >= 100).sort((a, b) => order[a.worth] - order[b.worth] || b.saveYearly - a.saveYearly);

  // Similar expenses side by side: several of the same kind are easy to miss.
  const groups: ExpenseGroup[] = [];
  const groupNotes: Record<string, { icon: string; note: string }> = {
    insurance: { icon: '🛡️', note: 'כמה ביטוחים במקביל: כדאי לבדוק ב"הר הביטוח" שאין שני ביטוחים לאותו דבר.' },
    telecom: { icon: '📞', note: 'כמה קווים או חבילות: לפעמים חבילה משפחתית אחת זולה יותר.' },
    subscriptions: { icon: '🔁', note: 'כמה מנויים דיגיטליים: מה מהם באמת בשימוש?' },
    gym: { icon: '🏋️', note: 'כמה מנויי ספורט: כדאי לבדוק מה בשימוש.' },
    loans: { icon: '🧾', note: 'כמה הלוואות: איחוד להלוואה אחת בריבית נמוכה יותר יכול להוריד את ההחזר.' },
    biz_software: { icon: '💻', note: 'כמה תוכנות לעסק: אולי חלקן חופפות.' },
  };
  for (const [slug, items] of bySlug) {
    const g = groupNotes[slug];
    const distinct = new Map<string, number>();
    for (const r of items) distinct.set(r.name, (distinct.get(r.name) ?? 0) + monthlyOf(r));
    if (!g || distinct.size < 2) continue;
    const list = [...distinct].map(([name, monthly]) => ({ name, monthly: round(monthly) })).sort((a, b) => b.monthly - a.monthly);
    groups.push({
      key: slug,
      icon: g.icon,
      name: `${list.length} × ${items[0].categoryName ?? slug}`,
      monthly: round(list.reduce((s, i) => s + i.monthly, 0)),
      items: list,
      note: g.note,
    });
  }
  groups.sort((a, b) => b.monthly - a.monthly);
  return { opportunities, groups };
}
