import { useEffect, useMemo, useState } from 'react';
import { api, type Account, type Category, type Txn } from '../api';
import { date, moneyExact, monthLabel, currentMonth } from '../format';
import type { Nav } from '../App';

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
  const [ruleFor, setRuleFor] = useState<Txn | null>(null);

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
    api<Txn[]>(`/transactions?${q}`).then(setTxns);
  };
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
    if (patch.categoryId !== undefined) setRuleFor({ ...t, categoryId: patch.categoryId });
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

      {ruleFor && <RuleSuggestion txn={ruleFor} categories={categories} onClose={() => setRuleFor(null)} onApplied={load} />}

      <div className="card flush">
        {txns.length === 0 && <div className="muted pad">אין תנועות להצגה.</div>}
        <table className="txns">
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} className={t.categoryKind === 'transfer' ? 'dim' : ''}>
                <td className="nowrap muted">{date(t.date)}</td>
                <td className="desc">
                  <div>{t.description}</div>
                  <div className="sub">
                    {t.accountLabel}
                    {t.installmentTotal ? ` · תשלום ${t.installmentNumber} מתוך ${t.installmentTotal}` : ''}
                    {t.status === 'pending' ? ' · ממתין' : ''}
                    {t.originalCurrency && t.originalCurrency !== 'ILS' ? ` · ${t.originalAmount} ${t.originalCurrency}` : ''}
                  </div>
                </td>
                <td>
                  <select value={t.categoryId ?? ''} onChange={(e) => update(t, { categoryId: Number(e.target.value) })} aria-label="קטגוריה">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuleSuggestion({ txn, categories, onClose, onApplied }: { txn: Txn; categories: Category[]; onClose: () => void; onApplied: () => void }) {
  const [pattern, setPattern] = useState(txn.description.split(/\s+/).slice(0, 2).join(' '));
  const [msg, setMsg] = useState('');
  const category = categories.find((c) => c.id === txn.categoryId);

  const save = async () => {
    const r = await api<{ changed: number }>('/rules', { method: 'POST', json: { pattern, categoryId: txn.categoryId } });
    setMsg(`נשמר. ${r.changed} תנועות סווגו מחדש.`);
    onApplied();
    setTimeout(onClose, 1800);
  };

  return (
    <div className="card rule-box">
      {msg ? (
        <div>{msg}</div>
      ) : (
        <>
          <div>
            לסווג תמיד תנועות שמכילות <input value={pattern} onChange={(e) => setPattern(e.target.value)} className="inline" /> בתור{' '}
            <b>{category?.name}</b>?
          </div>
          <div className="row">
            <button className="primary small" onClick={save} disabled={pattern.trim().length < 2}>
              כן, ליצור כלל
            </button>
            <button className="ghost small" onClick={onClose}>
              רק הפעם
            </button>
          </div>
        </>
      )}
    </div>
  );
}
