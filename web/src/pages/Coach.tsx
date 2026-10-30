import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, apiText, coachErrorText, type CoachFocus, type CoachState } from '../api';
import type { Nav } from '../App';

const STARTERS = [
  'איך אני באמת עומד החודש?',
  'אני מרגיש שאין לי כסף לכלום. תעזור לי לראות את זה אחרת',
  'מה הדבר האחד שהכי כדאי לי לשנות?',
  'איך להתכונן לחודש סליקה חלש?',
  'כמה אני נותן למעשר, וזה מתאים להכנסה?',
];

export function Coach() {
  const [st, setSt] = useState<CoachState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<CoachState>('/coach').then(setSt);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [st?.history.length, pending]);

  if (!st) return <div className="muted">טוען…</div>;
  if (!st.enabled) return <CoachSetup onDone={setSt} />;

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError('');
    setNote('');
    setPending(message);
    setText('');
    try {
      const r = await api<{ reply: string; remembered: string[]; history: CoachState['history'] }>('/coach/chat', { method: 'POST', json: { message } });
      const fresh = await api<CoachState>('/coach');
      setSt({ ...fresh, history: r.history });
      if (r.remembered.length) setNote(`המאמן רשם לעצמו: ${r.remembered.join(' · ')}`);
    } catch (err) {
      setError(coachErrorText(err instanceof ApiError ? err.code : ''));
      setText(message);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  return (
    <div className="stack coach">
      <h2 className="title">🌱 מאמן שפע</h2>
      <p className="sub">
        מכיר את המספרים שלך, לומד את ההתנהלות שלך משיחה לשיחה, ועוזר לראות את הכסף מתוך שפע ולא מתוך חסר. זה מאמן, לא יועץ מוסמך.
      </p>

      <section className="card coach-chat">
        {st.history.length === 0 && !pending && (
          <div className="coach-empty">
            <p>אפשר לשאול כל דבר על הכסף של הבית והעסק, או פשוט לספר איך זה מרגיש החודש.</p>
            <div className="row wrap">
              {STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="coach-messages" aria-live="polite">
          {st.history.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {pending && (
            <>
              <div className="bubble user">{pending}</div>
              <div className="bubble assistant muted">המאמן מסתכל על המספרים…</div>
            </>
          )}
          <div ref={end} />
        </div>
        {note && <div className="success small">{note}</div>}
        {error && <div className="error small">{error}</div>}
        <form className="coach-input" onSubmit={submit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="מה עובר לך בראש לגבי הכסף?"
            rows={2}
            maxLength={4000}
            aria-label="הודעה למאמן"
          />
          <button className="primary" disabled={busy || !text.trim()}>
            {busy ? 'רגע…' : 'שליחה'}
          </button>
        </form>
      </section>

      <CoachMemory st={st} onChange={setSt} />
      <CoachPrivacy onChange={setSt} />
    </div>
  );
}

function CoachSetup({ onDone }: { onDone: (s: CoachState) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api<CoachState>('/coach/key', { method: 'PUT', json: { apiKey: key.trim() } }));
    } catch (err) {
      setError(coachErrorText(err instanceof ApiError ? err.code : ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <h2 className="title">🌱 מאמן שפע</h2>
      <section className="card form">
        <h3>מה המאמן עושה</h3>
        <ul className="howto">
          <li>מכיר את המספרים האמיתיים שלך: מה נכנס מהסליקה ומהמשכורת, מה יצא, הקופות והתחזית.</li>
          <li>לומד אותך משיחה לשיחה (דפוסים, מה מלחיץ, מה עובד) ושומר את זה מוצפן במחשב.</li>
          <li>בוחר כל יום מיקוד אחד למסך הבית: דבר אחד לשים לב אליו וצעד קטן אחד.</li>
          <li>עוזר לזהות מחשבות של חסר ("אין לי", "אף פעם לא מספיק") ולראות את התמונה המלאה.</li>
        </ul>
        <h3>החיבור</h3>
        <ol className="howto">
          <li>
            נכנסים ל-<b dir="ltr">console.anthropic.com</b>, נרשמים, ומוסיפים אמצעי תשלום. התשלום לפי שימוש, ושיחה רגילה עולה בדרך כלל אגורות בודדות.
          </li>
          <li>
            ב-<b>API Keys</b> יוצרים מפתח חדש ומעתיקים אותו.
          </li>
          <li>מדביקים כאן. המפתח נשמר מוצפן בסיסמת-העל, רק במחשב הזה.</li>
        </ol>
        <div className="privacy-note">
          <b>מה יוצא מהמחשב:</b> סיכום של המספרים (סכומים לפי חודש וקטגוריה, חיובים קבועים ושמות בתי עסק) ושאלות שלך, והם נשלחים ל-Anthropic כדי שהמאמן יוכל לענות. פרטי הכניסה לבנקים, מספרי החשבונות וסיסמת-העל לא נשלחים לעולם.
        </div>
        <form className="row wrap" onSubmit={save}>
          <input type="password" dir="ltr" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" aria-label="מפתח API" />
          <button className="primary" disabled={busy || key.trim().length < 20}>
            {busy ? 'בודק…' : 'חיבור המאמן'}
          </button>
        </form>
        {error && <div className="error small">{error}</div>}
      </section>
    </div>
  );
}

function CoachMemory({ st, onChange }: { st: CoachState; onChange: (s: CoachState) => void }) {
  return (
    <section className="card form">
      <h3>מה המאמן למד עליך</h3>
      <p className="sub">המאמן רושם כאן דברים שחוזרים בשיחות, כדי להמשיך מאותה נקודה בפעם הבאה. אפשר למחוק כל דבר שלא נכון.</p>
      {st.memory.length === 0 && <div className="muted small">עוד לא נרשם כלום. זה יתמלא עם הזמן.</div>}
      <ul className="coach-memory">
        {st.memory.map((m) => (
          <li key={m.id}>
            <span>{m.note}</span>
            <button className="link small" onClick={async () => onChange(await api<CoachState>(`/coach/memory/${m.id}`, { method: 'DELETE' }))}>
              מחיקה
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoachPrivacy({ onChange }: { onChange: (s: CoachState) => void }) {
  const [context, setContext] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <section className="card form">
      <h3>פרטיות</h3>
      <p className="sub">השיחה והרשימות נשמרות במחשב מוצפנות בסיסמת-העל. מה שנשלח למאמן הוא סיכום המספרים, וכאן אפשר לראות אותו בדיוק.</p>
      <div className="row wrap">
        <button className="ghost small" onClick={async () => setContext(context === null ? await apiText('/coach/context') : null)}>
          {context === null ? 'מה נשלח למאמן?' : 'הסתרה'}
        </button>
        <button
          className="ghost small"
          onClick={async () => {
            if (confirm('למחוק את כל השיחות עם המאמן? מה שהוא למד עליך נשאר.')) onChange(await api<CoachState>('/coach/history', { method: 'DELETE' }));
          }}
        >
          מחיקת השיחות
        </button>
        <button
          className="ghost small"
          onClick={async () => {
            if (!confirm('לנתק את המאמן? המפתח יימחק מהמחשב.')) return;
            try {
              onChange(await api<CoachState>('/coach/key', { method: 'DELETE' }));
            } catch (err) {
              setError(coachErrorText(err instanceof ApiError ? err.code : ''));
            }
          }}
        >
          ניתוק המאמן
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
      {context !== null && <pre className="coach-context">{context}</pre>}
    </section>
  );
}

// Today's focus on the home screen, chosen by the coach once a day.
export function CoachFocusCard({ nav }: { nav: Nav }) {
  const [focus, setFocus] = useState<CoachFocus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ focus: CoachFocus | null }>('/coach/focus')
      .then((r) => setFocus(r.focus))
      .catch(() => {});
  }, []);
  if (!focus) return null;
  const again = async () => {
    setBusy(true);
    try {
      const r = await api<{ focus: CoachFocus | null }>('/coach/focus?refresh=1');
      if (r.focus) setFocus(r.focus);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card coach-focus">
      <div className="eyebrow">🌱 המיקוד של היום</div>
      <h3>{focus.title}</h3>
      <p>{focus.body}</p>
      <div className="coach-step">
        <b>צעד קטן להיום:</b> {focus.action}
      </div>
      <div className="row wrap">
        <button className="ghost small" onClick={() => nav.go('coach')}>
          לדבר עם המאמן
        </button>
        <button className="link small" disabled={busy} onClick={again}>
          {busy ? 'בוחר…' : 'מיקוד אחר'}
        </button>
      </div>
    </section>
  );
}
