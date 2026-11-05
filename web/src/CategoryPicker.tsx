import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Category } from './api';

// A searchable category chooser. Type to filter; if nothing fits, create the
// category right there.

export function CategoryPicker({
  categories,
  value,
  onPick,
  onCreated,
  label,
}: {
  categories: Category[];
  value: number | null;
  onPick: (id: number) => void;
  onCreated?: (c: Category) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = categories.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onScroll = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const groups = useMemo(() => [...new Set(categories.map((c) => c.grp))], [categories]);
  const filtered = useMemo(() => {
    const t = q.trim();
    const m = new Map<string, Category[]>();
    for (const c of categories) {
      if (t && !c.name.includes(t) && !c.grp.includes(t)) continue;
      m.set(c.grp, [...(m.get(c.grp) ?? []), c]);
    }
    return [...m.entries()];
  }, [categories, q]);
  const exact = categories.some((c) => c.name === q.trim());

  const pick = (id: number) => {
    setOpen(false);
    setQ('');
    onPick(id);
  };

  const create = async () => {
    const name = q.trim();
    const g = grp || 'הקטגוריות שלי';
    const r = await api<{ id: number }>('/categories', { method: 'POST', json: { name, grp: g, kind: 'expense' } });
    const c: Category = { id: r.id, slug: null, name, grp: g, kind: 'expense' };
    onCreated?.(c);
    pick(r.id);
  };

  return (
    <div className="picker" ref={box}>
      <button
        type="button"
        className="picker-btn"
        onClick={(e) => {
          // Fixed position, so a scrolling table doesn't clip the list.
          const r = e.currentTarget.getBoundingClientRect();
          const top = r.bottom + 360 > window.innerHeight ? Math.max(8, r.top - 364) : r.bottom + 4;
          setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
          setOpen(!open);
        }} aria-haspopup="listbox" aria-expanded={open} aria-label={label ?? 'קטגוריה'}>
        <span>{current?.name ?? 'בחירת קטגוריה'}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="picker-pop" role="dialog" style={pos ? { top: pos.top, right: pos.right } : undefined}>
          <input
            ref={input}
            className="picker-search"
            placeholder="חיפוש או קטגוריה חדשה…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter') {
                const first = filtered[0]?.[1][0];
                if (first) pick(first.id);
                else if (q.trim()) void create();
              }
            }}
          />
          <div className="picker-list" role="listbox">
            {filtered.map(([g, cs]) => (
              <div key={g}>
                <div className="picker-grp">{g}</div>
                {cs.map((c) => (
                  <button key={c.id} type="button" role="option" aria-selected={c.id === value} className={c.id === value ? 'picker-opt sel' : 'picker-opt'} onClick={() => pick(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="muted small pad-s">לא נמצאה קטגוריה.</div>}
          </div>
          {q.trim() && !exact && (
            <div className="picker-new">
              <div className="small">
                ליצור קטגוריה חדשה: <b>{q.trim()}</b>
              </div>
              <div className="row">
                <select value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="קבוצה">
                  <option value="">בקבוצה: הקטגוריות שלי</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      בקבוצה: {g}
                    </option>
                  ))}
                </select>
                <button type="button" className="primary small" onClick={create}>
                  יצירה
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
