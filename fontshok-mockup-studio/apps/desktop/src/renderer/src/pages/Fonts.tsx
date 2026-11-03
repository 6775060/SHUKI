import { useEffect, useState } from 'react';
import type { FontFamily } from '@fontshok/shared';
import type { SiteImportReport } from '../../../main/api';
import { api } from '../api';
import { Empty, useAction, type Toast } from '../ui';

export function FontsPage({ toast }: { toast: Toast }) {
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [form, setForm] = useState({ he: '', en: '', aliases: '' });
  const [aliasDraft, setAliasDraft] = useState<Record<number, string>>({});
  const [report, setReport] = useState<SiteImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const { run } = useAction(toast);
  const load = () => api.listFonts().then(setFonts);
  useEffect(() => {
    void load();
  }, []);

  const importCsv = async (file: File) =>
    run('csv', async () => {
      const r = await api.importCatalogCsv(await file.text());
      toast(r.errors.length ? 'error' : 'ok', `יובאו ${r.added} משפחות, ${r.aliasesAdded} כינויים${r.conflicts.length ? ` · התנגשויות: ${r.conflicts.join(', ')}` : ''}${r.errors.length ? ` · שגיאות: ${r.errors.join('; ')}` : ''}`, 10000);
      await load();
    });

  const importSite = () =>
    run('site', async () => {
      setImporting(true);
      try {
        const r = await api.importFontsFromSite();
        setReport(r);
        toast(r.errors.length ? 'error' : 'ok', `נמצאו ${r.fontsOnSite} פונטים באתר · ${r.added.length} חדשים · ${r.aliasesAdded} כינויים חדשים`, 8000);
        await load();
      } finally {
        setImporting(false);
      }
    });

  return (
    <div className="split">
      <section className="panel list">
        <h2>ייבוא מאתר פונטשוק</h2>
        <p className="muted small">קורא את תפריט הפונטים ב־fontshok.co.il ואת עמוד כל פונט, ומוסיף את השמות הטכניים שבהם הפונט מוטמע באתרים.</p>
        <button className="primary" disabled={importing} onClick={() => void importSite()}>
          {importing ? 'מייבא…' : 'ייבוא / עדכון מהאתר'}
        </button>
        {report && (
          <div className="small">
            <p>
              באתר: {report.fontsOnSite} · חדשים: {report.added.length} · עודכנו: {report.updated.length} · כינויים חדשים: {report.aliasesAdded}
            </p>
            {report.conflicts.length > 0 && <p className="warn">כינויים ששייכים כבר לפונט אחר: <span dir="ltr">{report.conflicts.join(', ')}</span></p>}
            {report.missingFromSite.length > 0 && <p className="warn">במאגר אבל לא בתפריט האתר (לא בוטלו): {report.missingFromSite.join(', ')}</p>}
            {report.unassigned.length > 0 && (
              <>
                <p className="muted">שמות שנמצאו בעמודי הפונטים ולא שויכו אוטומטית, אפשר להוסיף ידנית ככינוי:</p>
                <ul>
                  {report.unassigned.map((u) => (
                    <li key={u.font + u.name}>
                      {u.font}: <span dir="ltr">{u.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {report.errors.length > 0 && <p className="error">שגיאות: {report.errors.join('; ')}</p>}
          </div>
        )}
        <h2>הוספת משפחת פונט</h2>
        <label>שם בעברית</label>
        <input value={form.he} onChange={(e) => setForm({ ...form, he: e.target.value })} placeholder="דיסקברי" />
        <label>שם באנגלית</label>
        <input dir="ltr" value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} placeholder="Discovery" />
        <label>כינויים (שמות CSS / שמות קבצים, מופרדים בפסיק)</label>
        <input dir="ltr" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="FS Discovery, discovery-fs" />
        <button
          className="primary"
          disabled={!form.he.trim()}
          onClick={() =>
            run('add', async () => {
              setFonts(await api.addFont(form.he, form.en || null, form.aliases.split(',')));
              setForm({ he: '', en: '', aliases: '' });
            }, 'נוסף')
          }
        >
          הוסף
        </button>
        <h2>ייבוא CSV</h2>
        <p className="muted small" dir="ltr">name_he,name_en,aliases (aliases separated by |)</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
      </section>
      <section className="panel detail">
        <h2>מאגר הפונטים ({fonts.length})</h2>
        {fonts.length === 0 ? (
          <Empty>המאגר ריק. לחץ על "ייבוא / עדכון מהאתר" כדי לטעון את הפונטים מאתר פונטשוק.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>עברית</th>
                <th>אנגלית</th>
                <th>כינויים</th>
                <th>פעיל</th>
              </tr>
            </thead>
            <tbody>
              {fonts.map((f) => (
                <tr key={f.id} className={f.active ? '' : 'muted'}>
                  <td>{f.nameHe}</td>
                  <td dir="ltr">{f.nameEn}</td>
                  <td>
                    <div className="chips">
                      {f.aliases.map((a) => (
                        <span key={a.id} className="chip" dir="ltr">
                          {a.alias}
                          <button title="הסר" onClick={() => run('rm', async () => { await api.removeAlias(a.id); await load(); })}>
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        className="chip-input"
                        dir="ltr"
                        placeholder="+ כינוי"
                        value={aliasDraft[f.id] ?? ''}
                        onChange={(e) => setAliasDraft({ ...aliasDraft, [f.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || !aliasDraft[f.id]?.trim()) return;
                          void run('alias', async () => {
                            const r = await api.addAlias(f.id, aliasDraft[f.id]!);
                            if (r.conflict) toast('error', 'הכינוי כבר שייך למשפחה אחרת');
                            setAliasDraft({ ...aliasDraft, [f.id]: '' });
                            await load();
                          });
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <input type="checkbox" checked={f.active} onChange={(e) => run('act', async () => { await api.setFontActive(f.id, e.target.checked); await load(); })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
