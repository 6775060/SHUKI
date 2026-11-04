import { useEffect, useState } from 'react';
import { rgbToHex, hexToRgb, type MockupContent, type TemplateRecord } from '@fontshok/shared';
import type { GroupView, MockupView } from '../../../main/api';
import { api } from '../api';
import { Badge, Empty, STATUS_HE, useAction, type Toast } from '../ui';

export function GroupsPage({ tick, figmaConnected, toast }: { tick: number; figmaConnected: boolean; toast: Toast }) {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [editing, setEditing] = useState<MockupView | null>(null);
  const { busy, run } = useAction(toast);

  const load = () => Promise.all([api.listGroups().then(setGroups), api.listTemplates().then(setTemplates)]);
  useEffect(() => {
    void load().catch((e) => toast('error', String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <div className="groups-page">
      <div className="toolbar">
        <button disabled={!figmaConnected || !!busy} onClick={() => run('sync', async () => { await api.syncTemplates(); await load(); }, 'התבניות סונכרנו מ־Figma')}>
          סנכרון תבניות מ־Figma ({templates.length})
        </button>
        <button
          className="primary"
          disabled={!!busy || templates.length === 0}
          onClick={() =>
            run('propose', async () => {
              const r = await api.proposeGroups();
              toast(r.created.length ? 'ok' : 'info', r.created.length ? `נוצרו ${r.created.length} קבוצות: ${r.created.join(', ')}` : 'אין מספיק אתרים מוכנים עם 4 פונטים שונים');
              if (r.leftovers.length) toast('info', `לא שובצו: ${r.leftovers.map((l) => l.domain).join(', ')}`, 9000);
            })
          }
        >
          יצירת קבוצות אוטומטית (4 אתרים × 4 פונטים)
        </button>
        {!figmaConnected && <span className="muted">יש לפתוח את הפלאגין ב־Figma Desktop כדי לבנות ולייצא</span>}
      </div>

      {groups.length === 0 && <Empty>אין קבוצות. אשרו ממצאים במסך האתרים ואז צרו קבוצות.</Empty>}

      {groups.map((g) => {
        const allApproved = g.mockups.length === 4 && g.mockups.every((m) => m.approved || m.status === 'exported');
        return (
          <section key={g.id} className="panel group">
            <div className="group-head">
              <h2>
                {g.code} <Badge tone={g.status === 'exported' ? 'ok' : g.status === 'approved' ? 'accent' : 'neutral'}>{STATUS_HE[g.status]}</Badge>
              </h2>
              <div className="row">
                <button disabled={!figmaConnected || !!busy || g.status === 'exported'} onClick={() => run(`build-${g.id}`, async () => { await api.buildGroup(g.id); await load(); }, 'הקבוצה נבנתה ב־Figma')}>
                  {busy === `build-${g.id}` ? 'בונה…' : 'בנייה ב־Figma'}
                </button>
                <button
                  className="primary"
                  disabled={!figmaConnected || !allApproved || !!busy || g.status === 'exported'}
                  title={allApproved ? '' : 'צריך לאשר את כל 4 המוקאפים'}
                  onClick={() =>
                    run(`export-${g.id}`, async () => {
                      const r = await api.exportGroup(g.id);
                      toast('ok', `יוצאו ${r.written.length} קבצים${r.skipped.length ? ` · דולגו ${r.skipped.length}` : ''}`);
                      if (r.written[0]) void window.studio.reveal(r.written[0]);
                      await load();
                    })
                  }
                >
                  ייצוא PNG של הקבוצה
                </button>
                {g.status !== 'exported' && (
                  <button className="danger" disabled={!!busy} onClick={() => confirm(`למחוק את ${g.code}? הפריימים ב־Output יימחקו, האתרים יחזרו לרשימה.`) && run('del', async () => { await api.deleteGroup(g.id); await load(); })}>
                    מחיקה
                  </button>
                )}
              </div>
            </div>
            <div className="mockups">
              {g.mockups.map((m) => (
                <MockupCard key={m.id} m={m} templates={templates} busy={!!busy} figmaConnected={figmaConnected} onEdit={() => setEditing(m)} run={run} reload={load} />
              ))}
            </div>
          </section>
        );
      })}
      {editing && (
        <EditDialog
          m={editing}
          onClose={() => setEditing(null)}
          onSave={(content) =>
            run('save', async () => {
              await api.updateMockupContent(editing.id, content);
              setEditing(null);
              await load();
            }, 'נשמר – יש לבנות מחדש')
          }
        />
      )}
    </div>
  );
}

function MockupCard({ m, templates, busy, figmaConnected, onEdit, run, reload }: {
  m: MockupView;
  templates: TemplateRecord[];
  busy: boolean;
  figmaConnected: boolean;
  onEdit: () => void;
  run: ReturnType<typeof useAction>['run'];
  reload: () => Promise<unknown>;
}) {
  const errors = m.validation.filter((v) => v.severity === 'error');
  const warnings = m.validation.filter((v) => v.severity === 'warning');
  const locked = m.status === 'exported';
  return (
    <div className={`mockup ${m.approved ? 'approved' : ''}`}>
      <div className="mockup-head">
        <b>#{m.slot}</b> {m.primaryFontName} · <span dir="ltr">{m.siteDomain}</span>
        <Badge tone={m.status === 'exported' || m.approved ? 'ok' : m.status === 'failed' || m.status === 'rejected' ? 'bad' : m.status === 'validated' ? 'accent' : 'neutral'}>{m.approved ? 'מאושר' : STATUS_HE[m.status]}</Badge>
      </div>
      <div className="preview">{m.previewDataUrl ? <img src={m.previewDataUrl} alt="" /> : <Empty>אין תצוגה מקדימה</Empty>}</div>
      <dl className="content">
        <dt>פרויקט</dt>
        <dd>{m.content.projectName}</dd>
        <dt>עיצוב</dt>
        <dd>{m.content.designer ?? <span className="muted">ללא קרדיט</span>}</dd>
        <dt>תבנית</dt>
        <dd>
          <select disabled={locked || busy} value={m.templateId} onChange={(e) => run('tpl', async () => { await api.setMockupTemplate(m.id, Number(e.target.value)); await reload(); })}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </dd>
      </dl>
      {errors.length > 0 && (
        <ul className="issues bad">
          {errors.map((i) => (
            <li key={i.code + i.message}>{i.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="issues warn">
          {warnings.map((i) => (
            <li key={i.code + i.message}>{i.message}</li>
          ))}
        </ul>
      )}
      {m.exportedPath && (
        <button className="link" onClick={() => void window.studio.reveal(m.exportedPath!)}>
          {m.exportedPath.split(/[\\/]/).pop()}
        </button>
      )}
      {!locked && (
        <div className="row">
          <button disabled={busy} onClick={onEdit}>עריכה</button>
          <button disabled={busy || !figmaConnected} onClick={() => run(`rb-${m.id}`, async () => { await api.rebuildMockup(m.id); await reload(); })}>
            בנייה מחדש
          </button>
          {m.approved ? (
            <button disabled={busy} onClick={() => run('rej', async () => { await api.rejectMockup(m.id); await reload(); })}>
              ביטול אישור
            </button>
          ) : (
            <button className="primary" disabled={busy || m.status !== 'validated'} title={m.status !== 'validated' ? 'יש לבנות ולתקן שגיאות לפני אישור' : ''} onClick={() => run('ok', async () => { await api.approveMockup(m.id, null); await reload(); })}>
              אישור
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditDialog({ m, onClose, onSave }: { m: MockupView; onClose: () => void; onSave: (c: MockupContent) => void }) {
  const [c, setC] = useState<MockupContent>(m.content);
  const [hex, setHex] = useState(rgbToHex(m.content.brandColor));
  const field = (label: string, key: 'projectName' | 'projectTitle' | 'siteType' | 'designer' | 'developer' | 'displayUrl', hint?: string) => (
    <>
      <label>{label}</label>
      <input value={(c[key] as string | null) ?? ''} placeholder={hint} onChange={(e) => setC({ ...c, [key]: e.target.value || (key === 'designer' || key === 'developer' || key === 'siteType' ? null : '') })} />
    </>
  );
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>עריכת מוקאפ #{m.slot}</h2>
        <p className="muted small">שינויים נשמרים כראיה "נערך ידנית", מבטלים אישור קודם ודורשים בנייה מחדש.</p>
        {field('סוג אתר', 'siteType', 'הסטודיו')}
        {field('שם פרויקט (בכותרת ובשם הקובץ)', 'projectName')}
        {field('שורת "פרויקט:" בקרדיטים', 'projectTitle')}
        {field('עיצוב אתר (ריק = ללא קרדיט)', 'designer')}
        {field('פיתוח (אופציונלי)', 'developer')}
        {field('כתובת מוצגת', 'displayUrl')}
        <label>פונטים (הראשון הוא הפונט הראשי של הקבוצה)</label>
        <input value={c.fonts.join(', ')} onChange={(e) => setC({ ...c, fonts: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <label>צבע הגרדיאנט</label>
        <div className="row">
          <input type="color" value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())} />
          <input dir="ltr" value={hex} onChange={(e) => setHex(e.target.value)} />
        </div>
        <div className="row end">
          <button onClick={onClose}>ביטול</button>
          <button
            className="primary"
            onClick={() => {
              let brandColor = c.brandColor;
              try {
                brandColor = hexToRgb(hex);
              } catch {
                /* keep */
              }
              if (c.fonts[0] !== m.content.fonts[0]) {
                alert('אי אפשר להחליף את הפונט הראשי כאן – הוא קובע את הרכב הקבוצה.');
                return;
              }
              onSave({ ...c, brandColor });
            }}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}
