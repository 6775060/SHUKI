import { useState } from 'react';
import type { InsightsData, Summary } from '../api';
import { currentMonth, date, money, monthLabel } from '../format';
import { Donut, Gauge, IncomeExpenseChart, ScoreRing, TableToggle, type Slice } from '../charts';
import type { Nav } from '../App';

// The visual home view: a few shapes instead of many numbers, with the one to
// three things that matter most right now pinned on top. Every shape opens
// the detail behind it.

type Level = 'critical' | 'warning' | 'good' | 'info';

interface Focus {
  level: Level;
  icon: string;
  title: string;
  action: string;
  go?: () => void;
  goLabel?: string;
}

const LEVEL_LABEL: Record<Level, string> = { critical: 'דחוף', warning: 'לתשומת לב', good: 'מצוין', info: 'הצעד הבא' };

export function buildFocus(d: InsightsData, s: Summary, nav: Nav): Focus[] {
  const out: Focus[] = [];
  const cy = d.cycle;
  const home = s.balances.filter((b) => b.kind === 'bank').reduce((sum, b) => sum + (b.balance ?? 0), 0);

  const stale = d.syncAlerts.filter((a) => a.level === 'critical');
  if (stale.length) {
    out.push({
      level: 'critical',
      icon: '🔌',
      title: stale.length === 1 ? stale[0].title : `חסר סנכרון מ-${stale.map((a) => a.source).join(', ')}`,
      action: `${stale.length === 1 ? stale[0].action : 'כמה מקורות לא התעדכנו.'} עד אז המספרים כאן חלקיים.`,
      go: () => nav.go(stale[0].page),
      goLabel: 'לטיפול',
    });
  }

  if (d.forecast?.firstNegative) {
    out.push({
      level: 'critical',
      icon: '🧭',
      title: `היתרה עלולה לרדת למינוס בסביבות ${date(d.forecast.firstNegative).slice(0, 5)}`,
      action: 'עכשיו, כשרואים מראש: להקדים גבייה מלקוח, או לדחות הוצאה גדולה לחודש הבא.',
      go: () => nav.go('dashboard', { view: 'detail' }),
      goLabel: 'לתחזית',
    });
  }

  for (const c of d.cards) {
    if (c.nextDate && c.daysUntil !== null && c.daysUntil <= 7 && c.amount > home * 0.8) {
      out.push({
        level: 'critical',
        icon: '💳',
        title: `${c.label}: חיוב ${money(c.amount)} בעוד ${c.daysUntil} ימים`,
        action: `בחשבונות יש ${money(home)}. כדאי לוודא שיש כיסוי לפני ${date(c.nextDate).slice(0, 5)}.`,
      });
    }
  }

  if (cy && cy.forecastEnd < 0) {
    out.push({
      level: cy.forecastEnd < -cy.income.expected * 0.1 ? 'critical' : 'warning',
      icon: '📉',
      title: `החודש צפוי להיגמר ב-${money(-cy.forecastEnd)} מינוס`,
      action: `הצעד: להחזיק את ההוצאות המשתנות על ${money(Math.max(0, cy.week.budget))} השבוע. הקבועות והקופות כבר בחשבון.`,
      go: () => nav.go('transactions', { month: d.month }),
      goLabel: 'לאן הולך הכסף',
    });
  }

  if (cy && cy.week.left < 0) {
    out.push({
      level: 'warning',
      icon: '🛒',
      title: `השבוע יצאו ${money(-cy.week.left)} מעבר לתקציב`,
      action: 'עד מוצאי שבת רק הכרחי. ביום ראשון מתחיל שבוע חדש ונקי – בלי חוב מהשבוע הזה.',
    });
  }

  if (d.funds.length === 0) {
    out.push({
      level: 'info',
      icon: '🏺',
      title: 'להגדיר קופות להוצאות שנתיות',
      action: 'ארנונה, חגים, שיניים – קצת כל חודש, וההוצאה מגיעה כשהיא כבר מתוכננת.',
      go: () => nav.go('funds'),
      goLabel: 'לקופות',
    });
  }

  if (d.reviews?.n) {
    const old = d.reviews.oldest ? Math.round((Date.now() - Date.parse(`${d.reviews.oldest.replace(' ', 'T')}Z`)) / 86400000) : 0;
    out.push({
      level: old > 14 ? 'warning' : 'info',
      icon: '❓',
      title: `${d.reviews.n} חיובים מחכים לבירור (${money(d.reviews.total)})`,
      action: old > 14 ? `הוותיק שבהם מחכה ${old} ימים. לבירור עסקה יש מועד אחרון – כדאי לסגור השבוע.` : 'כשיש עשר דקות פנויות – לעבור עליהם עם הרמזים שבלשונית.',
      go: () => nav.go('reviews'),
      goLabel: 'לבירורים',
    });
  }

  const attention = d.insights.find((i) => i.tone === 'attention' && !/מינוס/.test(i.title));
  if (attention) out.push({ level: 'warning', icon: attention.icon, title: attention.title, action: attention.body });

  if (!out.some((f) => f.level === 'critical' || f.level === 'warning')) {
    out.unshift({
      level: 'good',
      icon: '🌤️',
      title: cy ? `הכול מכוסה. השבוע נשארו ${money(Math.max(0, cy.week.left))}` : 'החודש מאוזן',
      action: cy && cy.week.joy > 0 ? `כולל ${money(cy.week.joy)} לשמחות קטנות. אפשר ליהנות בלב שלם.` : 'ההשתדלות עובדת. להמשיך כך.',
    });
  }

  const rank: Record<Level, number> = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 3);
}

const GROUP_HINT: Record<string, string> = {
  'קבועות חיוניות': 'חשבונות שחוזרים כל חודש ואי אפשר בלעדיהם – דיור, ארנונה, חשמל, מים, ביטוחים, תקשורת.',
  'משתנות חיוניות': 'צרכים שהסכום שלהם משתנה מחודש לחודש – אוכל, בריאות, חינוך, תחבורה.',
  'איכות חיים': 'מה שמשמח ולא הכרחי – בילויים, מסעדות, מנויים, קניות כלליות.',
  'הוצאות שנתיות': 'הוצאות שבאות פעם או פעמיים בשנה – חגים, שמחות, ביגוד, חופשות, תיקונים.',
  'חובות': 'החזרי הלוואות, ריבית ועמלות מינוס.',
  'נתינה': 'מעשר וצדקה.',
  'מסים': 'מע"מ, מקדמות מס הכנסה וביטוח לאומי.',
  'חיסכון ונכסים': 'פנסיה, גמל, השתלמות וחיסכון.',
  'הקטגוריות שלי': 'קטגוריות שיצרת בעצמך.',
};

const SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'];

export function VisualDashboard({ d, s, nav, onDetail }: { d: InsightsData; s: Summary; nav: Nav; onDetail: () => void }) {
  const focus = buildFocus(d, s, nav);
  const cy = d.cycle;

  // Where this month's income goes.
  const flow: Slice[] = cy
    ? [
        { key: 'fixed', label: 'חשבונות קבועים', value: cy.fixed.monthly, cls: 'slot-1' },
        { key: 'inst', label: 'תשלומים באשראי', value: cy.installments, cls: 'slot-2' },
        { key: 'funds', label: 'הפרשה לקופות', value: cy.funds, cls: 'slot-3', onClick: () => nav.go('funds') },
        { key: 'var', label: 'שוטף: אוכל, קניות, דלק', value: cy.projectedVariable, cls: 'slot-4', onClick: () => nav.go('transactions', { month: d.month }) },
        { key: 'joy', label: 'שמחות קטנות', value: cy.joy, cls: 'slot-5' },
        { key: 'free', label: 'יישאר פנוי', value: Math.max(0, cy.forecastEnd), cls: 'slot-free' },
      ].filter((x) => x.value > 0)
    : [];

  // What the money went on, by group: top five, the rest folded into "other".
  const groups = new Map<string, { total: number; topId: number; topTotal: number }>();
  for (const c of d.categories) {
    if (c.total <= 0) continue;
    const g = groups.get(c.grp) ?? { total: 0, topId: c.categoryId, topTotal: 0 };
    g.total += c.total;
    if (c.total > g.topTotal) {
      g.topId = c.categoryId;
      g.topTotal = c.total;
    }
    groups.set(c.grp, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
  const spend: Slice[] = sorted.slice(0, 5).map(([name, g], i) => ({
    key: name,
    label: name,
    value: Math.round(g.total),
    cls: SLOTS[i],
    onClick: () => nav.go('transactions', { month: d.month, categoryId: String(g.topId) }),
  }));
  const rest = sorted.slice(5).reduce((sum, [, g]) => sum + g.total, 0);
  if (rest > 0) spend.push({ key: 'other', label: 'אחר', value: Math.round(rest), cls: 'slot-other' });
  const spendTotal = spend.reduce((sum, x) => sum + x.value, 0);

  const weekTone = !cy ? 'ok' : cy.week.left < 0 ? 'over' : cy.week.spent > cy.week.budget * 0.8 ? 'warn' : 'ok';
  const weakest = d.health ? [...d.health.parts].sort((a, b) => a.score - b.score).slice(0, 2) : [];

  const lights: { label: string; level: Level; text: string }[] = [];
  const syncIssues = d.syncAlerts.filter((a) => a.level !== 'info');
  lights.push({
    label: 'סנכרון',
    level: syncIssues.some((a) => a.level === 'critical') ? 'critical' : syncIssues.length ? 'warning' : 'good',
    text: syncIssues.length ? `${syncIssues.length} ${syncIssues.length === 1 ? 'מקור חסר' : 'מקורות חסרים'}` : 'הכול מעודכן',
  });
  if (cy) lights.push({ label: 'החודש התזרימי', level: cy.forecastEnd >= 0 ? 'good' : cy.forecastEnd > -cy.income.expected * 0.1 ? 'warning' : 'critical', text: cy.forecastEnd >= 0 ? 'בפלוס' : 'צפי מינוס' });
  if (d.forecast) lights.push({ label: '60 הימים הבאים', level: d.forecast.firstNegative ? 'critical' : 'good', text: d.forecast.firstNegative ? 'נקודת מינוס' : 'בלי מינוס' });
  const buffer = d.health?.parts.find((p) => p.key === 'buffer');
  if (buffer) lights.push({ label: 'כרית ביטחון', level: buffer.score >= 70 ? 'good' : buffer.score >= 40 ? 'warning' : 'critical', text: buffer.score >= 70 ? 'יציבה' : 'בבנייה' });
  lights.push({ label: 'קופות', level: d.funds.length ? 'good' : 'warning', text: d.funds.length ? `${d.funds.length} פעילות` : 'עוד לא הוגדרו' });
  if (d.uncategorized > 0) lights.push({ label: 'סיווג', level: 'warning', text: `${d.uncategorized} מחכות` });
  if (d.reviews?.n) lights.push({ label: 'לבירור', level: 'warning', text: `${d.reviews.n} פתוחים` });

  return (
    <div className="stack visual">
      <InOutCard d={d} nav={nav} />

      <section aria-label="המיקוד שלך עכשיו">
        <h3 className="section-title">המיקוד שלך עכשיו</h3>
        <div className="focus">
          {focus.map((f, i) => (
            <article key={i} className={`focus-card ${f.level}`}>
              <div className="focus-top">
                <span className="focus-icon" aria-hidden>
                  {f.icon}
                </span>
                <span className={`status-pill ${f.level}`}>
                  <StatusIcon level={f.level} /> {LEVEL_LABEL[f.level]}
                </span>
              </div>
              <h4>{f.title}</h4>
              <p>{f.action}</p>
              {f.go && (
                <button className="link small" onClick={f.go}>
                  {f.goLabel} ←
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="lights" role="list" aria-label="מצב במבט אחד">
        {lights.map((l) => (
          <div key={l.label} className={`light ${l.level}`} role="listitem">
            <StatusIcon level={l.level} />
            <span className="light-label">{l.label}</span>
            <b>{l.text}</b>
          </div>
        ))}
      </div>

      <div className="visual-grid">
        {cy && (
          <section className="card vcard">
            <h3>כמה נשאר להוציא השבוע</h3>
            <p className="vcard-sub">תקציב לשוטף (אוכל, קניות, דלק), מחושב כך שהחודש ייגמר בלי מינוס. מתחדש בכל יום ראשון.</p>
            <Gauge used={cy.week.spent} total={cy.week.budget} label="נשארו השבוע" tone={weekTone} />
            <div className="vcard-foot">
              <span>
                יצא {money(cy.week.spent)} מתוך {money(Math.max(0, cy.week.budget))}
              </span>
              {cy.week.joy > 0 && <span className="joy-chip">🥐 {money(cy.week.joy)} לשמחות קטנות</span>}
            </div>
          </section>
        )}

        {cy && flow.length > 0 && (
          <section className="card vcard">
            <h3>התוכנית לכל החודש</h3>
            <p className="vcard-sub">
              כל ההוצאות הצפויות עד סוף החודש – מה שכבר יצא ומה שעוד יבוא – מול הכנסה צפויה של {money(cy.income.expected)}.
            </p>
            <Donut slices={flow} center={money(Math.abs(cy.forecastEnd))} sub={cy.forecastEnd >= 0 ? 'יישאר בסוף החודש' : 'יחסר בסוף החודש'} />
          </section>
        )}

        {spend.length > 0 && (
          <section className="card vcard">
            <h3>מה כבר יצא החודש</h3>
            <p className="vcard-sub">הוצאות הבית בפועל מתחילת החודש (בלי העסק), לפי סוג. לחיצה על סוג מציגה את התנועות.</p>
            <Donut slices={spend} center={money(spendTotal)} sub="יצא עד היום" />
            <details className="vcard-more">
              <summary>מה ההבדל בין הסוגים?</summary>
              <ul>
                {spend
                  .filter((x) => GROUP_HINT[x.key])
                  .map((x) => (
                    <li key={x.key}>
                      <b>{x.label}:</b> {GROUP_HINT[x.key]}
                    </li>
                  ))}
              </ul>
            </details>
          </section>
        )}

        {d.health && (
          <section className="card vcard">
            <h3>מדד היציבות</h3>
            <p className="vcard-sub">ציון 0–100 על כרית ביטחון, יציבות הכנסה, חובות וסדר בנתונים. מעל 70 – יציב.</p>
            <ScoreRing score={d.health.score} size={150} />
            <div className="health-label center-text">{d.health.label}</div>
            <div className="vcard-foot">
              {weakest.map((p) => (
                <span key={p.key} className="chip-soft" title={p.detail}>
                  לחזק: {p.label}
                </span>
              ))}
            </div>
          </section>
        )}

        {d.funds.length > 0 && (
          <section className="card vcard">
            <h3>הקופות שלי</h3>
            <p className="vcard-sub">כסף שמפרישים כל חודש להוצאות שנתיות. הטבעת מראה כמה כבר נוצל השנה מתוך הסכום השנתי.</p>
            <div className="fund-rings">
              {d.funds.slice(0, 6).map((f) => (
                <button key={f.id} className="fund-ring" onClick={() => nav.go('funds')} title={`${f.name}: ${money(f.spentThisYear)} מתוך ${money(f.annualAmount)}`}>
                  <MiniRing frac={f.annualAmount ? f.spentThisYear / f.annualAmount : 0} icon={f.icon ?? '🏺'} />
                  <span className="small">{f.name}</span>
                  <span className="muted small">{money(f.monthly)}/חודש</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {d.cards.length > 0 && (
          <section className="card vcard">
            <h3>חיובי האשראי הבאים</h3>
            <p className="vcard-sub">הסכום שצפוי לרדת מהבנק בחיוב הקרוב של כל כרטיס.</p>
            <div className="card-bars">
              {d.cards.map((c) => {
                const max = Math.max(...d.cards.map((x) => x.amount), 1);
                return (
                  <div key={c.accountId} className="card-bar">
                    <div className="row between small">
                      <span>{c.label}</span>
                      <span className="muted">{c.nextDate ? `בעוד ${c.daysUntil} ימים` : '—'}</span>
                    </div>
                    <div className="card-track">
                      <div className="card-fill" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                    <b>{money(c.amount)}</b>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <div className="detail-cta">
        <button className="ghost" onClick={onDetail}>
          להעמקה: כל הגרפים והמספרים ←
        </button>
      </div>
    </div>
  );
}

type InOutScope = 'all' | 'home' | 'business';

const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
};

// The central picture: what came in against what went out, this month and
// over the last year, for the home, the business or both together.
function InOutCard({ d, nav }: { d: InsightsData; nav: Nav }) {
  const [scope, setScope] = useState<InOutScope>('all');
  const hasBusiness = d.trend.some((p) => p.bizIncome > 0 || p.bizExpenses > 0);
  const pick = (p: InsightsData['trend'][number]) =>
    scope === 'business'
      ? { income: p.bizIncome, expenses: p.bizExpenses }
      : scope === 'home'
        ? { income: p.income - p.bizIncome, expenses: p.expenses - p.bizExpenses }
        : { income: p.income, expenses: p.expenses };

  const firstWithData = d.trend.findIndex((p) => p.income > 0 || p.expenses > 0);
  if (firstWithData < 0) return null;
  const points = d.trend.slice(Math.max(firstWithData, d.trend.length - 12)).map((p) => ({ month: p.month, ...pick(p) }));
  const cur = points.find((p) => p.month === d.month) ?? points[points.length - 1];
  const net = cur.income - cur.expenses;
  const partial = cur.month === currentMonth();
  const before = points.filter((p) => p.month < cur.month && (p.income > 0 || p.expenses > 0)).slice(-3);
  const avg = (key: 'income' | 'expenses') => (before.length ? before.reduce((s, p) => s + p[key], 0) / before.length : null);
  const avgIn = avg('income');
  const avgOut = avg('expenses');
  const yearNet = points.reduce((s, p) => s + p.income - p.expenses, 0);
  const chart = points.map((p) => ({ label: shortMonth(p.month), income: p.income, expenses: p.expenses }));
  const bar = Math.max(cur.income, cur.expenses, 1);

  return (
    <section className="card inout" aria-label="הכנסות מול הוצאות">
      <div className="inout-head">
        <div>
          <h3>הכנסות מול הוצאות</h3>
          <p className="vcard-sub">כל מה שנכנס לחשבונות מול כל מה שיצא מהם, בלי העברות בין החשבונות שלך.</p>
        </div>
        {hasBusiness && (
          <div className="seg-toggle" role="group" aria-label="של מה">
            {(
              [
                ['all', 'הכול'],
                ['home', 'בית'],
                ['business', 'עסק'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={scope === k ? 'on' : ''} aria-pressed={scope === k} onClick={() => setScope(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="inout-body">
        <div className="inout-now">
          <div className="muted small">
            {monthLabel(cur.month)}
            {partial ? ' · עד היום' : ''}
          </div>
          <div className="inout-row">
            <span>נכנס</span>
            <div className="inout-track">
              <div className="inout-fill s1-bg" style={{ width: `${(cur.income / bar) * 100}%` }} />
            </div>
            <b>{money(cur.income)}</b>
          </div>
          <div className="inout-row">
            <span>יצא</span>
            <div className="inout-track">
              <div className="inout-fill s2-bg" style={{ width: `${(cur.expenses / bar) * 100}%` }} />
            </div>
            <b>{money(cur.expenses)}</b>
          </div>
          <div className={`inout-net ${net >= 0 ? 'plus' : 'minus'}`}>
            {net >= 0 ? 'נשאר' : 'יצא יותר ממה שנכנס'} <b>{money(Math.abs(net))}</b>
          </div>
          {(avgIn !== null || avgOut !== null) && (
            <div className="muted small">
              ממוצע 3 החודשים שלפני: נכנס {money(avgIn ?? 0)}, יצא {money(avgOut ?? 0)}
            </div>
          )}
          <div className="muted small">
            ב-{points.length} החודשים האחרונים: {yearNet >= 0 ? 'נשארו' : 'חסרו'} {money(Math.abs(yearNet))}
          </div>
          <button className="link small" onClick={() => nav.go('transactions', { month: cur.month })}>
            לתנועות של החודש ←
          </button>
        </div>

        <div className="inout-chart">
          <TableToggle
            table={
              <table className="data-table">
                <thead>
                  <tr>
                    <th>חודש</th>
                    <th>נכנס</th>
                    <th>יצא</th>
                    <th>הפרש</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.month}>
                      <td>{monthLabel(p.month)}</td>
                      <td>{money(p.income)}</td>
                      <td>{money(p.expenses)}</td>
                      <td>{money(p.income - p.expenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <IncomeExpenseChart data={chart} height={220} />
          </TableToggle>
        </div>
      </div>

      <Ideas d={d} nav={nav} scope={scope} />
    </section>
  );
}

interface Idea {
  key: string;
  icon: string;
  title: string;
  why: string;
  monthly: number | null;
  go?: () => void;
}

const INCOME_TIPS = new Set(['pricing', 'concentration', 'retainer', 'collect', 'ownerpay_low']);
const EXPENSE_TIPS = new Set(['fees', 'margin', 'marketing', 'invoices']);

// Concrete ways to widen the gap: more coming in, less going out. Only ideas
// the numbers actually point to – an empty side says so instead of padding.
export function buildIdeas(d: InsightsData, nav: Nav, scope: InOutScope): { income: Idea[]; expenses: Idea[] } {
  const toBiz = () => nav.go('business', { month: d.month });
  const tip = (t: InsightsData['businessTips'][number]): Idea => ({ key: t.key, icon: t.icon, title: t.title, why: t.why, monthly: t.impact, go: toBiz });
  const biz = scope !== 'home';
  const home = scope !== 'business';

  const income: Idea[] = biz ? d.businessTips.filter((t) => INCOME_TIPS.has(t.key)).map(tip) : [];
  const expenses: Idea[] = biz ? d.businessTips.filter((t) => EXPENSE_TIPS.has(t.key)).map(tip) : [];

  if (home) {
    for (const r of d.recurring) {
      if (r.amount >= 0 || r.isTax || r.scope === 'business') continue;
      const monthly = -r.amount / r.periodMonths;
      if (r.priceChangePct !== null && r.priceChangePct >= 0.05) {
        expenses.push({
          key: `rise-${r.key}`,
          icon: '📈',
          title: `${r.name} התייקר ב-${Math.round(r.priceChangePct * 100)}%`,
          why: `עכשיו ${money(monthly)} בחודש. שיחה לשימור לקוחות או השוואה לחברה אחרת מחזירה לרוב את ההפרש, ולפעמים יותר.`,
          monthly: Math.round(monthly - monthly / (1 + r.priceChangePct)),
        });
      } else if (r.isNew) {
        expenses.push({
          key: `new-${r.key}`,
          icon: '🆕',
          title: `חיוב קבוע חדש: ${r.name}`,
          why: `${money(monthly)} בחודש, ${money(r.annual)} בשנה. אם זה מנוי שנפתח לניסיון – זה הזמן להחליט אם הוא נשאר.`,
          monthly: Math.round(monthly),
        });
      }
    }

    const subs = d.recurring.filter((r) => r.amount < 0 && !r.isTax && r.scope !== 'business' && r.accountKind === 'card' && r.periodMonths === 1);
    if (subs.length >= 4) {
      const annual = subs.reduce((s, r) => s + r.annual, 0);
      expenses.push({
        key: 'subs',
        icon: '🔁',
        title: `${subs.length} חיובים חודשיים קבועים באשראי`,
        why: `יחד ${money(annual / 12)} בחודש (${money(annual)} בשנה). מעבר אחד עליהם בשנה – מה עוד בשימוש – חוסך בדרך כלל אחד או שניים.`,
        monthly: null,
        go: () => nav.go('dashboard', { view: 'detail' }),
      });
    }

    if (d.isCurrent && d.pace.avgFull !== null && d.pace.projected > d.pace.avgFull * 1.1 && d.pace.day >= 7) {
      const over = d.pace.projected - d.pace.avgFull;
      const top = d.categories.filter((c) => c.deltaPct !== null && c.deltaPct > 0.2 && c.total - c.avg > 100).sort((a, b) => b.total - b.avg - (a.total - a.avg))[0];
      expenses.push({
        key: 'pace',
        icon: '🧺',
        title: `בקצב הזה החודש יגיע ל-${money(d.pace.projected)}`,
        why: `כ-${money(over)} יותר מחודש רגיל.${top ? ` הכי בולט: ${top.name} – ${money(top.total)} עד עכשיו, לעומת ${money(top.avg)} בחודש רגיל.` : ''}`,
        monthly: null,
        go: () => nav.go('transactions', { month: d.month, ...(top ? { categoryId: String(top.categoryId) } : {}) }),
      });
    } else {
      const top = d.categories.filter((c) => c.deltaPct !== null && c.deltaPct > 0.25 && c.total - c.avg > 150).sort((a, b) => b.total - b.avg - (a.total - a.avg))[0];
      if (top)
        expenses.push({
          key: 'cat',
          icon: '🔎',
          title: `${top.name}: ${money(top.total - top.avg)} יותר מהרגיל`,
          why: `${money(top.total)} ${d.isCurrent ? 'עד עכשיו' : 'בחודש הזה'}, לעומת ${money(top.avg)} בחודש רגיל. כדאי להציץ בתנועות ולראות אם זה חד-פעמי.`,
          monthly: null,
          go: () => nav.go('transactions', { month: d.month, categoryId: String(top.categoryId) }),
        });
    }
  }

  const byImpact = (a: Idea, b: Idea) => (b.monthly ?? 0) - (a.monthly ?? 0);
  return { income: income.slice(0, 3), expenses: expenses.sort(byImpact).slice(0, 3) };
}

function Ideas({ d, nav, scope }: { d: InsightsData; nav: Nav; scope: InOutScope }) {
  const { income, expenses } = buildIdeas(d, nav, scope);
  const col = (title: string, icon: string, list: Idea[], empty: string) => (
    <div className="ideas-col">
      <h4>
        <span aria-hidden>{icon}</span> {title}
      </h4>
      {list.length === 0 && <p className="muted small">{empty}</p>}
      {list.map((i) => (
        <article key={i.key} className="idea">
          <span className="idea-icon" aria-hidden>
            {i.icon}
          </span>
          <div>
            <div className="idea-title">
              {i.title}
              {i.monthly ? <span className="idea-gain">עד {money(i.monthly)} בחודש</span> : null}
            </div>
            <p className="small">{i.why}</p>
            {i.go && (
              <button className="link small" onClick={i.go}>
                לפרטים ←
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div className="ideas">
      {col('להגדלת ההכנסה', '🌱', income, scope === 'home' ? 'הצעות להגדלת הכנסה מגיעות מנתוני העסק – אפשר לעבור ל"הכול" או ל"עסק".' : 'אין כרגע הצעה שהמספרים מצביעים עליה.')}
      {col('להקטנת ההוצאות', '✂️', expenses, 'לא נמצאה הוצאה שהתייקרה או חרגה מהרגיל. יפה.')}
    </div>
  );
}

function StatusIcon({ level }: { level: Level }) {
  const icon = { critical: '!', warning: '▲', good: '✓', info: 'i' }[level];
  return (
    <span className={`status-icon ${level}`} aria-hidden>
      {icon}
    </span>
  );
}

function MiniRing({ frac, icon }: { frac: number; icon: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, frac));
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden className={frac > 1 ? 'mini-ring over' : 'mini-ring'}>
      <circle cx={32} cy={32} r={r} className="gauge-track" strokeWidth={6} />
      <circle cx={32} cy={32} r={r} className="gauge-fill" strokeWidth={6} strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform="rotate(-90 32 32)" />
      <text x={32} y={38} textAnchor="middle" fontSize={20}>
        {icon}
      </text>
    </svg>
  );
}
