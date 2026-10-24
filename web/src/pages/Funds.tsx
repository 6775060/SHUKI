import { useEffect, useState, type FormEvent } from 'react';
import { api, type Category, type Fund } from '../api';
import { money } from '../format';
import { Meter } from '../charts';

interface Suggestion {
  name: string;
  icon: string;
  slug: string;
  categoryId: number | null;
  lastYear: number;
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function Funds() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Partial<Fund> | null>(null);

  const load = () =>
    api<{ funds: Fund[]; suggestions: Suggestion[] }>('/funds').then((r) => {
      setFunds(r.funds);
      setSuggestions(r.suggestions);
    });
  useEffect(() => {
    load();
    api<Category[]>('/categories').then((c) => setCategories(c.filter((x) => x.kind === 'expense')));
  }, []);

  const monthly = funds.reduce((s, f) => s + f.monthly, 0);

  return (
    <div className="stack">
      <h2 className="title">קופות להוצאות צפויות</h2>
      <p className="muted">
        ארנונה, חגים, שמחות, שיניים – הן לא "הפתעות", הן הוצאות שמגיעות פעם בכמה חודשים. כשמפרישים להן קצת כל חודש, הרגע שבו הן מגיעות הופך מלחץ ל"זה תוכנן, תהנה".
      </p>

      <div className="hero-row">
        <section className="card hero-card">
          <div className="eyebrow">להפריש כל חודש</div>
          <div className="hero-figure">{money(monthly)}</div>
          <div className="muted">
            {funds.length} קופות · {money(monthly * 12)} בשנה. הסכום הזה כבר מנוכה מ"בטוח להוציא היום".
          </div>
        </section>
      </div>

      <div className="funds-grid">
        {funds.map((f) => {
          const used = f.annualAmount ? f.spentThisYear / f.annualAmount : 0;
          return (
            <article key={f.id} className="card fund">
              <div className="row between">
                <div className="fund-title">
                  <span aria-hidden>{f.icon ?? '🏺'}</span> {f.name}
                </div>
                <button className="ghost small" onClick={() => setEditing(f)}>
                  עריכה
                </button>
              </div>
              <div className="fund-monthly">
                {money(f.monthly)} <span className="muted small">בחודש</span>
              </div>
              <div className="sub">
                {money(f.annualAmount)} בשנה{f.nextDue ? ` · מועד: ${MONTHS[Number(f.nextDue.slice(5, 7)) - 1]}` : ''}
              </div>
              {f.categoryId && (
                <>
                  <Meter value={f.spentThisYear} max={Math.max(f.annualAmount, f.spentThisYear)} tone={used > 1 ? 'warning' : 'accent'} label={`${f.name} מתוך התקציב השנתי`} />
                  <div className="sub">
                    השנה יצא {money(f.spentThisYear)} ({f.categoryName}){f.annualAmount ? ` · ${Math.round(used * 100)}% מהשנתי` : ''}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>

      {editing && (
        <FundForm
          fund={editing}
          categories={categories}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {!editing && (
        <section className="card">
          <div className="row between">
            <h3>להוסיף קופה</h3>
            <button className="ghost small" onClick={() => setEditing({ name: '', annualAmount: 0 })}>
              קופה אחרת
            </button>
          </div>
          <div className="inst-grid">
            {suggestions.map((s) => (
              <button
                key={s.slug}
                className="inst"
                onClick={() => setEditing({ name: s.name, icon: s.icon, categoryId: s.categoryId, annualAmount: s.lastYear })}
              >
                <span>
                  {s.icon} {s.name}
                </span>
                <span className="sub">{s.lastYear > 0 ? `בשנה האחרונה: ${money(s.lastYear)}` : 'להגדיר סכום'}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FundForm({ fund, categories, onDone }: { fund: Partial<Fund>; categories: Category[]; onDone: () => void }) {
  const [name, setName] = useState(fund.name ?? '');
  const [icon, setIcon] = useState(fund.icon ?? '🏺');
  const [annual, setAnnual] = useState(String(Math.round(fund.annualAmount ?? 0)));
  const [due, setDue] = useState(fund.dueMonth ? String(fund.dueMonth) : '');
  const [categoryId, setCategoryId] = useState(fund.categoryId ? String(fund.categoryId) : '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name, icon, annualAmount: Number(annual) || 0, dueMonth: due ? Number(due) : null, categoryId: categoryId ? Number(categoryId) : null };
    if (fund.id) await api(`/funds/${fund.id}`, { method: 'PUT', json: body });
    else await api('/funds', { method: 'POST', json: body });
    onDone();
  };
  const remove = async () => {
    if (!fund.id || !confirm('למחוק את הקופה?')) return;
    await api(`/funds/${fund.id}`, { method: 'DELETE' });
    onDone();
  };

  return (
    <form className="card form" onSubmit={save}>
      <h3>{fund.id ? 'עריכת קופה' : 'קופה חדשה'}</h3>
      <div className="row">
        <label style={{ width: 70 }}>
          סמל
          <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
        </label>
        <label style={{ flex: 1 }}>
          שם
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      </div>
      <label>
        כמה בשנה בערך? (₪)
        <input type="number" min={0} step={50} value={annual} onChange={(e) => setAnnual(e.target.value)} dir="ltr" />
      </label>
      <div className="sub">= {money((Number(annual) || 0) / 12)} להפריש כל חודש</div>
      <label>
        מתי בדרך כלל זה מגיע? (לא חובה)
        <select value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">לאורך השנה</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        לעקוב אחרי קטגוריה
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">בלי</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="primary">שמירה</button>
        <button type="button" className="ghost" onClick={onDone}>
          ביטול
        </button>
        {fund.id && (
          <button type="button" className="ghost danger" onClick={remove}>
            מחיקה
          </button>
        )}
      </div>
    </form>
  );
}
