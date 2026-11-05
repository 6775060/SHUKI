import type { InsightsData } from '../api';
import { money } from '../format';

const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
import type { Nav, Page } from '../App';
import { CoachFocusCard } from './Coach';
import { WeeklyCard, weeklyTime } from './Habits';

// "תכל'ס": the home screen in three answers and nothing else.
//   1. How will this month end?
//   2. How much can I still spend this week?
//   3. What is the one thing to do now?
// Everything else is behind "רוצה לראות עוד".

export function FocusDashboard({ d, nav, onMore }: { d: InsightsData; nav: Nav; onMore: (v: 'simple' | 'visual' | 'detail') => void }) {
  const cy = d.cycle;
  const critical = d.check.items.filter((i) => i.level === 'critical');

  return (
    <div className="stack focus-home">
      {critical.length > 0 && (
        <div className="trust critical focus-alert">
          <span>
            ⚠️ <b>{critical[0].title.replace(/[.\s]+$/, '')}</b>
            <br />
            <span className="small">
              {critical.length === 2 ? 'ועוד דבר אחד לבדוק. ' : critical.length > 2 ? `ועוד ${critical.length - 1} דברים לבדוק. ` : ''}עד שזה מטופל, המספרים כאן חלקיים.
            </span>
          </span>{' '}
          <button className="link small" onClick={() => nav.go(critical[0].page as Page, critical[0].params)}>
            לטיפול
          </button>
        </div>
      )}

      {weeklyTime() && <WeeklyCard nav={nav} />}

      {cy ? <MonthAnswer d={d} /> : null}
      {cy ? <WeekAnswer d={d} /> : null}

      <CoachFocusCard nav={nav} fallback={<OneStep d={d} nav={nav} />} />

      <div className="focus-more">
        <span className="muted small">רוצה לראות עוד?</span>
        <button className="ghost small" onClick={() => onMore('simple')}>
          סיכום החודש
        </button>
        <button className="ghost small" onClick={() => onMore('visual')}>
          ◔ ויזואלי
        </button>
        <button className="ghost small" onClick={() => onMore('detail')}>
          ☰ הכול
        </button>
      </div>
    </div>
  );
}

function MonthAnswer({ d }: { d: InsightsData }) {
  const cy = d.cycle!;
  const plus = cy.forecastEnd >= 0;
  const committed = cy.fixed.monthly + cy.installments + cy.funds + cy.joy;
  const variable = cy.projectedVariable;
  const scale = Math.max(cy.income.expected, committed + variable, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%`;
  const free = Math.max(0, cy.income.expected - committed - variable);

  return (
    <section className={`card focus-month ${plus ? 'plus' : 'minus'}`}>
      <div className="eyebrow">
        החודש שלך: מ-{dm(cy.start)} עד {dm(cy.end)}
      </div>
      <div className="focus-answer">
        {plus ? 'בקצב הזה החודש ייגמר ב' : 'בקצב הזה יחסרו בסוף החודש'}
        <b className={plus ? 'pos' : 'warm'}>
          {plus ? '+' : ''}
          {money(Math.abs(cy.forecastEnd))}
        </b>
      </div>
      <div className="focus-bar" role="img" aria-label="מה נכנס ולאן זה הולך">
        <span className="fb-fixed" style={{ width: pct(committed) }} />
        <span className="fb-var" style={{ width: pct(variable) }} />
        {free > 0 && <span className="fb-free" style={{ width: pct(free) }} />}
      </div>
      <div className="focus-eq">
        <span>
          נכנס <b>{money(cy.income.expected)}</b>
        </span>
        <span>
          <i className="key rect fb-fixed" /> קבועות <b>{money(committed)}</b>
        </span>
        <span>
          <i className="key rect fb-var" /> משתנות <b>{money(variable)}</b>
        </span>
      </div>
      {cy.income.basis === 'history' && cy.income.received < cy.income.expected && (
        <p className="muted small">"נכנס" הוא מה שנכנס בחודש רגיל אצלך. עד היום נכנסו {money(cy.income.received)}.</p>
      )}
    </section>
  );
}

function WeekAnswer({ d }: { d: InsightsData }) {
  const w = d.cycle!.week;
  const over = w.left < 0;
  const used = w.budget > 0 ? Math.min(1, w.spent / w.budget) : 1;
  const perDay = w.daysLeft > 0 ? Math.max(0, w.left) / w.daysLeft : 0;
  return (
    <section className="card focus-week">
      <div className="eyebrow">השבוע · הוצאות משתנות (אוכל, קניות, בילויים)</div>
      <div className="focus-answer">
        {over ? 'השבוע יצא יותר מהמתוכנן ב' : 'נשאר להוציא השבוע'}
        <b className={over ? 'warm' : 'pos'}>{money(Math.abs(w.left))}</b>
      </div>
      <div className="focus-meter" aria-hidden>
        <span className={over ? 'over' : ''} style={{ width: `${used * 100}%` }} />
      </div>
      <p className="muted small">
        {over
          ? `ביום ראשון מתחיל שבוע חדש. עד אז כדאי להחזיק רק מה שחייבים.`
          : `יצא ${money(w.spent)} מתוך ${money(w.budget)} · ${w.daysLeft === 1 ? 'היום היום האחרון' : `עוד ${w.daysLeft} ימים, כ-${money(perDay)} ליום`}`}
      </p>
    </section>
  );
}

// Without the coach: the single most useful next step from the numbers.
function OneStep({ d, nav }: { d: InsightsData; nav: Nav }) {
  const opp = d.savings.opportunities.find((o) => o.worth === 'high');
  const warn = d.insights.find((i) => i.tone === 'attention');
  const anyOpp = d.savings.opportunities[0];
  if (opp || (!warn && anyOpp)) {
    const o = opp ?? anyOpp;
    return (
      <section className="card focus-step">
        <div className="eyebrow">צעד אחד לעשות</div>
        <h3>
          {o.icon} {o.title}
        </h3>
        <p>{o.action}</p>
        <p className="muted small">
          חיסכון משוער: עד {money(o.saveYearly)} בשנה · {o.effort}
        </p>
      </section>
    );
  }
  if (warn) {
    return (
      <section className="card focus-step">
        <div className="eyebrow">דבר אחד לשים לב אליו</div>
        <h3>
          {warn.icon} {warn.title}
        </h3>
        <p>{warn.body}</p>
        {warn.link && (
          <button className="link small" onClick={() => nav.go(warn.link!.page as Page, warn.link!.params)}>
            לפרטים
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="card focus-step">
      <div className="eyebrow">צעד אחד לעשות</div>
      <h3>🌱 הכול בסדר כרגע</h3>
      <p>אין שום דבר דחוף. אפשר להעביר את מה שנשאר בסוף החודש לכרית הביטחון.</p>
    </section>
  );
}
