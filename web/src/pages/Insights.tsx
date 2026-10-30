import { useEffect, useState } from 'react';
import { api, type Insight, type InsightsData } from '../api';
import { currentMonth, date, money, monthLabel } from '../format';
import type { Nav, Page } from '../App';
import { OpportunityRow } from './DashboardSimple';

const TONE_LABEL: Record<Insight['tone'], string> = { good: 'חיובי', neutral: 'לידיעה', attention: 'לתשומת לב' };

export function InsightCards({ insights, nav }: { insights: Insight[]; nav: Nav }) {
  return (
    <div className="insights">
      {insights.map((i, idx) => (
        <article key={idx} className={`insight ${i.tone}`}>
          <div className="insight-icon" aria-hidden>
            {i.icon}
          </div>
          <div>
            <div className="insight-tone">{TONE_LABEL[i.tone]}</div>
            <h4>{i.title}</h4>
            <p>{i.body}</p>
            {i.link && i.link.page !== 'dashboard' && (
              <button className="link small" onClick={() => nav.go(i.link!.page as Page, i.link!.params)}>
                לפרטים ←
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function Insights({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(nav.params.month ?? currentMonth());
  const [data, setData] = useState<InsightsData | null>(null);

  useEffect(() => {
    api<InsightsData>(`/insights?month=${month}`).then(setData);
  }, [month]);
  useEffect(() => {
    if (data && nav.params.section === 'savings') document.getElementById('savings')?.scrollIntoView({ block: 'start' });
  }, [data, nav.params.section]);

  if (!data) return <div className="muted">טוען…</div>;

  const out = data.recurring.filter((r) => r.amount < 0);
  const inc = data.recurring.filter((r) => r.amount > 0);
  const monthlyOut = out.filter((r) => !r.isTax).reduce((s, r) => s - r.amount / r.periodMonths, 0);
  const monthlyTax = out.filter((r) => r.isTax).reduce((s, r) => s - r.amount / r.periodMonths, 0);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    months.push(new Date(d.getFullYear(), d.getMonth() - i, 15).toISOString().slice(0, 7));
  }

  return (
    <div className="stack">
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="חודש">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <h2 className="title">תובנות</h2>
      {data.insights.length ? <InsightCards insights={data.insights} nav={nav} /> : <div className="muted">עוד אין מספיק נתונים לתובנות. אחרי חודש-חודשיים של סנכרון הן יופיעו כאן.</div>}

      <section className="card" id="savings">
        <h3>הוצאות שאפשר לדון עליהן</h3>
        <p className="sub">
          לכל אחת: כמה בערך אפשר לחסוך בשנה, כמה מאמץ זה דורש, והאם זה שווה את האנרגיה (לפי החיסכון לכל שעת עבודה). לחיצה פותחת מה עושים.
        </p>
        {data.savings.opportunities.length === 0 ? (
          <div className="muted">לא נמצאו כרגע הוצאות שבולט שכדאי להתמקח עליהן. 🌿</div>
        ) : (
          <>
            <div className="opp-total">
              ביחד, עד כ-<b>{money(data.savings.opportunities.filter((o) => o.worth !== 'low').reduce((s, o) => s + o.saveYearly, 0))} בשנה</b> רק מהפריטים ששווים את המאמץ.
            </div>
            <ul className="simple-list">
              {data.savings.opportunities.map((o) => (
                <OpportunityRow key={o.key} o={o} />
              ))}
            </ul>
          </>
        )}
      </section>

      {data.savings.groups.length > 0 && (
        <section className="card">
          <h3>הוצאות דומות, אחת ליד השנייה</h3>
          <div className="groups">
            {data.savings.groups.map((g) => (
              <div key={g.key} className="group">
                <div className="row between">
                  <b>
                    {g.icon} {g.name}
                  </b>
                  <b>{money(g.monthly)} בחודש</b>
                </div>
                <ul>
                  {g.items.map((i) => (
                    <li key={i.name} className="row between">
                      <span>{i.name}</span>
                      <span className="muted">{money(i.monthly)}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted small">{g.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="row between">
          <h3>חיובים קבועים</h3>
          <span className="muted">
            {money(monthlyOut)} בחודש · {money(monthlyOut * 12)} בשנה{monthlyTax > 0 ? ` · ועוד מסים: ${money(monthlyTax)} בחודש` : ''}
          </span>
        </div>
        <p className="sub">זוהו אוטומטית: אותו בית עסק, כל חודש (או כל חודשיים), באותו סכום בערך.</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>שם</th>
              <th>קטגוריה</th>
              <th>סכום</th>
              <th>תדירות</th>
              <th>החיוב הבא</th>
              <th>בשנה</th>
            </tr>
          </thead>
          <tbody>
            {out.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.name}
                  {r.priceChangePct && r.priceChangePct > 0 && <span className="badge warm">התייקר {Math.round(r.priceChangePct * 100)}%</span>}
                  {r.isNew && <span className="badge">חדש</span>}
                </td>
                <td className="muted">{r.categoryName ?? '—'}</td>
                <td>{money(-r.amount)}</td>
                <td className="muted">{r.periodMonths === 2 ? 'כל חודשיים' : 'חודשי'}</td>
                <td>{date(r.nextDate)}</td>
                <td>{money(-r.annual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {inc.length > 0 && (
        <section className="card">
          <h3>הכנסות קבועות</h3>
          {inc.map((r) => (
            <div key={r.key} className="split-row">
              <span>{r.name}</span>
              <span className="muted">הבא: {date(r.nextDate)}</span>
              <span className="pos">{money(r.amount)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h3>בתי העסק המובילים – {monthLabel(month)}</h3>
        {data.merchants.map((m) => (
          <div key={m.name} className="split-row">
            <span>{m.name}</span>
            <span className="muted">{m.count} עסקאות</span>
            <span>{money(m.total)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
