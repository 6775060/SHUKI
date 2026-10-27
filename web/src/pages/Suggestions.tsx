import { useEffect, useState } from 'react';
import { api, type Category, type CategoryCleanup, type CategorySuggestion } from '../api';
import { moneyExact, money } from '../format';
import { CategoryPicker } from '../CategoryPicker';

// Smart suggestions for the categories page: what unknown charges probably
// are, and how the category list itself could be tidier. Nothing changes
// until the user approves it.

export function Suggestions({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [sugg, setSugg] = useState<CategorySuggestion[]>([]);
  const [cleanups, setCleanups] = useState<CategoryCleanup[]>([]);
  const [chosen, setChosen] = useState<Record<string, number | null>>({});
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cats, setCats] = useState(categories);
  useEffect(() => setCats(categories), [categories]);

  const load = () =>
    api<{ categories: CategorySuggestion[]; cleanups: CategoryCleanup[] }>('/suggestions').then((r) => {
      setSugg(r.categories);
      setCleanups(r.cleanups);
      setChosen(Object.fromEntries(r.categories.map((s) => [s.key, s.categoryId])));
    });
  useEffect(() => {
    load();
  }, []);

  const picked = sugg.filter((s) => chosen[s.key]);
  const visible = showAll ? sugg : sugg.slice(0, 12);

  const applyAll = async () => {
    setBusy(true);
    let changed = 0;
    for (const s of picked) {
      const r = await api<{ changed: number }>('/transactions/bulk-assign', { method: 'POST', json: { ids: s.ids, categoryId: chosen[s.key], remember: true } });
      changed += r.changed;
    }
    setMsg(`סווגו ${changed} תנועות מ-${picked.length} בתי עסק, ונוספו כללים – מעכשיו זה יקרה לבד.`);
    setBusy(false);
    load();
    onChanged();
  };

  const act = async (c: CategoryCleanup) => {
    setBusy(true);
    if (c.kind === 'merge') {
      const r = await api<{ moved: number }>(`/categories/${c.categoryId}/merge`, { method: 'POST', json: { into: c.intoId } });
      setMsg(`"${c.categoryName}" אוחדה לתוך "${c.intoName}" (${r.moved} תנועות).`);
    } else if (c.kind === 'regroup') {
      await api(`/categories/${c.categoryId}`, { method: 'PATCH', json: { grp: c.grp } });
      setMsg(`"${c.categoryName}" עברה לקבוצה "${c.grp}".`);
    } else {
      await api(`/categories/${c.categoryId}`, { method: 'DELETE' });
      setMsg(`"${c.categoryName}" נמחקה.`);
    }
    setBusy(false);
    load();
    onChanged();
  };

  const openCleanups = cleanups.filter((c) => !hidden.has(c.categoryId));
  if (!sugg.length && !openCleanups.length) return msg ? <div className="notice">{msg}</div> : null;

  return (
    <>
      {msg && <div className="notice">{msg}</div>}

      {sugg.length > 0 && (
        <section className="card">
          <div className="row between wrap">
            <h3>💡 הצעות לסיווג אוטומטי</h3>
            <span className="muted small">
              {sugg.length} בתי עסק לא מסווגים · {money(sugg.reduce((s, x) => s + x.total, 0))}
            </span>
          </div>
          <p className="vcard-sub">
            לפי מה שהשם של בית העסק אומר (קצב, פיצרייה, חניה…) ולפי מה שכבר סיווגת בעבר. מסמנים, משנים אם צריך – ומאשרים. הכלל נשמר, והחיובים הבאים יסווגו לבד.
          </p>
          {visible.map((s) => (
            <div key={s.key} className="sugg-row">
              <input
                type="checkbox"
                checked={!!chosen[s.key]}
                onChange={(e) => setChosen((c) => ({ ...c, [s.key]: e.target.checked ? s.categoryId : null }))}
                aria-label={`לאשר: ${s.description}`}
              />
              <div>
                <b>{s.description}</b>{' '}
                <span className="muted small">
                  · {s.count > 1 ? `${s.count} חיובים, ` : ''}
                  {moneyExact(s.total)}
                </span>
                <div className="sub">
                  {s.confidence === 'high' ? '✓✓' : '✓'} {s.reason}
                </div>
              </div>
              <CategoryPicker
                categories={cats}
                value={chosen[s.key] ?? s.categoryId}
                onPick={(id) => setChosen((c) => ({ ...c, [s.key]: id }))}
                onCreated={(c) => setCats((l) => [...l, c])}
              />
            </div>
          ))}
          <div className="sugg-actions">
            <button className="primary" disabled={!picked.length || busy} onClick={applyAll}>
              {busy ? 'רגע…' : `אישור ${picked.length} הצעות`}
            </button>
            {sugg.length > 12 && (
              <button className="link small" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'להציג פחות' : `להציג את כל ${sugg.length}`}
              </button>
            )}
          </div>
        </section>
      )}

      {openCleanups.length > 0 && (
        <section className="card">
          <h3>🧹 סידור הקטגוריות</h3>
          <p className="vcard-sub">פחות קטגוריות, ובמקום הנכון – כך הגרפים מראים תמונה ברורה. "קבוצה" היא קטגוריית האב שבה הקטגוריה מופיעה בגרפים.</p>
          {openCleanups.map((c) => (
            <div key={c.categoryId} className="sugg-row">
              <span aria-hidden>{c.kind === 'merge' ? '🔗' : c.kind === 'regroup' ? '📂' : '🗑️'}</span>
              <div>
                <b>{c.categoryName}</b>{' '}
                <span className="muted small">
                  · {c.txnCount} תנועות בשנה{c.total ? `, ${money(c.total)}` : ''}
                </span>
                <div className="sub">{c.reason}</div>
              </div>
              <div className="sugg-actions">
                <button className="ghost small" disabled={busy} onClick={() => act(c)}>
                  {c.kind === 'merge' ? (
                    <>
                      איחוד לתוך <span className="sugg-to">{c.intoName}</span>
                    </>
                  ) : c.kind === 'regroup' ? (
                    <>
                      העברה ל<span className="sugg-to">{c.grp}</span>
                    </>
                  ) : (
                    'מחיקה'
                  )}
                </button>
                <button className="link small" onClick={() => setHidden((h) => new Set(h).add(c.categoryId))}>
                  לא עכשיו
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
