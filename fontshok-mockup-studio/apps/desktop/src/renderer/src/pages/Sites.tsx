import { useEffect, useState } from 'react';
import type { Finding, FindingField, FontFamily } from '@fontshok/shared';
import type { SiteDetail, SiteSummary } from '../../../main/api';
import { api } from '../api';
import { Badge, Confidence, Empty, FIELD_HE, STATUS_HE, useAction, type Toast } from '../ui';

export function SitesPage({ tick, toast }: { tick: number; toast: Toast }) {
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [urls, setUrls] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const { busy, run } = useAction(toast);

  useEffect(() => {
    void api.listSites().then(setSites).catch((e) => toast('error', String(e)));
  }, [tick, toast]);

  const add = () =>
    run('add', async () => {
      const r = await api.addSites(urls.split(/[\s,]+/));
      setUrls('');
      const parts = [`נוספו ${r.added.length}`];
      if (r.duplicates.length) parts.push(`כפולים: ${r.duplicates.join(', ')}`);
      if (r.invalid.length) parts.push(`לא תקינים: ${r.invalid.join(', ')}`);
      toast(r.invalid.length ? 'error' : 'ok', parts.join(' · '));
      if (r.added.length) await api.scanSites(r.added.map((s) => s.id));
    });

  const notScanned = sites.filter((s) => !s.scan || s.scan.status === 'failed').map((s) => s.site.id);

  return (
    <div className="split">
      <section className="panel list">
        <h2>הוספת אתרים</h2>
        <textarea dir="ltr" rows={4} placeholder={'https://example.co.il\nwww.another-site.com'} value={urls} onChange={(e) => setUrls(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={!urls.trim() || busy === 'add'} onClick={add}>
            הוסף וסרוק
          </button>
          <button disabled={notScanned.length === 0} onClick={() => run('scan', () => api.scanSites(notScanned), 'הסריקה התחילה')}>
            סרוק את כל מה שלא נסרק ({notScanned.length})
          </button>
        </div>
        <h2>
          אתרים <small>{sites.filter((s) => s.ready).length} מוכנים מתוך {sites.length}</small>
        </h2>
        {sites.length === 0 ? (
          <Empty>עוד לא נוספו אתרים</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>דומיין</th>
                <th>סריקה</th>
                <th>פונטים מאושרים</th>
                <th>מצב</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.site.id} className={selected === s.site.id ? 'sel' : ''} onClick={() => setSelected(s.site.id)}>
                  <td dir="ltr">{s.site.canonicalDomain}</td>
                  <td>
                    {s.scan ? <Badge tone={s.scan.status === 'done' ? 'ok' : s.scan.status === 'failed' ? 'bad' : 'accent'}>{STATUS_HE[s.scan.status]}</Badge> : <Badge>—</Badge>}
                  </td>
                  <td>{s.confirmedFonts.join(', ') || '—'}</td>
                  <td>
                    {s.exported ? <Badge tone="ok">יוצא</Badge> : s.inGroup ? <Badge tone="accent">{s.inGroup}</Badge> : s.ready ? <Badge tone="ok">מוכן</Badge> : <Badge tone="warn">חסר: {s.missing.join(', ')}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel detail">{selected ? <SiteDetailView siteId={selected} tick={tick} toast={toast} /> : <Empty>בחרו אתר כדי לסקור את הממצאים</Empty>}</section>
    </div>
  );
}

const ORDER: FindingField[] = ['font', 'project_name', 'designer', 'developer', 'brand_color', 'source_url'];

function SiteDetailView({ siteId, tick, toast }: { siteId: number; tick: number; toast: Toast }) {
  const [d, setD] = useState<SiteDetail | null>(null);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [meta, setMeta] = useState({ projectName: '', siteType: '' });
  const [manual, setManual] = useState<{ field: FindingField; value: string; fontId: string }>({ field: 'designer', value: '', fontId: '' });
  const { run } = useAction(toast);

  const load = () =>
    api.getSiteDetail(siteId).then((x) => {
      setD(x);
      setMeta({ projectName: x.site.projectName ?? '', siteType: x.site.siteType ?? '' });
    });
  useEffect(() => {
    void load().catch((e) => toast('error', String(e)));
    void api.listFonts().then(setFonts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, tick]);

  if (!d) return <Empty>טוען…</Empty>;
  const byField = new Map<FindingField, Finding[]>();
  for (const f of d.findings) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);

  const setStatus = (f: Finding, status: 'confirmed' | 'rejected' | 'suggested') => run('st', async () => {
    await api.setFindingStatus(f.id, status);
    await load();
  });

  return (
    <div className="site-detail">
      <div className="detail-head">
        <h2 dir="ltr">{d.site.canonicalDomain}</h2>
        <button onClick={() => run('rescan', () => api.scanSites([siteId]), 'סריקה חוזרת התחילה')}>סריקה חוזרת</button>
      </div>
      <div className="detail-grid">
        <div>
          <div className="card">
            <h3>פרטי פרויקט (מוצגים במוקאפ)</h3>
            <label>שם הפרויקט</label>
            <input value={meta.projectName} placeholder="למשל: Zinka" onChange={(e) => setMeta({ ...meta, projectName: e.target.value })} />
            <label>סוג האתר (אופציונלי – "גם באתר <b>הסטודיו</b>…")</label>
            <input value={meta.siteType} placeholder="הסטודיו / חברת / הקולינרי" onChange={(e) => setMeta({ ...meta, siteType: e.target.value })} />
            <button className="primary" onClick={() => run('meta', () => api.updateSiteMeta(siteId, meta.projectName, meta.siteType), 'נשמר')}>
              שמור
            </button>
          </div>

          {ORDER.map((field) => (
            <div className="card" key={field}>
              <h3>{FIELD_HE[field]}</h3>
              {(byField.get(field) ?? []).length === 0 ? (
                <p className="muted">{field === 'designer' ? 'לא נמצא קרדיט – יוצג "לא ידוע" ולא ינוחש שם.' : 'לא נמצא'}</p>
              ) : (
                (byField.get(field) ?? []).map((f) => (
                  <div className={`finding ${f.status}`} key={f.id}>
                    <div className="finding-main">
                      {field === 'brand_color' && <span className="swatch" style={{ background: f.value }} />}
                      <b>{f.value}</b> <Confidence value={f.confidence} /> <Badge tone={f.status === 'confirmed' ? 'ok' : f.status === 'rejected' ? 'bad' : 'neutral'}>{STATUS_HE[f.status]}</Badge>
                      <span className="muted small">{f.method}</span>
                    </div>
                    <details className="evidence">
                      <summary>ראיה: {f.evidence.source}</summary>
                      {f.evidence.snippet && <pre>{f.evidence.snippet}</pre>}
                      {f.evidence.url && <div dir="ltr" className="small">{f.evidence.url}</div>}
                      {f.evidence.selector && <div dir="ltr" className="small">{f.evidence.selector}</div>}
                      {f.evidence.extra && <pre dir="ltr" className="small">{JSON.stringify(f.evidence.extra)}</pre>}
                    </details>
                    <div className="row">
                      {f.status !== 'confirmed' && <button onClick={() => setStatus(f, 'confirmed')}>אשר</button>}
                      {f.status !== 'rejected' && <button onClick={() => setStatus(f, 'rejected')}>דחה</button>}
                      {f.status !== 'suggested' && <button onClick={() => setStatus(f, 'suggested')}>בטל</button>}
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}

          <div className="card">
            <h3>הוספה ידנית (נשמר כראיה "הוזן ידנית")</h3>
            <div className="row">
              <select value={manual.field} onChange={(e) => setManual({ ...manual, field: e.target.value as FindingField })}>
                {(['designer', 'developer', 'font', 'project_name', 'brand_color'] as FindingField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_HE[f]}
                  </option>
                ))}
              </select>
              {manual.field === 'font' ? (
                <select value={manual.fontId} onChange={(e) => setManual({ ...manual, fontId: e.target.value })}>
                  <option value="">בחרו פונט…</option>
                  {fonts.filter((f) => f.active).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nameHe}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={manual.value} placeholder={manual.field === 'brand_color' ? '#F89E38' : ''} onChange={(e) => setManual({ ...manual, value: e.target.value })} />
              )}
              <button
                className="primary"
                onClick={() =>
                  run('manual', async () => {
                    const font = fonts.find((f) => String(f.id) === manual.fontId);
                    await api.addManualFinding(siteId, manual.field, manual.field === 'font' ? font?.nameHe ?? '' : manual.value, manual.field === 'font' ? font?.id ?? null : null);
                    setManual({ ...manual, value: '', fontId: '' });
                    await load();
                  }, 'נוסף')
                }
              >
                הוסף
              </button>
            </div>
          </div>
        </div>
        <div className="shot-col">{d.fullScreenshotDataUrl ? <img className="fullshot" src={d.fullScreenshotDataUrl} alt="" /> : <Empty>אין צילום</Empty>}</div>
      </div>
    </div>
  );
}
