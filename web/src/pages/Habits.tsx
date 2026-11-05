import { useEffect, useState } from 'react';
import { api, type CushionView, type MaaserView, type PushState, type WeeklyState } from '../api';
import { date, money } from '../format';
import type { Nav } from '../App';

// From Motzei Shabbat until Tuesday the home screen opens with last week's review.
export function weeklyTime(now = new Date()): boolean {
  const d = now.getDay();
  return (d === 6 && now.getHours() >= 21) || d === 0 || d === 1 || d === 2;
}

export function WeeklyCard({ nav }: { nav: Nav }) {
  const [w, setW] = useState<WeeklyState | null>(null);
  useEffect(() => {
    api<WeeklyState>('/weekly').then(setW).catch(() => {});
  }, []);
  if (!w) return null;
  const n = w.numbers;
  const r = w.review;
  return (
    <section className="card weekly">
      <div className="eyebrow">
        🌿 הסקירה השבועית · {date(n.from).slice(0, 5)}–{date(n.to).slice(0, 5)}
      </div>
      <h3>{r ? r.title : `השבוע נכנסו ${money(n.income)}`}</h3>
      <div className="weekly-nums">
        <span>
          נכנס <b className="pos">{money(n.income)}</b>
        </span>
        <span>
          יצא <b>{money(n.expenses)}</b>
          {n.vsUsual !== null && Math.abs(n.vsUsual) >= 0.1 && <span className="muted small"> ({n.vsUsual > 0 ? '+' : ''}{Math.round(n.vsUsual * 100)}% משבוע רגיל)</span>}
        </span>
      </div>
      {r ? (
        <>
          <p>{r.cameIn}</p>
          {r.wins.length > 0 && (
            <ul className="weekly-wins">
              {r.wins.map((x) => (
                <li key={x}>✓ {x}</li>
              ))}
            </ul>
          )}
          <div className="coach-step">
            <b>הצעד לשבוע הבא:</b> {r.nextStep}
          </div>
        </>
      ) : (
        <p className="muted small">
          {n.topCategories.length ? `הקטגוריות הגדולות: ${n.topCategories.map((c) => `${c.name} ${money(c.total)}`).join(', ')}.` : ''}{' '}
          <button className="link small" onClick={() => nav.go('coach')}>
            עם המאמן הסקירה כוללת גם מה הצליח וצעד לשבוע הבא
          </button>
        </p>
      )}
    </section>
  );
}

export function MaaserCard({ m, onChange }: { m: MaaserView; onChange: (m: MaaserView) => void }) {
  const [edit, setEdit] = useState(false);
  const [carry, setCarry] = useState(String(m.carry || ''));
  const save = async (next: Partial<MaaserView>) => onChange(await api<MaaserView>('/maaser', { method: 'PUT', json: { pct: m.pct, base: m.base, carry: m.carry, ...next } }));
  const done = m.owed + m.carry > 0 ? Math.min(1, m.given / (m.owed + m.carry)) : 1;
  return (
    <div className="habit">
      <div className="row between">
        <b>🤲 {m.pct === 20 ? 'חומש' : 'מעשר'} {m.year}</b>
        <button className="link small" onClick={() => setEdit(!edit)} aria-expanded={edit}>
          הגדרה
        </button>
      </div>
      <div className="meter-line">
        <div style={{ width: `${done * 100}%` }} />
      </div>
      <p>
        ניתנו <b>{money(m.given)}</b> מתוך {money(m.owed + m.carry)}.{' '}
        {m.balance > 0 ? (
          <>
            נשאר לתת <b>{money(m.balance)}</b>.
          </>
        ) : (
          <span className="pos">ניתן הכול{m.balance < 0 ? `, ועוד ${money(-m.balance)} מראש` : ''}. 🌱</span>
        )}
      </p>
      <p className="muted small">
        החודש: {money(m.thisMonth.owed)} לפי ההכנסה, ניתנו {money(m.thisMonth.given)}. החישוב לפי מה שנכנס בפועל{m.base === 'net' ? ', מהרווח (אחרי מע"מ והוצאות העסק)' : ', מכל ההכנסה'}.
      </p>
      {edit && (
        <div className="habit-edit">
          <label>
            שיעור
            <select value={m.pct} onChange={(e) => save({ pct: Number(e.target.value) })}>
              <option value={10}>מעשר (10%)</option>
              <option value={20}>חומש (20%)</option>
            </select>
          </label>
          <label>
            מאיזה סכום
            <select value={m.base} onChange={(e) => save({ base: e.target.value as MaaserView['base'] })}>
              <option value="net">מהרווח: משכורת + רווח העסק (בלי מע"מ והוצאות)</option>
              <option value="all">מכל מה שנכנס</option>
            </select>
          </label>
          <label>
            יתרה משנים קודמות (חוב בפלוס, מראש במינוס)
            <span className="row">
              <input inputMode="numeric" value={carry} onChange={(e) => setCarry(e.target.value)} />
              <button className="ghost small" onClick={() => save({ carry: Number(carry) || 0 })}>
                שמירה
              </button>
            </span>
          </label>
          <p className="muted small">נספר כל מה שבקטגוריה "מעשר וצדקה". בשאלות הלכתיות על מה מפרישים, כדאי לשאול רב.</p>
        </div>
      )}
    </div>
  );
}

export function CushionCard({ c, onChange }: { c: CushionView; onChange: (c: CushionView) => void }) {
  const [edit, setEdit] = useState(false);
  const [saved, setSaved] = useState(c.savedSource === 'manual' ? String(c.saved) : '');
  const save = async (body: { months?: number; saved?: number | null }) => onChange(await api<CushionView>('/cushion', { method: 'PUT', json: body }));
  return (
    <div className="habit">
      <div className="row between">
        <b>🛟 כרית לחודש חלש</b>
        <button className="link small" onClick={() => setEdit(!edit)} aria-expanded={edit}>
          הגדרה
        </button>
      </div>
      <div className="meter-line">
        <div style={{ width: `${c.pct * 100}%` }} />
      </div>
      <p>
        יש <b>{money(c.saved)}</b> מתוך {money(c.target)} ({Math.round(c.pct * 100)}%).
        {c.pct < 1 && c.monthlyStep > 0 && <> הפרשה של {money(c.monthlyStep)} בחודש משלימה אותה בתוך שנה.</>}
      </p>
      <p className="muted small">
        {c.weakGap > 0 && c.weakGap * c.months >= c.monthlyExpenses
          ? `בחודש סליקה חלש (${money(c.weakBusiness)}) חסרים לבית כ-${money(c.weakGap)}. הכרית מכסה ${c.months} חודשים כאלה.`
          : c.weakGap > 0
            ? `בחודש סליקה חלש (${money(c.weakBusiness)}) חסרים לבית כ-${money(c.weakGap)}. היעד הוא לפחות חודש הוצאות אחד (${money(c.monthlyExpenses)}), וזה מכסה גם כמה חודשים חלשים.`
          : `המשכורת הקבועה מכסה את הבית גם בחודש חלש, ולכן היעד הוא חודש הוצאות אחד (${money(c.monthlyExpenses)}).`}
        {c.savedSource === 'none' && ' עדיין לא הוגדר כמה יש בכרית.'}
        {c.savedSource === 'savings' && ' הסכום לפי הפיקדונות בעמוד החסכונות.'}
      </p>
      {edit && (
        <div className="habit-edit">
          <label>
            כמה חודשים חלשים הכרית מכסה
            <select value={c.months} onChange={(e) => save({ months: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            כמה יש בכרית היום
            <span className="row">
              <input inputMode="numeric" value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="לפי הפיקדונות" />
              <button className="ghost small" onClick={() => save({ saved: saved.trim() === '' ? null : Number(saved) || 0 })}>
                שמירה
              </button>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function NotificationsCard() {
  const [st, setSt] = useState<PushState | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [here, setHere] = useState(false);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  useEffect(() => {
    api<PushState>('/push').then(setSt).catch(() => {});
    if (supported)
      navigator.serviceWorker
        .getRegistration('/sw.js')
        .then((r) => r?.pushManager.getSubscription())
        .then((s) => setHere(!!s))
        .catch(() => {});
  }, [supported]);
  if (!st) return null;

  const enable = async () => {
    setError('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setError('הדפדפן לא קיבל אישור להתראות. אפשר לאשר בהגדרות האתר בדפדפן.');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(st.publicKey!) });
      setSt(await api<PushState>('/push/subscribe', { method: 'POST', json: sub.toJSON() }));
      setHere(true);
      setMsg('ההתראות הופעלו במכשיר הזה.');
    } catch {
      setError('לא הצלחתי להפעיל התראות. בטלפון זה עובד מהכתובת של Tailscale (https), ובאייפון רק אחרי "הוספה למסך הבית".');
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      setSt(await api<PushState>('/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }));
      await sub.unsubscribe();
    }
    setHere(false);
  };
  const setPref = async (k: keyof PushState['prefs'], v: boolean) => setSt(await api<PushState>('/push/prefs', { method: 'PUT', json: { ...st.prefs, [k]: v } }));

  return (
    <section className="card form">
      <h3>🔔 התראות לטלפון</h3>
      <p className="sub">רק מה ששווה הפרעה. בשבת לא נשלחות התראות (משישי אחר הצהריים עד מוצאי שבת), והן מחכות לאחריה.</p>
      {!supported ? (
        <p className="muted">הדפדפן הזה לא תומך בהתראות. בטלפון: לפתוח את המערכת מכתובת ה-Tailscale ב-Chrome.</p>
      ) : here ? (
        <div className="row wrap">
          <span className="success small">✓ המכשיר הזה מקבל התראות</span>
          <button className="ghost small" onClick={async () => setMsg((await api<{ sent: number }>('/push/test', { method: 'POST' })).sent ? 'נשלחה התראת בדיקה.' : 'לא נשלח.')}>
            התראת בדיקה
          </button>
          <button className="link small" onClick={disable}>
            הפסקה במכשיר הזה
          </button>
        </div>
      ) : (
        <button className="primary" onClick={enable}>
          הפעלת התראות במכשיר הזה
        </button>
      )}
      {st.devices > 0 && <p className="muted small">{st.devices === 1 ? 'מכשיר אחד מקבל התראות.' : `${st.devices} מכשירים מקבלים התראות.`}</p>}
      {msg && <div className="success small">{msg}</div>}
      {error && <div className="error small">{error}</div>}
      <fieldset className="income-choice">
        <legend>על מה להתריע</legend>
        {(
          [
            ['sync', 'בנק או כרטיס שלא מתעדכנים יותר מיום'],
            ['unusual', 'חיוב חריג: גבוה בהרבה מהרגיל אצל אותו בית עסק, או סכום גדול בבית עסק חדש'],
            ['weekly', 'הסקירה השבועית, במוצאי שבת'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="radio">
            <input type="checkbox" checked={st.prefs[k]} onChange={(e) => setPref(k, e.target.checked)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
