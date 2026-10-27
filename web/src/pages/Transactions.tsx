import { useEffect, useMemo, useState } from 'react';
import { api, type Account, type Category, type Txn } from '../api';
import { date, moneyExact, monthLabel, currentMonth } from '../format';
import type { Nav } from '../App';
import { CategoryPicker } from '../CategoryPicker';

export function Transactions({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(nav.params.month ?? currentMonth());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState(nav.params.categoryId ?? '');
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUncat, setOnlyUncat] = useState(nav.params.uncategorized === '1');
  const [txns, setTxns] = useState<Txn[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assign, setAssign] = useState<{ txn: Txn; categoryId: number } | null>(null);
  const [reviewFor, setReviewFor] = useState<Txn | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<Category[]>('/categories').then(setCategories);
    api<Account[]>('/accounts').then(setAccounts);
  }, []);

  const load = () => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (accountId) q.set('accountId', accountId);
    if (categoryId) q.set('categoryId', categoryId);
    if (scope) q.set('scope', scope);
    if (search.trim()) q.set('search', search.trim());
    if (onlyUncat) q.set('uncategorized', '1');
    api<Txn[]>(`/transactions?${q}`).then((list) => {
      setTxns(list);
      setSelected((sel) => new Set(list.filter((t) => sel.has(t.id)).map((t) => t.id)));
    });
  };

  // Shift-click selects everything between the last click and this one.
  const toggle = (idx: number, shift: boolean) => {
    const id = txns[idx].id;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      const [a, b] = shift && lastClicked !== null ? [Math.min(lastClicked, idx), Math.max(lastClicked, idx)] : [idx, idx];
      for (let i = a; i <= b; i++) (on ? next.add(txns[i].id) : next.delete(txns[i].id));
      return next;
    });
    setLastClicked(idx);
  };
  const allOn = txns.length > 0 && txns.every((t) => selected.has(t.id));
  const picked = txns.filter((t) => selected.has(t.id));
  useEffect(load, [month, accountId, categoryId, scope, onlyUncat]);

  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    categories.forEach((c) => m.set(c.grp, [...(m.get(c.grp) ?? []), c]));
    return [...m.entries()];
  }, [categories]);

  const months = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 18; i++) {
      out.push(new Date(d.getFullYear(), d.getMonth() - i, 15).toISOString().slice(0, 7));
    }
    return out;
  }, []);

  const update = async (t: Txn, patch: Partial<Pick<Txn, 'categoryId' | 'scope'>>) => {
    await api(`/transactions/${t.id}`, { method: 'PATCH', json: patch });
    setTxns((list) =>
      list.map((x) =>
        x.id === t.id ? { ...x, ...patch, categoryName: categories.find((c) => c.id === (patch.categoryId ?? x.categoryId))?.name ?? x.categoryName } : x,
      ),
    );
  };

  return (
    <div className="stack">
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="חודש">
          <option value="">כל החודשים</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="חשבון">
          <option value="">כל החשבונות</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="קטגוריה">
          <option value="">כל הקטגוריות</option>
          {groups.map(([g, cs]) => (
            <optgroup key={g} label={g}>
              {cs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="עסקי או פרטי">
          <option value="">עסקי + פרטי</option>
          <option value="business">עסקי</option>
          <option value="private">פרטי</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input type="search" placeholder="חיפוש…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <label className="check">
          <input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} />
          רק לא מסווגות
        </label>
      </div>

      {reviewFor && (
        <ReviewDialog
          txn={reviewFor}
          onClose={() => setReviewFor(null)}
          onDone={() => {
            setTxns((list) => list.map((x) => (x.id === reviewFor.id ? { ...x, reviewStatus: 'open' } : x)));
            setReviewFor(null);
          }}
        />
      )}
      {assign && (
        <AssignDialog
          txn={assign.txn}
          category={categories.find((c) => c.id === assign.categoryId)!}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            load();
          }}
        />
      )}

      {notice && (
        <div className="notice toast" role="status">
          {notice}
        </div>
      )}

      <div className="card flush">
        {txns.length === 0 && <div className="muted pad">אין תנועות להצגה.</div>}
        {txns.length > 0 && (
          <div className="select-head">
            <label className="check">
              <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(txns.map((t) => t.id)))} />
              בחירת כל {txns.length} התנועות שברשימה
            </label>
            <span className="muted small">טיפ: לסמן אחת, ללחוץ Shift ולסמן אחרת – וכל מה שביניהן ייבחר.</span>
          </div>
        )}
        <table className="txns">
          <tbody>
            {txns.map((t, i) => (
              <tr key={t.id} className={`${t.categoryKind === 'transfer' ? 'dim' : ''} ${selected.has(t.id) ? 'picked' : ''}`}>
                <td className="pick">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => {}}
                    onClick={(e) => toggle(i, e.shiftKey)}
                    aria-label={`לבחור: ${t.description}`}
                  />
                </td>
                <td className="nowrap muted">{date(t.date)}</td>
                <td className="desc">
                  <div>
                    {t.description}
                    {t.reviewStatus === 'open' && <span className="badge warm">בבירור</span>}
                  </div>
                  <div className="sub">
                    {t.accountLabel}
                    {t.installmentTotal ? ` · תשלום ${t.installmentNumber} מתוך ${t.installmentTotal}` : ''}
                    {t.status === 'pending' ? ' · ממתין' : ''}
                    {t.originalCurrency && t.originalCurrency !== 'ILS' ? ` · ${t.originalAmount} ${t.originalCurrency}` : ''}
                  </div>
                </td>
                <td>
                  <CategoryPicker
                    categories={categories}
                    value={t.categoryId}
                    onPick={(id) => id !== t.categoryId && setAssign({ txn: t, categoryId: id })}
                    onCreated={(c) => setCategories((list) => [...list, c])}
                  />
                </td>
                <td>
                  <button
                    className={t.scope === 'business' ? 'pill biz' : 'pill'}
                    onClick={() => update(t, { scope: t.scope === 'business' ? 'private' : 'business' })}
                    title="החלפה בין עסקי לפרטי"
                  >
                    {t.scope === 'business' ? 'עסקי' : 'פרטי'}
                  </button>
                </td>
                <td className={`amount nowrap ${t.amount > 0 ? 'pos' : ''}`}>{moneyExact(t.amount)}</td>
                <td>
                  {t.reviewStatus !== 'open' && (
                    <button className="review-btn" onClick={() => setReviewFor(t)} title="לא מזהה את החיוב? להעביר לבירור" aria-label={`להעביר לבירור: ${t.description}`}>
                      ❓ לבירור
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {picked.length > 0 && (
        <BulkBar
          picked={picked}
          categories={categories}
          onCreated={(c) => setCategories((list) => [...list, c])}
          onClear={() => setSelected(new Set())}
          onDone={(msg) => {
            setSelected(new Set());
            setNotice(msg);
            setTimeout(() => setNotice(''), 6000);
            load();
          }}
        />
      )}
    </div>
  );
}

function BulkBar({
  picked,
  categories,
  onCreated,
  onClear,
  onDone,
}: {
  picked: Txn[];
  categories: Category[];
  onCreated: (c: Category) => void;
  onClear: () => void;
  onDone: (msg: string) => void;
}) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const total = picked.reduce((s, t) => s + t.amount, 0);
  const category = categories.find((c) => c.id === categoryId);

  const send = async (json: { categoryId?: number; scope?: 'private' | 'business'; remember?: boolean }, msg: (r: { changed: number; rules: number }) => string) => {
    setBusy(true);
    try {
      const r = await api<{ changed: number; rules: number }>('/transactions/bulk-assign', { method: 'POST', json: { ids: picked.map((t) => t.id), ...json } });
      onDone(msg(r));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-bar" role="region" aria-label="פעולה על התנועות שנבחרו">
      <div className="bulk-count">
        <b>נבחרו {picked.length}</b> <span className="muted small">({moneyExact(total)})</span>
      </div>
      <div className="bulk-cat">
        <span className="small">לסווג ל:</span>
        <CategoryPicker categories={categories} value={categoryId} onPick={setCategoryId} onCreated={onCreated} />
      </div>
      <label className="check small" title="כל חיוב מבתי העסק האלה – גם מהעבר וגם בעתיד – ייכנס לקטגוריה הזו אוטומטית">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        לזכור גם לחיובים הבאים מאותם בתי עסק
      </label>
      <button
        className="primary"
        disabled={!category || busy}
        onClick={() =>
          send({ categoryId: categoryId!, remember }, (r) =>
            `סווגו ${r.changed} תנועות ל${category!.name}.${r.rules ? ` נוספו ${r.rules} כללים – מעכשיו זה יקרה לבד.` : ''}`,
          )
        }
      >
        {busy ? 'רגע…' : 'סיווג'}
      </button>
      <span className="bulk-sep" aria-hidden />
      <button className="ghost small" disabled={busy} onClick={() => send({ scope: 'private' }, (r) => `${r.changed} תנועות סומנו כפרטי.`)}>
        פרטי
      </button>
      <button className="ghost small" disabled={busy} onClick={() => send({ scope: 'business' }, (r) => `${r.changed} תנועות סומנו כעסקי.`)}>
        עסקי
      </button>
      <button className="link small" onClick={onClear}>
        ביטול הבחירה
      </button>
    </div>
  );
}

function AssignDialog({ txn, category, onClose, onDone }: { txn: Txn; category: Category; onClose: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<{ key: string; count: number; total: number; currentRule: string | null } | null>(null);
  const [applyTo, setApplyTo] = useState<'merchant' | 'one'>('merchant');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ key: string; count: number; total: number; currentRule: string | null }>(`/transactions/${txn.id}/merchant`).then((r) => {
      setInfo(r);
      if (!r.key) setApplyTo('one');
    });
  }, [txn.id]);

  const save = async () => {
    setBusy(true);
    await api(`/transactions/${txn.id}/assign`, { method: 'POST', json: { categoryId: category.id, applyTo } });
    onDone();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="calm-card" onClick={(e) => e.stopPropagation()}>
        <h3>
          לשייך ל<b>{category.name}</b>
        </h3>
        <div className="muted">{txn.description}</div>
        {info && info.key ? (
          <div className="choice-list">
            <label className={`choice ${applyTo === 'merchant' ? 'on' : ''}`}>
              <input type="radio" checked={applyTo === 'merchant'} onChange={() => setApplyTo('merchant')} />
              <div>
                <b>כל החיובים מבית העסק הזה – מהעבר ומהעתיד</b>
                <div className="sub">
                  {info.count} חיובים עד היום ({moneyExact(info.total)}) יעברו ל{category.name}, וכל חיוב חדש מ"{info.key}" ייכנס לשם אוטומטית.
                  {info.currentRule && info.currentRule !== category.name ? ` (במקום ${info.currentRule})` : ''}
                </div>
              </div>
            </label>
            <label className={`choice ${applyTo === 'one' ? 'on' : ''}`}>
              <input type="radio" checked={applyTo === 'one'} onChange={() => setApplyTo('one')} />
              <div>
                <b>רק התנועה הזו</b>
                <div className="sub">למשל קנייה חד-פעמית שונה מהרגיל.</div>
              </div>
            </label>
          </div>
        ) : (
          <div className="sub">{info ? 'רק התנועה הזו תשתנה.' : 'טוען…'}</div>
        )}
        <div className="row between">
          <button className="ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="primary" onClick={save} disabled={busy || !info}>
            {busy ? 'רגע…' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewDialog({ txn, onClose, onDone }: { txn: Txn; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const save = async () => {
    await api(`/transactions/${txn.id}/review`, { method: 'POST', json: { note } });
    onDone();
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={onClose}>
      <div className="calm-card" onClick={(e) => e.stopPropagation()}>
        <h3 id="review-title">להעביר לבירור</h3>
        <div>
          <b>{txn.description}</b> · {moneyExact(txn.amount)} · {date(txn.date)}
        </div>
        <label>
          מה לא ברור? (לא חובה)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: לא מכיר את השם, הסכום נראה גבוה…" autoFocus />
        </label>
        <p className="sub">החיוב יחכה בלשונית "לבירור" עם רמזים לזיהוי, עד שתסגור אותו.</p>
        <div className="row between">
          <button className="ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="primary" onClick={save}>
            להעביר לבירור
          </button>
        </div>
      </div>
    </div>
  );
}
