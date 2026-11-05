import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Connection, type Institution, type SyncStatus } from '../api';
import { PROGRESS_LABELS, relativeTime, scopeLabel } from '../format';

export function Connections() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ running: null, queued: [], progress: {} });
  const [adding, setAdding] = useState<Institution | null>(null);
  const [editing, setEditing] = useState<Connection | null>(null);

  const load = () =>
    api<{ connections: Connection[]; sync: SyncStatus }>('/connections').then((r) => {
      setConnections(r.connections);
      setSync(r.sync);
    });

  useEffect(() => {
    api<Institution[]>('/institutions').then(setInstitutions);
    load();
  }, []);

  const busy = sync.running !== null || sync.queued.length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy]);

  const inst = (id: string) => institutions.find((i) => i.id === id);
  const connected = new Set(connections.map((c) => c.companyId));
  const mine = institutions.slice(0, 5);
  const others = institutions.slice(5);

  const syncNow = async (id?: number) => {
    await api(id ? `/connections/${id}/sync` : '/sync', { method: 'POST' });
    load();
  };

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="title">חיבורים לבנקים ולכרטיסים</h2>
        {connections.length > 0 && (
          <button className="primary small" onClick={() => syncNow()} disabled={busy}>
            {busy ? 'מסנכרן…' : 'לסנכרן הכול עכשיו'}
          </button>
        )}
      </div>

      <p className="muted">
        המערכת נכנסת לאתרים בשבילך, כל בוקר ב-6:30, <b>לקריאה בלבד</b>. פרטי הכניסה מוצפנים בסיסמת-העל ונשמרים רק במחשב הזה.
      </p>

      {connections.map((c) => {
        const running = sync.running === c.id;
        const queued = sync.queued.includes(c.id);
        return (
          <div key={c.id} className={`card conn ${c.enabled ? '' : 'dim'}`}>
            <div className="conn-main">
              <div>
                <div className="conn-title">
                  {c.label} <span className="pill">{scopeLabel(c.defaultScope)}</span>
                </div>
                <div className="sub">
                  {inst(c.companyId)?.name} · {running ? PROGRESS_LABELS[sync.progress[c.id]] ?? 'מתחבר…' : queued ? 'ממתין בתור…' : relativeTime(c.lastSyncAt)}
                  {!running && c.lastStatus === 'ok' && c.lastAdded !== null ? ` · ${c.lastAdded} תנועות חדשות` : ''}
                </div>
                {!running && c.lastError && <div className="error small">{c.lastError}</div>}
              </div>
              <div className="row">
                <button className="ghost small" onClick={() => syncNow(c.id)} disabled={running || queued}>
                  סנכרון
                </button>
                <button className="ghost small" onClick={() => setEditing(c)}>
                  עריכה
                </button>
              </div>
            </div>
            {editing?.id === c.id && inst(c.companyId) && (
              <EditConnection
                conn={c}
                institution={inst(c.companyId)!}
                onDone={() => {
                  setEditing(null);
                  load();
                }}
              />
            )}
          </div>
        );
      })}

      {adding ? (
        <AddConnection
          institution={adding}
          onCancel={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            load();
          }}
        />
      ) : (
        <section className="card">
          <h3>הוספת חיבור</h3>
          <div className="inst-grid">
            {mine.map((i) => (
              <button key={i.id} className={`inst ${connected.has(i.id) ? 'done' : ''}`} onClick={() => setAdding(i)}>
                <span>{i.name}</span>
                <span className="sub">{connected.has(i.id) ? '✓ מחובר' : i.kind === 'bank' ? 'בנק' : 'כרטיס אשראי'}</span>
              </button>
            ))}
          </div>
          <details>
            <summary className="muted">גופים נוספים</summary>
            <div className="inst-grid">
              {others.map((i) => (
                <button key={i.id} className="inst" onClick={() => setAdding(i)}>
                  <span>{i.name}</span>
                  <span className="sub">{i.kind === 'bank' ? 'בנק' : 'כרטיס אשראי'}</span>
                </button>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

function CredentialFields({ institution, values, onChange }: { institution: Institution; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <>
      {institution.loginFields.map((f) => (
        <label key={f.key}>
          {f.label}
          <input
            type={f.secret ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            autoComplete="off"
            dir="ltr"
          />
        </label>
      ))}
    </>
  );
}

function AddConnection({ institution, onCancel, onDone }: { institution: Institution; onCancel: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(institution.id === 'pagi' ? 'פאגי – העסק' : institution.name);
  const [scope, setScope] = useState<'private' | 'business'>(institution.id === 'pagi' ? 'business' : 'private');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/connections', { method: 'POST', json: { companyId: institution.id, label, defaultScope: scope, credentials: creds } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'MISSING_FIELDS' ? 'צריך למלא את כל השדות.' : 'השמירה נכשלה.');
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h3>חיבור {institution.name}</h3>
      <label>
        שם לתצוגה
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <fieldset className="seg">
        <legend>החשבון משמש בעיקר ל:</legend>
        <label className="check">
          <input type="radio" checked={scope === 'private'} onChange={() => setScope('private')} /> הבית
        </label>
        <label className="check">
          <input type="radio" checked={scope === 'business'} onChange={() => setScope('business')} /> העסק
        </label>
      </fieldset>
      <CredentialFields institution={institution} values={creds} onChange={setCreds} />
      <p className="muted small">אותם פרטים שמכניסים באתר {institution.name}. הסנכרון הראשון מושך חצי שנה אחורה, ועשוי לקחת כמה דקות.</p>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="primary">שמירה וסנכרון</button>
        <button type="button" className="ghost" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function EditConnection({ conn, institution, onDone }: { conn: Connection; institution: Institution; onDone: () => void }) {
  const [label, setLabel] = useState(conn.label);
  const [scope, setScope] = useState(conn.defaultScope);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [changeCreds, setChangeCreds] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await api(`/connections/${conn.id}`, { method: 'PATCH', json: { label, defaultScope: scope, ...(changeCreds ? { credentials: creds } : {}) } });
    onDone();
  };
  const toggle = async () => {
    await api(`/connections/${conn.id}`, { method: 'PATCH', json: { enabled: !conn.enabled } });
    onDone();
  };
  const remove = async () => {
    if (!confirm('למחוק את החיבור? התנועות שכבר נמשכו יישארו.')) return;
    await api(`/connections/${conn.id}`, { method: 'DELETE' });
    onDone();
  };

  return (
    <form className="form edit" onSubmit={save}>
      <label>
        שם לתצוגה
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <fieldset className="seg">
        <legend>ברירת מחדל:</legend>
        <label className="check">
          <input type="radio" checked={scope === 'private'} onChange={() => setScope('private')} /> הבית
        </label>
        <label className="check">
          <input type="radio" checked={scope === 'business'} onChange={() => setScope('business')} /> העסק
        </label>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={changeCreds} onChange={(e) => setChangeCreds(e.target.checked)} /> לעדכן פרטי כניסה
      </label>
      {changeCreds && <CredentialFields institution={institution} values={creds} onChange={setCreds} />}
      <div className="row">
        <button className="primary small">שמירה</button>
        <button type="button" className="ghost small" onClick={toggle}>
          {conn.enabled ? 'השהיה' : 'הפעלה'}
        </button>
        <button type="button" className="ghost small danger" onClick={remove}>
          מחיקה
        </button>
      </div>
    </form>
  );
}
