import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { applyFont, type FontSetting } from '../font';

export function Settings() {
  const [font, setFont] = useState<FontSetting | null>(null);
  const [family, setFamily] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ font: FontSetting }>('/settings').then((s) => {
      setFont(s.font);
      setFamily(s.font.family ?? '');
    });
  }, []);

  const done = (f: FontSetting, text: string) => {
    setFont(f);
    applyFont(f);
    setMsg(text);
    setError('');
  };

  const upload = async (file: File) => {
    try {
      const f = await api<FontSetting>(`/settings/font?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      done(f, `הפונט "${f.name}" הוטמע במערכת.`);
    } catch (err) {
      setError((err as ApiError).code === 'NOT_A_FONT' ? 'זה לא נראה כמו קובץ פונט. צריך קובץ TTF, OTF, WOFF או WOFF2.' : 'ההעלאה נכשלה.');
    }
  };

  const useInstalled = async () => {
    try {
      done(await api<FontSetting>('/settings/font', { method: 'PUT', json: { family: family.trim() } }), `המערכת משתמשת עכשיו בפונט "${family.trim()}".`);
    } catch {
      setError('שם הפונט יכול להכיל אותיות, מספרים, רווח ומקף.');
    }
  };

  const reset = async () => done(await api<FontSetting>('/settings/font', { method: 'DELETE' }), 'חזרנו לפונט ברירת המחדל.');

  return (
    <div className="stack">
      <h2 className="title">הגדרות</h2>

      <PhoneAccess />

      <section className="card form">
        <h3>הפונט שלי</h3>
        <p className="sub">הממשק כולו יוצג בפונט שתבחר. הקובץ נשמר רק במחשב הזה.</p>
        <div className="font-preview" aria-label="תצוגה מקדימה">
          <div className="font-preview-big">שפע ובהירות ₪12,480</div>
          <div>איזהו עשיר? השמח בחלקו · 0123456789</div>
          <div className="font-weights">
            <span style={{ fontWeight: 300 }}>דק 300</span>
            <span style={{ fontWeight: 400 }}>רגיל 400</span>
            <span style={{ fontWeight: 600 }}>בינוני 600</span>
            <span style={{ fontWeight: 800 }}>שמן 800</span>
          </div>
        </div>
        <div className="sub">
          כרגע: {font?.file ? `קובץ שהועלה – ${font.name}${font.variable ? ' (Variable – כל המשקלים מקובץ אחד)' : ''}` : font?.family ? `פונט מותקן – ${font.family}` : 'ברירת המחדל של המערכת'}
        </div>

        <label>
          העלאת קובץ פונט (TTF / OTF / WOFF / WOFF2). בפונט Variable – להעלות את קובץ ה-Variable, והוא ישמש לכל המשקלים.
          <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>

        <div className="or">או</div>

        <label>
          שם של פונט שכבר מותקן במחשב
          <div className="row">
            <input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="למשל: Assistant" style={{ flex: 1 }} />
            <button className="ghost small" onClick={useInstalled} disabled={!family.trim()}>
              שימוש
            </button>
          </div>
        </label>

        {(font?.file || font?.family) && (
          <button className="ghost small" onClick={reset}>
            חזרה לפונט ברירת המחדל
          </button>
        )}
        {msg && <div className="success">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </section>
    </div>
  );
}

interface RemoteStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  url: string | null;
  error?: string;
}

// Opening the system from the phone, through the user's own Tailscale network.
function PhoneAccess() {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () => api<RemoteStatus>('/remote').then(setSt);
  useEffect(() => {
    load();
  }, []);
  const call = async (path: string) => {
    setBusy(true);
    setSt(await api<RemoteStatus>(path, { method: 'POST' }));
    setBusy(false);
  };
  const fromPhone = location.hostname.endsWith('.ts.net');

  return (
    <section className="card form">
      <h3>📱 גישה מהטלפון</h3>
      <p className="sub">
        דרך Tailscale – רשת פרטית ומוצפנת בין המחשב לטלפון שלך. הנתונים נשארים במחשב בבית, אף אחד אחר לא יכול להגיע למערכת, והכניסה תמיד עם סיסמת-העל.
      </p>
      {!st && <div className="muted">בודק…</div>}

      {st && !st.installed && !st.enabled && (
        <ol className="howto">
          <li>
            במחשב: להתקין את Tailscale מהאתר <b>tailscale.com/download</b> ולהתחבר (אפשר עם חשבון Google).
          </li>
          <li>בטלפון: להתקין את האפליקציה Tailscale מחנות האפליקציות ולהתחבר לאותו חשבון.</li>
          <li>
            לחזור לכאן וללחוץ{' '}
            <button className="link" onClick={load}>
              בדיקה שוב
            </button>
            .
          </li>
        </ol>
      )}

      {st && st.installed && !st.running && !st.enabled && (
        <p>
          Tailscale מותקן במחשב אבל לא מחובר. לפתוח אותו (הסמל ליד השעון) ולהתחבר, ואז{' '}
          <button className="link" onClick={load}>
            לבדוק שוב
          </button>
          .
        </p>
      )}

      {st && st.running && !st.enabled && (
        <div className="row wrap">
          <button className="primary" disabled={busy} onClick={() => call('/remote/enable')}>
            {busy ? 'רגע…' : 'הפעלת גישה מהטלפון'}
          </button>
        </div>
      )}

      {st?.error && st.error !== 'NOT_RUNNING' && st.error !== 'NOT_INSTALLED' && (
        <div className="error small">
          Tailscale ענה:{' '}
          {st.error.split(/(https:\/\/\S+)/).map((part, i) =>
            part.startsWith('https://') ? (
              <a key={i} href={part} target="_blank" rel="noreferrer">
                {part}
              </a>
            ) : (
              part
            ),
          )}
          <div className="muted">בפעם הראשונה Tailscale מבקש לאשר HTTPS ברשת שלך – פותחים את הקישור, מאשרים, ולוחצים שוב "הפעלה".</div>
        </div>
      )}

      {st?.enabled && st.url && (
        <>
          <div className="phone-url">
            <span className="muted small">הכתובת לטלפון:</span>
            <b dir="ltr">{st.url}</b>
            <button
              className="ghost small"
              onClick={async () => {
                await navigator.clipboard?.writeText(st.url!).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? 'הועתק ✓' : 'העתקה'}
            </button>
          </div>
          <ol className="howto">
            <li>בטלפון: לוודא ש-Tailscale מחובר (מתג דולק באפליקציה).</li>
            <li>לפתוח את הכתובת ב-Chrome. הכי פשוט: לשלוח אותה לעצמך בוואטסאפ ולהקיש עליה.</li>
            <li>להזין את סיסמת-העל.</li>
            <li>בתפריט ⋮ של Chrome: "הוספה למסך הבית" – ומעכשיו זה נפתח כמו אפליקציה.</li>
          </ol>
          <p className="sub">המחשב בבית צריך להיות דלוק – כמו לסנכרון היומי.</p>
          {fromPhone ? (
            <div className="muted small">אתה מחובר עכשיו דרך הטלפון.</div>
          ) : (
            <button className="link small" disabled={busy} onClick={() => call('/remote/disable')}>
              כיבוי הגישה מהטלפון
            </button>
          )}
        </>
      )}
    </section>
  );
}
