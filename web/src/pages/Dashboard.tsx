import { useEffect, useState } from 'react';
import { api, type Summary } from '../api';
import { currentMonth, money, monthLabel, scopeLabel } from '../format';
import type { Nav } from '../App';

export function Dashboard({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(currentMonth());
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    api<Summary>(`/summary?month=${month}`).then(setS);
  }, [month]);

  if (!s) return <div className="muted">טוען…</div>;

  const months = Array.from(new Set([currentMonth(), ...s.months])).sort().reverse();
  const hasData = s.months.length > 0;
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.total));
  const scope = (name: string) => s.byScope.find((x) => x.scope === name) ?? { income: 0, expenses: 0 };

  if (!hasData) {
    return (
      <section className="card hero">
        <h2>שלום, ברוך הבא 🌱</h2>
        <p>
          הצעד הראשון הוא לראות. מחברים את פאגי, הפועלים, דיסקונט, מקס וישראכרט – והמערכת תמשוך את התנועות לבד, כל בוקר.
        </p>
        <button className="primary" onClick={() => nav.go('connections')}>
          לחיבור הבנקים והכרטיסים
        </button>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="title">{monthLabel(month)}</h2>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="בחירת חודש">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">נכנס</div>
          <div className="tile-value pos">{money(s.income)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">יצא</div>
          <div className="tile-value">{money(s.expenses)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">{s.net >= 0 ? 'נשאר' : 'פער החודש'}</div>
          <div className={s.net >= 0 ? 'tile-value pos' : 'tile-value warm'}>{money(Math.abs(s.net))}</div>
        </div>
      </div>

      <p className="calm">
        {s.net >= 0
          ? 'החודש נכנס יותר ממה שיצא. זה בסיס טוב לבנות עליו קופות.'
          : 'החודש יצא יותר ממה שנכנס. זה מידע, לא שיפוט – עכשיו רואים, ומכאן מתכננים.'}
      </p>

      {s.uncategorizedCount > 0 && (
        <button className="notice" onClick={() => nav.go('transactions', { month, uncategorized: '1' })}>
          {s.uncategorizedCount} תנועות מחכות לסיווג. דקה אחת והתמונה מתבהרת ←
        </button>
      )}

      <div className="grid2">
        <section className="card">
          <h3>עסקי מול פרטי</h3>
          {(['business', 'private'] as const).map((k) => (
            <div key={k} className="split-row">
              <span>
                <span className={k === 'business' ? 'pill biz' : 'pill'}>{scopeLabel(k)}</span>
              </span>
              <span className="pos">+{money(scope(k).income)}</span>
              <span>−{money(scope(k).expenses)}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>יתרות</h3>
          {s.balances.length === 0 && <div className="muted">אין עדיין יתרות.</div>}
          {s.balances.map((b) => (
            <div key={b.id} className="split-row">
              <span>{b.label}</span>
              <span className={b.balance !== null && b.balance < 0 ? 'warm' : ''}>{b.balance === null ? '—' : money(b.balance)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <h3>לאן הלך הכסף</h3>
        <div className="bars">
          {s.byCategory.map((c) => (
            <button key={c.categoryId} className="bar-row" onClick={() => nav.go('transactions', { month, categoryId: String(c.categoryId) })}>
              <span className="bar-label">{c.name}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(c.total / maxCat) * 100}%` }} />
              </span>
              <span className="bar-value">{money(c.total)}</span>
            </button>
          ))}
        </div>
      </section>

      {s.futureInstallments.total > 0 && (
        <section className="card">
          <h3>תשלומים שכבר תפוסים בחודשים הבאים</h3>
          <p className="muted">
            סך הכול {money(s.futureInstallments.total)} בעסקאות בתשלומים. טוב לדעת מראש – ככה זה לא מפתיע.
          </p>
          {s.futureInstallments.series.slice(0, 8).map((r, i) => (
            <div key={i} className="split-row">
              <span>{r.description}</span>
              <span className="muted">
                עוד {r.left} × {money(r.perPayment)}
              </span>
              <span>{money(r.remaining)}</span>
            </div>
          ))}
        </section>
      )}

      <blockquote className="quote">
        "איזהו עשיר? השמח בחלקו" <span>– אבות ד, א</span>
      </blockquote>
    </div>
  );
}
