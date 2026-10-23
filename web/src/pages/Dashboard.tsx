import { useEffect, useState } from 'react';
import { api, type InsightsData, type Summary } from '../api';
import { currentMonth, date, money, monthLabel } from '../format';
import { CalendarHeat, CategoryCompareChart, ForecastChart, IncomeExpenseChart, Meter, ScoreRing, Sparkline, TableToggle } from '../charts';
import { InsightCards } from './Insights';
import type { Nav } from '../App';

const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
};

function Delta({ value, avg, upIsGood, partial }: { value: number; avg: number | null; upIsGood: boolean; partial: boolean }) {
  if (!avg) return <span className="delta muted">אין עדיין השוואה</span>;
  // Mid-month, a full-month comparison would always look like a drop.
  if (partial) return <span className="delta muted">{Math.round((value / avg) * 100)}% מחודש רגיל, עד כה</span>;
  const d = (value - avg) / avg;
  if (Math.abs(d) < 0.03) return <span className="delta muted">כמו חודש רגיל</span>;
  const good = d > 0 === upIsGood;
  return (
    <span className={`delta ${good ? 'good' : 'warm'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(Math.round(d * 100))}% מחודש רגיל
    </span>
  );
}

export function Dashboard({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<InsightsData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api<InsightsData>(`/insights?month=${month}`), api<Summary>(`/summary?month=${month}`)])
      .then(([i, s]) => {
        setData(i);
        setSummary(s);
      })
      .finally(() => setLoading(false));
  }, [month]);

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
  const prev = data.trend.slice(0, -1).filter((p) => p.income > 0 || p.expenses > 0).slice(-3);
  const avg = (k: 'income' | 'expenses' | 'net' | 'bizIncome') => (prev.length ? prev.reduce((s, p) => s + p[k], 0) / prev.length : null);
  const series = (k: 'income' | 'expenses' | 'net' | 'bizIncome') => data.trend.filter((p) => p.income > 0 || p.expenses > 0).map((p) => p[k]);
  const trendData = data.trend.filter((p, i) => i >= data.trend.findIndex((q) => q.income > 0 || q.expenses > 0)).map((p) => ({ label: shortMonth(p.month), income: p.income, expenses: p.expenses }));
  const steadyCats = data.categories.filter((c) => c.total > 0).slice(0, 9);
  const pace = data.pace;
  const paceOver = pace.avgFull !== null && pace.projected > pace.avgFull * 1.05;
  const sts = data.safeToSpend;
  const upcoming = data.recurring
    .filter((r) => r.amount < 0 && r.nextDate <= addDaysIso(data.today, 14))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 6);

  return (
    <div className={`stack dash ${loading ? 'refetch' : ''}`}>
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="בחירת חודש">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        {data.uncategorized > 0 && (
          <button className="chip" onClick={() => nav.go('transactions', { month, uncategorized: '1' })}>
            {data.uncategorized} לסיווג
          </button>
        )}
      </div>

      {/* hero row */}
      <div className="hero-row">
        <section className="card hero-card">
          {sts ? (
            <>
              <div className="eyebrow">בטוח להוציא היום</div>
              <div className="hero-figure">{money(sts.perDay)}</div>
              <div className="muted">
                {sts.available > 0
                  ? `לכל אחד מ-${sts.daysLeft} הימים שנשארו בחודש, אחרי כל מה שכבר מחויב.`
                  : 'החודש כבר מחויב כולו. זה רגע לנשום, לא להיבהל – ולבדוק מה אפשר לדחות.'}
              </div>
              <details className="breakdown">
                <summary>איך זה מחושב</summary>
                {sts.parts.map((p) => (
                  <div key={p.label} className="split-row">
                    <span>{p.label}</span>
                    <span className={p.amount < 0 ? 'warm' : ''}>{money(p.amount)}</span>
                  </div>
                ))}
                <div className="split-row strong">
                  <span>פנוי עד סוף החודש</span>
                  <span>{money(sts.available)}</span>
                </div>
                {data.funds.length === 0 && (
                  <button className="link small" onClick={() => nav.go('funds')}>
                    להוסיף קופות להוצאות צפויות ←
                  </button>
                )}
              </details>
              {sts.nextCardCharge && (
                <div className="note">
                  💳 חיוב אשראי של <b>{money(sts.nextCardCharge.amount)}</b> צפוי ב-{date(sts.nextCardCharge.date)}
                </div>
              )}
            </>
          ) : (
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

      {/* KPI row */}
      <div className="kpis">
        <div className="tile">
          <div className="tile-label">נכנס</div>
          <div className="tile-value">{money(cur.income)}</div>
          <div className="tile-foot">
            <Delta value={cur.income} avg={avg('income')} upIsGood partial={data.isCurrent} />
            <Sparkline values={series('income')} />
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">יצא</div>
          <div className="tile-value">{money(cur.expenses)}</div>
          <div className="tile-foot">
            <Delta value={cur.expenses} avg={avg('expenses')} upIsGood={false} partial={data.isCurrent} />
            <Sparkline values={series('expenses')} />
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">{cur.net >= 0 ? 'נשאר' : 'פער'}</div>
          <div className={`tile-value ${cur.net >= 0 ? 'pos' : 'warm'}`}>{money(Math.abs(cur.net))}</div>
          <div className="tile-foot">
            <span className="delta muted">{cur.income > 0 ? `${Math.round((cur.net / cur.income) * 100)}% מההכנסה` : ''}</span>
            <Sparkline values={series('net')} />
          </div>
        </div>
        {data.business.hasBusiness && (
          <div className="tile">
            <div className="tile-label">הכנסה עסקית</div>
            <div className="tile-value">{money(cur.bizIncome)}</div>
            <div className="tile-foot">
              <Delta value={cur.bizIncome} avg={avg('bizIncome')} upIsGood partial={data.isCurrent} />
              <Sparkline values={series('bizIncome')} />
            </div>
          </div>
        )}
      </div>

      {/* insights */}
      {data.insights.length > 0 && (
        <section>
          <div className="row between section-head">
            <h3>מה כדאי לדעת</h3>
            {data.insights.length > 4 && (
              <button className="link small" onClick={() => nav.go('insights', { month })}>
                כל התובנות ({data.insights.length}) ←
              </button>
            )}
          </div>
          <InsightCards insights={data.insights.slice(0, 4)} nav={nav} />
        </section>
      )}

      <div className="grid-main">
        <section className="card">
          <h3>נכנס מול יצא</h3>
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
            {data.forecast.assumptions.recurringItems} חיובים והכנסות קבועים, והקצב הרגיל שלך: כ-{money(data.forecast.assumptions.dailyVariableSpend)} הוצאות ו-
            {money(data.forecast.assumptions.dailyIrregularIncome)} הכנסות ביום.
          </p>
        </section>
      )}

      <div className="grid-main">
        <section className="card">
          <h3>לאן הלך הכסף – מול חודש רגיל</h3>
          {steadyCats.length ? (
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
                    {steadyCats.map((c) => (
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
                data={steadyCats.map((c) => ({ id: c.categoryId, name: c.name, total: c.total, avg: c.avg }))}
                onSelect={(id) => nav.go('transactions', { month, categoryId: String(id) })}
              />
            </TableToggle>
          ) : (
            <div className="muted">אין הוצאות בחודש הזה.</div>
          )}
        </section>

        <section className="card">
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
          <div className="sep" />
          <h3>יתרות</h3>
          {summary.balances.map((b) => (
            <div key={b.id} className="split-row">
              <span>{b.label}</span>
              <span className={b.balance !== null && b.balance < 0 ? 'warm' : ''}>{b.balance === null ? '—' : money(b.balance)}</span>
            </div>
          ))}
        </section>
      </div>

      {data.business.hasBusiness && (
        <section className="card">
          <h3>העסק החודש</h3>
          <div className="biz-grid">
            <div>
              <div className="tile-label">הכנסות</div>
              <div className="tile-value">{money(data.business.income)}</div>
              <div className="sub">הוצאות עסקיות: {money(data.business.expenses)}</div>
            </div>
            <div>
              <div className="tile-label">להפריש למע"מ (הערכה)</div>
              <div className="tile-value">{money(data.business.vatEstimate)}</div>
              <div className="sub">
                מע"מ עסקאות {money(data.business.vatOnSales)} פחות תשומות {money(data.business.vatOnPurchases)}
              </div>
            </div>
            <div>
              <div className="tile-label">מקורות הכנסה (3 חודשים)</div>
              {data.business.topSources.slice(0, 4).map((s) => (
                <div key={s.name} className="source-row">
                  <span className="source-name">{s.name.replace(/^העברה מלקוח\s*/, '')}</span>
                  <Meter value={s.share} max={1} label={s.name} />
                  <span className="muted small">{Math.round(s.share * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <blockquote className="quote">
        "איזהו עשיר? השמח בחלקו" <span>– אבות ד, א</span>
      </blockquote>
    </div>
  );
}

function addDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
