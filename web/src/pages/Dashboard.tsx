import { useEffect, useState, type FormEvent } from 'react';
import { api, type CycleView, type InsightsData, type Summary } from '../api';
import { currentMonth, date, money, monthLabel } from '../format';
import { CalendarHeat, CategoryCompareChart, ForecastChart, IncomeExpenseChart, Meter, ScoreRing, TableToggle } from '../charts';
import { InsightCards } from './Insights';
import { CalmButton } from './Calm';
import type { Nav } from '../App';
import { VisualDashboard } from './DashboardVisual';
import { CoachFocusCard } from './Coach';
import { SimpleDashboard } from './DashboardSimple';

type View = 'simple' | 'visual' | 'detail';

function savedView(): View {
  try {
    const v = localStorage.getItem('shefa-view2');
    return v === 'detail' || v === 'visual' ? v : 'simple';
  } catch {
    return 'simple';
  }
}

const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
};

export function Dashboard({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<InsightsData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [view, setViewState] = useState<View>((nav.params.view as View) ?? savedView());
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem('shefa-view2', v);
    } catch {
      /* private mode */
    }
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (nav.params.view === 'detail' || nav.params.view === 'visual' || nav.params.view === 'simple') setViewState(nav.params.view);
  }, [nav.params.view]);

  useEffect(() => {
    setLoading(true);
    Promise.all([api<InsightsData>(`/insights?month=${month}`), api<Summary>(`/summary?month=${month}`)])
      .then(([i, s]) => {
        setData(i);
        setSummary(s);
      })
      .finally(() => setLoading(false));
  }, [month, reload]);

  if (!data || !summary) return <div className="muted">טוען…</div>;

  if (summary.months.length === 0) {
    return (
      <section className="card hero-empty">
        <h2>שלום, ברוך הבא 🌱</h2>
        <p>הצעד הראשון הוא לראות. מחברים את פאגי, הפועלים, דיסקונט, מקס וישראכרט – והמערכת תמשוך את התנועות לבד, כל בוקר.</p>
        <button className="primary" onClick={() => nav.go('connections')}>
          לחיבור הבנקים והכרטיסים
        </button>
      </section>
    );
  }

  const months = Array.from(new Set([currentMonth(), ...summary.months])).sort().reverse();
  const cur = data.trend[data.trend.length - 1];
  const firstWithData = data.trend.findIndex((q) => q.income > 0 || q.expenses > 0);
  const trendData = data.trend.slice(Math.max(0, firstWithData)).map((p) => ({ label: shortMonth(p.month), income: p.income, expenses: p.expenses }));
  const bizTips = data.businessTips.filter((t) => t.relevance === 'high').slice(0, 2);
  const homeCats = data.categories.filter((c) => c.total > 0).slice(0, 9);
  const pace = data.pace;
  const paceOver = pace.avgFull !== null && pace.projected > pace.avgFull * 1.05;
  const cy = data.cycle;
  const upcoming = data.recurring
    .filter((r) => r.amount < 0 && r.scope !== 'business' && r.nextDate <= addDaysIso(data.today, 14))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 5);
  const homeBalances = summary.balances.filter((b) => b.kind === 'bank');

  const filters = (
    <div className="filters">
      <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="בחירת חודש">
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <div className="seg-toggle" role="group" aria-label="סוג תצוגה">
        <button className={view === 'simple' ? 'on' : ''} aria-pressed={view === 'simple'} onClick={() => setView('simple')}>
          ◎ פשוט
        </button>
        <button className={view === 'visual' ? 'on' : ''} aria-pressed={view === 'visual'} onClick={() => setView('visual')}>
          ◔ ויזואלי
        </button>
        <button className={view === 'detail' ? 'on' : ''} aria-pressed={view === 'detail'} onClick={() => setView('detail')}>
          ☰ מפורט
        </button>
      </div>
      {data.uncategorized > 0 && (
        <button className="chip" onClick={() => nav.go('transactions', { month, uncategorized: '1' })}>
          {data.uncategorized} לסיווג
        </button>
      )}
      {data.reviews?.n > 0 && (
        <button className="chip warm-chip" onClick={() => nav.go('reviews')}>
          ❓ {data.reviews.n} לבירור
        </button>
      )}
      <span className="spacer" />
      <CalmButton cycle={cy} />
    </div>
  );

  if (view === 'simple') {
    return (
      <div className={`stack dash ${loading ? 'refetch' : ''}`}>
        {filters}
        <CoachFocusCard nav={nav} />
        <SimpleDashboard d={data} nav={nav} onMore={setView} />
      </div>
    );
  }

  if (view === 'visual') {
    return (
      <div className={`stack dash ${loading ? 'refetch' : ''}`}>
        {filters}
        <CoachFocusCard nav={nav} />
        <VisualDashboard d={data} s={summary} nav={nav} onDetail={() => setView('detail')} />
      </div>
    );
  }

  return (
    <div className={`stack dash ${loading ? 'refetch' : ''}`}>
      {filters}
      <CoachFocusCard nav={nav} />

      {/* hero: this week */}
      <div className="hero-row">
        <section className="card hero-card">
          {cy ? <WeekHero cy={cy} /> : (
            <>
              <div className="eyebrow">{monthLabel(month)}</div>
              <div className="hero-figure">{money(Math.abs(cur.net))}</div>
              <div className="muted">{cur.net >= 0 ? 'נשאר החודש' : 'פער החודש'}</div>
            </>
          )}
        </section>

        {data.health && (
          <section className="card health-card">
            <div className="health-top">
              <ScoreRing score={data.health.score} />
              <div>
                <div className="eyebrow">מדד יציבות כלכלית</div>
                <div className="health-label">{data.health.label}</div>
                <div className="muted small">מבוסס על החודשים האחרונים שלך</div>
              </div>
            </div>
            <div className="health-parts">
              {data.health.parts.map((p) => (
                <div key={p.key} className="health-part" title={p.detail}>
                  <div className="row between">
                    <span>{p.label}</span>
                    <span className="muted small">{p.score}</span>
                  </div>
                  <Meter value={p.score} max={100} tone={p.score >= 60 ? 'accent' : 'warning'} label={p.label} />
                  <div className="sub">{p.detail}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {cy && (
        <div className="grid-main">
          <CycleCard cy={cy} onSaved={() => setReload((r) => r + 1)} onFunds={() => nav.go('funds')} />

          <section className="card">
            <h3>כרטיסי האשראי</h3>
            {data.cards.length === 0 && <div className="muted">עוד לא חוברו כרטיסים.</div>}
            {data.cards.map((c) => (
              <div key={c.accountId} className="card-bill">
                <div className="card-chip" aria-hidden>
                  💳
                </div>
                <div className="card-bill-main">
                  <div className="strong">{c.label}</div>
                  <div className="sub">
                    {c.nextDate ? `החיוב הבא: ${date(c.nextDate)} · בעוד ${c.daysUntil} ימים` : c.chargeDay ? `יורד בדרך כלל ב-${c.chargeDay} לחודש` : 'אין חיוב צפוי ידוע'}
                  </div>
                </div>
                <div className="card-bill-amount">{c.nextDate ? money(c.amount) : '—'}</div>
              </div>
            ))}
            <div className="sep" />
            <h3>בשבועיים הקרובים</h3>
            {upcoming.length === 0 && data.installments.total === 0 && <div className="muted">אין חיובים קבועים צפויים.</div>}
            {upcoming.map((r) => (
              <div key={r.key} className="split-row">
                <span className="date-pill">{date(r.nextDate).slice(0, 5)}</span>
                <span>{r.name}</span>
                <span>{money(-r.amount)}</span>
              </div>
            ))}
            {data.installments.total > 0 && (
              <div className="note">
                🧾 עסקאות בתשלומים: עוד <b>{money(data.installments.total)}</b> בחודשים הבאים
              </div>
            )}
            {homeBalances.length > 0 && (
              <>
                <div className="sep" />
                {homeBalances.map((b) => (
                  <div key={b.id} className="split-row">
                    <span>{b.label}</span>
                    <span className={b.balance !== null && b.balance < 0 ? 'warm' : ''}>{b.balance === null ? '—' : money(b.balance)}</span>
                  </div>
                ))}
              </>
            )}
          </section>
        </div>
      )}

      {(data.insights.length > 0 || bizTips.length > 0) && (
        <section>
          <div className="row between section-head">
            <h3>מה כדאי לדעת</h3>
            {data.insights.length > 4 && (
              <button className="link small" onClick={() => nav.go('insights', { month })}>
                כל התובנות ({data.insights.length}) ←
              </button>
            )}
          </div>
          <InsightCards insights={data.insights.slice(0, bizTips.length ? 3 : 4)} nav={nav} />
          {bizTips.length > 0 && (
            <div className="insights biz-tips">
              {bizTips.map((t) => (
                <article key={t.key} className="insight biz">
                  <div className="insight-icon" aria-hidden>
                    {t.icon}
                  </div>
                  <div>
                    <div className="insight-tone">טיפ לעסק{t.impact ? ` · עד ${money(t.impact)} בחודש` : ''}</div>
                    <h4>{t.title}</h4>
                    <p>{t.why}</p>
                    <button className="link small" onClick={() => nav.go('business', { month })}>
                      לעסק ←
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid-main">
        <section className="card">
          <h3>לאן הלך הכסף של הבית – מול חודש רגיל</h3>
          {homeCats.length ? (
            <TableToggle
              table={
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>קטגוריה</th>
                      <th>החודש</th>
                      <th>חודש רגיל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {homeCats.map((c) => (
                      <tr key={c.categoryId}>
                        <td>{c.name}</td>
                        <td>{money(c.total)}</td>
                        <td>{money(c.avg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <CategoryCompareChart
                data={homeCats.map((c) => ({ id: c.categoryId, name: c.name, total: c.total, avg: c.avg }))}
                onSelect={(id) => nav.go('transactions', { month, categoryId: String(id) })}
              />
            </TableToggle>
          ) : (
            <div className="muted">אין הוצאות בחודש הזה.</div>
          )}
        </section>

        <section className="card">
          <h3>{data.isCurrent ? 'קצב ההוצאות החודש' : 'הוצאות לפי יום'}</h3>
          {data.isCurrent && pace.avgFull !== null && (
            <div className="pace">
              <div className="row between">
                <span>
                  יצא עד היום <b>{money(pace.spentToDate)}</b>
                </span>
                <span className="muted small">
                  יום {pace.day} מתוך {pace.daysInMonth}
                </span>
              </div>
              <Meter value={pace.spentToDate} max={Math.max(pace.projected, pace.avgFull) * 1.05} marker={pace.avgFull} tone={paceOver ? 'warning' : 'accent'} label="קצב הוצאות" />
              <div className="sub">
                צפי לסוף החודש: <b>{money(pace.projected)}</b> · חודש רגיל: {money(pace.avgFull)} <span className="avg-legend" aria-hidden />
              </div>
            </div>
          )}
          <CalendarHeat month={month} days={data.daily} />
        </section>
      </div>

      {data.forecast && (
        <section className="card">
          <div className="row between">
            <h3>תחזית יתרה ל-60 יום</h3>
            <span className="muted small">כל חשבונות הבנק יחד · הערכה</span>
          </div>
          <TableToggle
            table={
              <table className="data-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>יתרה צפויה</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.points
                    .filter((_, i) => i % 7 === 0)
                    .map((p) => (
                      <tr key={p.date}>
                        <td>{date(p.date)}</td>
                        <td>{money(p.balance)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            }
          >
            <ForecastChart points={data.forecast.points} />
          </TableToggle>
          <p className="sub">
            לפי: היתרה היום ({money(data.forecast.start)}), חיובי אשראי שכבר בדרך ({money(data.forecast.assumptions.cardChargesAhead)}),{' '}
            {data.forecast.assumptions.recurringItems} חיובים והכנסות קבועים, והקצב הרגיל: כ-{money(data.forecast.assumptions.dailyVariableSpend)} הוצאות ו-
            {money(data.forecast.assumptions.dailyIrregularIncome)} הכנסות ביום.
          </p>
        </section>
      )}

      <section className="card">
        <h3>נכנס מול יצא – הבית והעסק יחד</h3>
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
                {trendData.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    <td>{money(d.income)}</td>
                    <td>{money(d.expenses)}</td>
                    <td>{money(d.income - d.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <IncomeExpenseChart data={trendData} />
        </TableToggle>
      </section>

      <blockquote className="quote">
        "איזהו עשיר? השמח בחלקו" <span>– אבות ד, א</span>
      </blockquote>
    </div>
  );
}

function WeekHero({ cy }: { cy: CycleView }) {
  const w = cy.week;
  const over = w.left < 0;
  return (
    <>
      <div className="eyebrow">השבוע אפשר להוציא עוד</div>
      <div className="hero-figure">{money(Math.max(0, w.left))}</div>
      <div className="muted">
        {over
          ? `השבוע יצא ${money(-w.left)} מעבר לתקציב. זה קורה. ביום ראשון מתחילים שבוע חדש, נקי.`
          : `על הוצאות משתנות (אוכל, בילויים, קניות) עד מוצאי שבת · עוד ${w.daysLeft} ימים`}
      </div>
      <div className="hero-meter">
        <div className="hero-meter-fill" style={{ width: `${Math.min(100, (w.spent / Math.max(1, w.budget)) * 100)}%` }} />
      </div>
      <div className="row between small hero-meta">
        <span>יצא השבוע: {money(w.spent)}</span>
        <span>תקציב השבוע: {money(w.budget)}</span>
      </div>
      {w.joy > 0 && (
        <div className="note joy">
          🥐 ובנוסף, <b>{money(w.joy)}</b> שמורים השבוע לשמחות קטנות – בורקס, ארטיק, הפתעה. מופרש מראש, גם בשבוע צפוף. אפשר לומר כן.
        </div>
      )}
    </>
  );
}

const SEGMENTS = [
  { key: 'fixed', label: 'קבועות', cls: 'seg-1' },
  { key: 'installments', label: 'תשלומים', cls: 'seg-2' },
  { key: 'funds', label: 'קופות', cls: 'seg-3' },
  { key: 'variable', label: 'משתנות (צפי)', cls: 'seg-4' },
  { key: 'joy', label: 'שמחות קטנות', cls: 'seg-5' },
] as const;

function CycleCard({ cy, onSaved, onFunds }: { cy: CycleView; onSaved: () => void; onFunds: () => void }) {
  const values = { fixed: cy.fixed.monthly, installments: cy.installments, funds: cy.funds, joy: cy.joy, variable: cy.projectedVariable };
  const total = Math.max(cy.income.expected, Object.values(values).reduce((s, v) => s + v, 0), 1);
  const free = Math.max(0, cy.income.expected - Object.values(values).reduce((s, v) => s + v, 0));
  const positive = cy.forecastEnd >= 0;

  return (
    <section className="card">
      <div className="row between">
        <h3>החודש התזרימי שלי</h3>
        <span className="muted small">
          {date(cy.start).slice(0, 5)}–{date(cy.end).slice(0, 5)} · יום {cy.day} מתוך {cy.days}
        </span>
      </div>
      <div className="cycle-head">
        <div>
          <div className="tile-label">צפי לסוף החודש</div>
          <div className={`tile-value ${positive ? 'pos' : 'warm'}`}>
            {positive ? '+' : '−'}
            {money(Math.abs(cy.forecastEnd))}
          </div>
        </div>
        <div>
          <div className="tile-label">צפוי להיכנס הביתה</div>
          <div className="tile-value">{money(cy.income.expected)}</div>
          <div className="sub">נכנס עד היום: {money(cy.income.received)}</div>
        </div>
      </div>

      <div className="stackbar" role="img" aria-label="חלוקת ההכנסה הצפויה">
        {SEGMENTS.map((s) =>
          values[s.key] > 0 ? <span key={s.key} className={s.cls} style={{ width: `${(values[s.key] / total) * 100}%` }} title={`${s.label}: ${money(values[s.key])}`} /> : null,
        )}
        {free > 0 && <span className="seg-free" style={{ width: `${(free / total) * 100}%` }} title={`פנוי: ${money(free)}`} />}
      </div>
      <div className="stack-legend">
        {SEGMENTS.map((s) => (
          <span key={s.key}>
            <i className={`key rect ${s.cls}`} /> {s.label} <b>{money(values[s.key])}</b>
          </span>
        ))}
        <span>
          <i className="key rect seg-free" /> פנוי <b>{money(free)}</b>
        </span>
      </div>
      <p className="sub">
        {positive
          ? 'בקצב הנוכחי החודש ייגמר בפלוס. את העודף כדאי להפנות לכרית הביטחון או לקופה – לפני שהוא מתפזר.'
          : 'בקצב הנוכחי החודש עלול להיגמר במינוס. זה הזמן לבחור: לצמצם את ההוצאות המשתנות השבוע, או לדחות קנייה גדולה.'}
        {cy.funds === 0 && (
          <>
            {' '}
            <button className="link small" onClick={onFunds}>
              להוסיף קופות ←
            </button>
          </>
        )}
      </p>
      <CycleSettings cy={cy} onSaved={onSaved} />
    </section>
  );
}

function CycleSettings({ cy, onSaved }: { cy: CycleView; onSaved: () => void }) {
  const [startDay, setStartDay] = useState(cy.settings.startDayIsAuto ? '0' : String(cy.settings.startDay));
  const [joy, setJoy] = useState(String(cy.settings.weeklyJoy));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await api('/settings', { method: 'PUT', json: { cycleStartDay: Number(startDay), weeklyJoy: Number(joy) || 0 } });
    onSaved();
  };
  return (
    <details className="settings">
      <summary className="muted small">הגדרות החודש התזרימי</summary>
      <form className="row wrap" onSubmit={save}>
        <label>
          החודש מתחיל ב-
          <select value={startDay} onChange={(e) => setStartDay(e.target.value)}>
            <option value="0">אוטומטי (זוהה: {cy.settings.startDayDetected} לחודש)</option>
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} לחודש
              </option>
            ))}
          </select>
        </label>
        <label>
          כסף לשמחות קטנות בשבוע (₪)
          <input type="number" min={0} step={10} value={joy} onChange={(e) => setJoy(e.target.value)} dir="ltr" style={{ width: 100 }} />
        </label>
        <button className="ghost small">שמירה</button>
      </form>
      <p className="sub">ברירת המחדל: היום שבו נכנס הכסף הגדול של החודש לחשבון הבית (למשל המשכורת מהעסק).</p>
    </details>
  );
}

function addDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
