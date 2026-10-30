import { useEffect, useState } from 'react';
import { api, ApiError, coachErrorText, type IncomeProfile, type SecurityState } from '../api';

// How the household earns, so insights and business tips talk about the right things.
export function IncomeProfileCard() {
  const [p, setP] = useState<IncomeProfile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<IncomeProfile>('/profile').then(setP);
  }, []);
  if (!p) return null;
  const save = async (next: IncomeProfile | null) => {
    setP(await api<IncomeProfile>('/profile', { method: 'PUT', json: { profile: next && { business: next.business, salary: next.salary } } }));
    setSaved(true);
  };
  return (
    <section className="card form">
      <h3>🏠 מאיפה נכנס הכסף לבית</h3>
      <p className="sub">לפי זה המערכת מנסחת את התובנות ואת הטיפים לעסק.{p.auto ? ' כרגע זה זוהה אוטומטית מהתנועות.' : ''}</p>
      <fieldset className="income-choice">
        <legend>ההכנסה מהעסק</legend>
        {(
          [
            ['clearing', 'מסליקת אשראי', 'הקונים משלמים בכרטיס, והכסף נכנס מחברות הסליקה. אין לקוחות קבועים או חשבוניות לכל לקוח.'],
            ['clients', 'מלקוחות', 'עבודה מול לקוחות, עם חשבוניות והעברות.'],
            ['none', 'אין עסק', ''],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="radio">
            <input type="radio" name="biz" checked={p.business === value} onChange={() => save({ ...p, business: value })} />
            <span>
              <b>{label}</b>
              {hint && <span className="muted small"> · {hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="radio">
        <input type="checkbox" checked={p.salary} onChange={(e) => save({ ...p, salary: e.target.checked })} />
        <span>
          <b>יש בבית גם משכורת קבועה</b>
          <span className="muted small"> · המערכת מזהה אותה בבנק (משכורת / שכר) ומציגה אותה כבסיס היציב של הבית.</span>
        </span>
      </label>
      <div className="row wrap">
        {!p.auto && (
          <button className="link small" onClick={() => save(null)}>
            חזרה לזיהוי אוטומטי
          </button>
        )}
        {saved && <span className="success small">נשמר. התובנות מתעדכנות.</span>}
      </div>
    </section>
  );
}

const LOCK_OPTIONS = [
  [5, '5 דקות'],
  [15, '15 דקות'],
  [30, '30 דקות'],
  [60, 'שעה'],
  [0, 'לא לנעול במחשב'],
] as const;

export function SecurityCard() {
  const [st, setSt] = useState<SecurityState | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = () => api<SecurityState>('/security').then(setSt);
  useEffect(() => {
    load();
  }, []);
  if (!st) return null;

  const setLock = async (minutes: number) => {
    try {
      await api('/security', { method: 'PUT', json: { autoLockMinutes: minutes } });
      setMsg('נשמר.');
      setError('');
      load();
    } catch (err) {
      setError(coachErrorText(err instanceof ApiError ? err.code : ''));
    }
  };
  const signOutAll = async () => {
    if (!confirm('לנתק את כל המכשירים, כולל את זה? אחר כך נכנסים שוב עם סיסמת-העל.')) return;
    await api('/security/sign-out-all', { method: 'POST' });
    location.reload();
  };
  const backupAge = st.lastBackupAt ? Math.floor((Date.now() - Date.parse(st.lastBackupAt)) / 86_400_000) : null;
  const failed = st.logins.filter((l) => !l.ok && Date.now() - Date.parse(l.at) < 7 * 86_400_000).length;

  const checks: { ok: boolean; text: string }[] = [
    { ok: true, text: 'פרטי הכניסה לבנקים, מפתחות ה-API, השיחות עם המאמן ומה שהוא למד מוצפנים בסיסמת-העל (AES-256).' },
    { ok: true, text: 'המערכת לא פתוחה לרשת הביתית. רק המחשב עצמו, ומהטלפון רק דרך Tailscale.' },
    { ok: true, text: 'מהטלפון אי אפשר ליצור גיבוי, לשחזר, לאפס, לשנות חיבורי בנקים או מפתחות. זה אפשרי רק מהמחשב.' },
    { ok: st.autoLockMinutes > 0, text: st.autoLockMinutes > 0 ? `נעילה אוטומטית אחרי ${st.autoLockMinutes} דקות בלי שימוש (בטלפון: ${st.phoneLockMinutes}).` : `במחשב אין נעילה אוטומטית. בטלפון: אחרי ${st.phoneLockMinutes} דקות.` },
    { ok: backupAge !== null && backupAge <= 45, text: backupAge === null ? 'עוד לא נוצר קובץ גיבוי. כדאי ליצור ולשמור על דיסק-און-קי, מחוץ למחשב.' : `הגיבוי האחרון לפני ${backupAge} ימים${backupAge > 45 ? '. כדאי ליצור חדש.' : '.'}` },
    { ok: failed === 0, text: failed ? `${failed} ניסיונות כניסה עם סיסמה שגויה בשבוע האחרון. אם זה לא אתה, כדאי לנתק את כל המכשירים ולהחליף סיסמה ב-Windows.` : 'אין ניסיונות כניסה שגויים בשבוע האחרון.' },
  ];

  return (
    <section className="card form">
      <h3>🛡️ אבטחה</h3>
      <ul className="sec-checks">
        {checks.map((c) => (
          <li key={c.text} className={c.ok ? 'ok' : 'todo'}>
            <span aria-hidden>{c.ok ? '✓' : '!'}</span> {c.text}
          </li>
        ))}
      </ul>

      <label>
        נעילה אוטומטית אחרי חוסר שימוש
        <select value={st.autoLockMinutes} onChange={(e) => setLock(Number(e.target.value))} disabled={st.onPhone}>
          {LOCK_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {msg && <span className="success small">{msg}</span>}
      {error && <div className="error small">{error}</div>}

      <h4>כדי שזה יהיה ממש מוגן, שלושה דברים ב-Windows ובחשבונות</h4>
      <ol className="howto">
        <li>
          <b>הצפנת הכונן (BitLocker):</b> הגדרות Windows ← פרטיות ואבטחה ← הצפנת מכשיר (או "ניהול BitLocker"). כך גם מי שלוקח את המחשב לא יכול לקרוא את הנתונים.
        </li>
        <li>
          <b>סיסמה או PIN לכניסה ל-Windows</b>, ונעילת מסך אוטומטית (Win+L כשקמים מהמחשב).
        </li>
        <li>
          <b>אימות דו-שלבי</b> לחשבון שאיתו נכנסים ל-Tailscale (Google או Microsoft), וגם לחשבון ב-Anthropic אם המאמן מחובר.
        </li>
      </ol>

      {st.logins.length > 0 && (
        <details>
          <summary>כניסות אחרונות</summary>
          <ul className="login-log">
            {st.logins.slice(0, 12).map((l) => (
              <li key={l.at} className={l.ok ? '' : 'bad'}>
                {new Date(l.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })} · {l.phone ? '📱 טלפון' : '💻 מחשב'} · {l.ok ? 'כניסה' : 'סיסמה שגויה'}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row wrap">
        <button className="ghost small" onClick={signOutAll}>
          ניתוק כל המכשירים
        </button>
      </div>
    </section>
  );
}
