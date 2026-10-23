import { useEffect, useState } from 'react';
import { api } from '../api';

interface Rule {
  id: number;
  pattern: string;
  categoryName: string;
  scope: string | null;
  accountKind: string | null;
  isDefault: number;
}

export function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api<Rule[]>('/rules').then(setRules);
  useEffect(() => {
    load();
  }, []);

  const remove = async (id: number) => {
    await api(`/rules/${id}`, { method: 'DELETE' });
    load();
  };

  const rerun = async () => {
    const r = await api<{ changed: number }>('/recategorize', { method: 'POST' });
    setMsg(`${r.changed} תנועות עודכנו. תנועות שסיווגת ידנית לא שונו.`);
  };

  const shown = rules.filter((r) => !filter || r.pattern.includes(filter) || r.categoryName.includes(filter));
  const mine = shown.filter((r) => !r.isDefault);
  const defaults = shown.filter((r) => r.isDefault);

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="title">כללי סיווג</h2>
        <button className="ghost small" onClick={rerun}>
          להריץ את הכללים מחדש
        </button>
      </div>
      <p className="muted">
        כשמשנים קטגוריה בתנועה, המערכת מציעה ליצור כלל. הכללים שלך קודמים לכללי ברירת המחדל.
      </p>
      {msg && <div className="success">{msg}</div>}
      <input type="search" placeholder="חיפוש כלל…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <section className="card">
        <h3>הכללים שלי ({mine.length})</h3>
        {mine.length === 0 && <div className="muted">עדיין אין. הם נוצרים מתוך מסך התנועות.</div>}
        {mine.map((r) => (
          <div key={r.id} className="split-row">
            <span>"{r.pattern.trim()}"</span>
            <span>← {r.categoryName}</span>
            <button className="ghost small danger" onClick={() => remove(r.id)}>
              מחיקה
            </button>
          </div>
        ))}
      </section>

      <details className="card">
        <summary>כללי ברירת מחדל ({defaults.length})</summary>
        {defaults.map((r) => (
          <div key={r.id} className="split-row">
            <span>"{r.pattern.trim()}"</span>
            <span className="muted">
              ← {r.categoryName}
              {r.accountKind === 'bank' ? ' (רק בבנק)' : ''}
            </span>
            <button className="ghost small" onClick={() => remove(r.id)}>
              הסרה
            </button>
          </div>
        ))}
      </details>
    </div>
  );
}
