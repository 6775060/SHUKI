import { useState } from 'react';
import type { DataCheck, InsightsData, Opportunity } from '../api';
import { money, monthLabel } from '../format';
import type { Nav, Page } from '../App';
import { CushionCard, MaaserCard, WeeklyCard, weeklyTime } from './Habits';

// The quiet home screen: can I trust the numbers, how is the month going,
// the few things that matter now, and the expenses worth a conversation.
// Everything else is one tap away, for when there's time to dig.

export const WORTH_LABEL: Record<Opportunity['worth'], string> = { high: 'שווה מאוד', medium: 'שווה', low: 'פחות שווה את המאמץ' };

export function SimpleDashboard({ d, nav, onMore }: { d: InsightsData; nav: Nav; onMore: (v: 'visual' | 'detail') => void }) {
  const cur = d.trend[d.trend.length - 1];
  const done = d.trend.filter((p) => p.month < d.month && (p.income > 0 || p.expenses > 0)).slice(-3);
  const avgIn = done.length ? done.reduce((s, p) => s + p.income, 0) / done.length : null;
  const avgOut = done.length ? done.reduce((s, p) => s + p.expenses, 0) / done.length : null;
  const left = cur.income - cur.expenses;
  const scale = Math.max(cur.income, cur.expenses, avgIn ?? 0, avgOut ?? 0, 1);
  const top = d.insights.filter((i) => i.tone !== 'neutral' || d.insights.length <= 3).slice(0, 3);
  const opps = d.savings.opportunities.slice(0, 3);
  const [maaser, setMaaser] = useState(d.maaser);
  const [cushion, setCushion] = useState(d.cushion);

  return (
    <div className="stack simple">
      <TrustStrip check={d.check} nav={nav} />
      {d.isCurrent && weeklyTime() && <WeeklyCard nav={nav} />}

      <section className="card simple-month">
        <div className="eyebrow">{d.isCurrent ? `${monthLabel(d.month)}, עד היום` : monthLabel(d.month)}</div>
        <div className="big3">
          <div>
            <span className="muted small">נכנס</span>
            <b className="pos">{money(cur.income)}</b>
          </div>
          <div>
            <span className="muted small">יצא</span>
            <b>{money(cur.expenses)}</b>
          </div>
          <div>
            <span className="muted small">{left >= 0 ? 'נשאר' : d.isCurrent ? 'יצא יותר, עד עכשיו' : 'חסר'}</span>
            <b className={left >= 0 ? 'pos' : d.isCurrent ? '' : 'warm'}>{money(Math.abs(left))}</b>
          </div>
        </div>
        <div className="inout" aria-hidden>
          <div className="inout-row">
            <span>נכנס</span>
            <div className="inout-track">
              <div className="inout-bar in" style={{ width: `${(cur.income / scale) * 100}%` }} />
              {avgIn !== null && <div className="inout-avg" style={{ insetInlineStart: `${(avgIn / scale) * 100}%` }} />}
            </div>
          </div>
          <div className="inout-row">
            <span>יצא</span>
            <div className="inout-track">
              <div className="inout-bar out" style={{ width: `${(cur.expenses / scale) * 100}%` }} />
              {avgOut !== null && <div className="inout-avg" style={{ insetInlineStart: `${(avgOut / scale) * 100}%` }} />}
            </div>
          </div>
        </div>
        {avgIn !== null && avgOut !== null && (
          <p className="muted small">
            הקו הדק: חודש רגיל אצלך, נכנס {money(avgIn)} ויצא {money(avgOut)}.
          </p>
        )}
        {d.safeToSpend && d.safeToSpend.available > 0 && (
          <div className="simple-safe">
            אפשר להוציא בנחת עד <b>{money(d.safeToSpend.perDay)}</b> ביום, עד סוף החודש ({d.safeToSpend.daysLeft} ימים).
          </div>
        )}
      </section>

      {top.length > 0 && (
        <section className="card">
          <h3>מה חשוב עכשיו</h3>
          <ul className="simple-list">
            {top.map((i, idx) => (
              <li key={idx} className={i.tone}>
                <span className="simple-icon" aria-hidden>
                  {i.icon}
                </span>
                <div>
                  <b>{i.title}</b>
                  <p>{i.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <button className="link small" onClick={() => nav.go('insights')}>
            לכל התובנות
          </button>
        </section>
      )}

      <section className="card habits">
        <h3>הבסיס של הבית</h3>
        <MaaserCard m={maaser} onChange={setMaaser} />
        <CushionCard c={cushion} onChange={setCushion} />
      </section>

      {opps.length > 0 && (
        <section className="card">
          <h3>הוצאות שאפשר להוריד</h3>
          <p className="sub">מסודר לפי מה ששווה הכי הרבה ביחס למאמץ. החיסכון הוא הערכה.</p>
          <ul className="simple-list">
            {opps.map((o) => (
              <OpportunityRow key={o.key} o={o} />
            ))}
          </ul>
          <button className="link small" onClick={() => nav.go('insights', { section: 'savings' })}>
            לכל הרשימה ({d.savings.opportunities.length})
          </button>
        </section>
      )}

      <div className="row wrap simple-more">
        <span className="muted small">רוצה לחפור?</span>
        <button className="ghost small" onClick={() => onMore('visual')}>
          ◔ תמונה ויזואלית
        </button>
        <button className="ghost small" onClick={() => onMore('detail')}>
          ☰ כל הפירוט
        </button>
        <button className="ghost small" onClick={() => nav.go('transactions' as Page)}>
          תנועות
        </button>
      </div>
    </div>
  );
}

export function OpportunityRow({ o }: { o: Opportunity }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="opp">
      <span className="simple-icon" aria-hidden>
        {o.icon}
      </span>
      <div>
        <button className="opp-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <b>{o.title}</b>
          <span className={`worth ${o.worth}`}>{WORTH_LABEL[o.worth]}</span>
        </button>
        <p>
          עד כ-<b>{money(o.saveYearly)} בשנה</b> · {o.effort}
        </p>
        {open && (
          <>
            <p className="muted">{o.why}</p>
            <p>
              <b>מה עושים:</b> {o.action}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

function TrustStrip({ check, nav }: { check: DataCheck; nav: Nav }) {
  const [open, setOpen] = useState(false);
  if (check.ok) {
    return (
      <div className="trust ok">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          ✓ הנתונים מעודכנים ומדויקים
        </button>
        {open && (
          <ul>
            {check.checked.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <section className={`trust ${check.items.some((i) => i.level === 'critical') ? 'critical' : 'warning'}`}>
      <b>{check.items.length === 1 ? 'דבר אחד לבדוק כדי שהמספרים יהיו מדויקים' : `${check.items.length} דברים לבדוק כדי שהמספרים יהיו מדויקים`}</b>
      <ul>
        {check.items.slice(0, 3).map((i) => (
          <li key={i.key}>
            <span>{i.title}.</span> <span className="muted">{i.action}</span>{' '}
            <button className="link small" onClick={() => nav.go(i.page as Page, i.params)}>
              לטיפול
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
