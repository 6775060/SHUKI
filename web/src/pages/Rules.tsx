import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type Category } from '../api';
import { CategoryPicker } from '../CategoryPicker';

interface Rule {
  id: number;
  pattern: string;
  categoryId: number;
  categoryName: string;
  scope: string | null;
  accountKind: string | null;
  isDefault: number;
  match: 'contains' | 'merchant';
}

type Cat = Category & { txnCount?: number };

export function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [newGrp, setNewGrp] = useState('הקטגוריות שלי');
  const [pattern, setPattern] = useState('');
  const [patternCat, setPatternCat] = useState<number | null>(null);

  const load = () => {
    api<Rule[]>('/rules').then(setRules);
    api<Cat[]>('/categories').then(setCats);
  };
  useEffect(load, []);

  const groups = useMemo(() => {
    const m = new Map<string, Cat[]>();
    for (const c of cats) if (!filter || c.name.includes(filter) || c.grp.includes(filter)) m.set(c.grp, [...(m.get(c.grp) ?? []), c]);
    return [...m.entries()];
  }, [cats, filter]);

  const merchantRules = rules.filter((r) => r.match === 'merchant' && (!filter || r.pattern.includes(filter.toUpperCase()) || r.pattern.includes(filter) || r.categoryName.includes(filter)));
  const wordRules = rules.filter((r) => r.match !== 'merchant' && !r.isDefault);
  const defaults = rules.filter((r) => r.isDefault && (!filter || r.pattern.includes(filter) || r.categoryName.includes(filter)));

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    await api('/categories', { method: 'POST', json: { name: newName.trim(), grp: newGrp.trim() || 'הקטגוריות שלי', kind: 'expense' } });
    setMsg(`נוספה הקטגוריה "${newName.trim()}".`);
    setNewName('');
    load();
  };

  const rename = async (id: number) => {
    if (editName.trim()) await api(`/categories/${id}`, { method: 'PATCH', json: { name: editName.trim() } });
    setEditing(null);
    load();
  };

  const removeCat = async (c: Cat) => {
    if (!confirm(`למחוק את "${c.name}"? ${c.txnCount ?? 0} תנועות יחזרו לסיווג אוטומטי.`)) return;
    await api(`/categories/${c.id}`, { method: 'DELETE' });
    load();
  };

  const removeRule = async (id: number) => {
    await api(`/rules/${id}`, { method: 'DELETE' });
    load();
  };

  const addRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!patternCat) return;
    const r = await api<{ changed: number }>('/rules', { method: 'POST', json: { pattern: pattern.trim(), categoryId: patternCat } });
    setMsg(`נשמר. ${r.changed} תנועות סווגו מחדש.`);
    setPattern('');
    load();
  };

  return (
    <div className="stack">
      <h2 className="title">קטגוריות וכללים</h2>
      <p className="muted">
        הדרך הכי מהירה: במסך התנועות בוחרים קטגוריה לחיוב, ובוחרים "כל החיובים מבית העסק הזה". מאותו רגע כל חיוב ממנו – מהעבר ומהעתיד – נכנס לשם לבד.
      </p>
      {msg && <div className="success">{msg}</div>}
      <input type="search" placeholder="חיפוש קטגוריה, בית עסק או כלל…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="grid-main">
        <section className="card">
          <h3>הקטגוריות</h3>
          <form className="row wrap add-cat" onSubmit={addCategory}>
            <input placeholder="קטגוריה חדשה, למשל: מכון כושר" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input list="cat-groups" placeholder="קבוצה" value={newGrp} onChange={(e) => setNewGrp(e.target.value)} />
            <datalist id="cat-groups">
              {[...new Set(cats.map((c) => c.grp))].map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button className="primary small" disabled={!newName.trim()}>
              הוספה
            </button>
          </form>
          {groups.map(([g, cs]) => (
            <div key={g} className="cat-group">
              <div className="picker-grp">{g}</div>
              {cs.map((c) => (
                <div key={c.id} className="split-row">
                  {editing === c.id ? (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename(c.id);
                      }}
                    >
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                      <button className="primary small">שמירה</button>
                    </form>
                  ) : (
                    <span>{c.name}</span>
                  )}
                  <span className="muted small">{c.txnCount ?? 0} תנועות</span>
                  <span className="row">
                    <button
                      className="ghost small"
                      onClick={() => {
                        setEditing(c.id);
                        setEditName(c.name);
                      }}
                    >
                      שינוי שם
                    </button>
                    {!c.slug && (
                      <button className="ghost small danger" onClick={() => removeCat(c)}>
                        מחיקה
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>

        <div className="stack">
          <section className="card">
            <h3>בתי עסק שקבעת ({merchantRules.length})</h3>
            {merchantRules.length === 0 && <div className="muted">עדיין אין. הם נוצרים כשמשייכים חיוב לקטגוריה במסך התנועות.</div>}
            {merchantRules.map((r) => (
              <div key={r.id} className="split-row">
                <span>🏪 {r.pattern}</span>
                <span>← {r.categoryName}</span>
                <button className="ghost small danger" onClick={() => removeRule(r.id)}>
                  הסרה
                </button>
              </div>
            ))}
          </section>

          <section className="card">
            <h3>כלל לפי מילה</h3>
            <p className="sub">כל תנועה שמכילה את המילה תסווג לקטגוריה. למשל "כושר" ← מכון כושר.</p>
            <form className="form" onSubmit={addRule}>
              <input placeholder="מילה או חלק משם בית העסק" value={pattern} onChange={(e) => setPattern(e.target.value)} />
              <CategoryPicker categories={cats} value={patternCat} onPick={setPatternCat} onCreated={(c) => setCats((l) => [...l, c])} />
              <button className="primary small" disabled={pattern.trim().length < 2 || !patternCat}>
                שמירה והחלה על כל התנועות
              </button>
            </form>
            {wordRules.map((r) => (
              <div key={r.id} className="split-row">
                <span>"{r.pattern.trim()}"</span>
                <span>← {r.categoryName}</span>
                <button className="ghost small danger" onClick={() => removeRule(r.id)}>
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
                <button className="ghost small" onClick={() => removeRule(r.id)}>
                  הסרה
                </button>
              </div>
            ))}
          </details>
        </div>
      </div>
    </div>
  );
}
