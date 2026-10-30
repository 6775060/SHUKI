import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, openReceiptFile, type ReceiptItem, type ReceiptsState } from '../api';
import { date, money } from '../format';
import type { Nav } from '../App';

const SOURCE_LABEL: Record<ReceiptItem['source'], string> = { gmail: '✉️ Gmail', drive: '📁 Drive', upload: '📷 הועלה' };

export function Receipts({ nav }: { nav: Nav }) {
  const [st, setSt] = useState<ReceiptsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unmatched'>('all');

  useEffect(() => {
    api<ReceiptsState>('/receipts').then(setSt);
  }, []);
  if (!st) return <div className="muted">טוען…</div>;

  const scan = async () => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const r = await api<ReceiptsState & { added: number; read: number }>('/receipts/scan', { method: 'POST' });
      setSt(r);
      setMsg(r.added || r.read ? `נוספו ${r.added} קבצים, ${r.read} חשבוניות נקראו.` : 'אין חשבוניות חדשות.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      let added = 0;
      for (const f of Array.from(files)) {
        const r = await api<ReceiptsState & { added: number }>(`/receipts/upload?filename=${encodeURIComponent(f.name)}`, {
          method: 'POST',
          headers: { 'content-type': f.type || 'application/pdf' },
          body: await f.arrayBuffer(),
        });
        added += r.added;
        setSt(r);
      }
      setMsg(added ? `הועלו ${added} קבצים.` : 'הקובץ כבר קיים במערכת.');
    } catch {
      setError('ההעלאה נכשלה. אפשר להעלות PDF או תמונה (JPG, PNG) עד 15MB.');
    } finally {
      setBusy(false);
    }
  };

  const items = st.items.filter((i) => i.status !== 'not_invoice' && (filter === 'all' || (i.status === 'read' && !i.txnId)));
  const matched = st.items.filter((i) => i.txnId).length;
  const unmatched = st.items.filter((i) => i.status === 'read' && !i.txnId).length;

  return (
    <div className="stack">
      <h2 className="title">🧾 חשבוניות וקבלות</h2>
      <p className="sub">
        המערכת אוספת חשבוניות מהמייל ומתיקייה ב-Drive, קוראת מהן ספק, תאריך וסכום, ומחברת כל חשבונית לתנועה שלה בבנק או באשראי. כך רואים מה שולם עם חשבונית, ובעסק מה עוד חסר לקיזוז מע"מ.
      </p>

      {!st.canRead && (
        <div className="trust warning">
          כדי לקרוא את החשבוניות המערכת משתמשת במאמן.{' '}
          <button className="link" onClick={() => nav.go('coach')}>
            לחיבור המאמן
          </button>{' '}
          (עד אז הקבצים נאספים ונשמרים, ונקראים אחר כך.)
        </div>
      )}

      <div className="grid2">
        <GmailCard st={st} onChange={setSt} />
        <FolderCard st={st} onChange={setSt} />
      </div>

      <section className="card">
        <div className="row between wrap">
          <h3>
            {matched} חשבוניות מחוברות לתנועה{unmatched ? `, ${unmatched} בלי תנועה תואמת` : ''}
          </h3>
          <div className="row wrap">
            <label className="ghost small file-btn">
              📷 העלאת קבלה
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={(e) => upload(e.target.files)} />
            </label>
            <button className="primary small" disabled={busy} onClick={scan}>
              {busy ? 'סורק…' : 'סריקה עכשיו'}
            </button>
          </div>
        </div>
        {st.businessWithoutInvoice > 0 && (
          <p className="muted small">
            ב-60 הימים האחרונים יש {st.businessWithoutInvoice} הוצאות עסקיות בלי חשבונית.{' '}
            <button className="link small" onClick={() => nav.go('business')}>
              לרשימה בעמוד העסק
            </button>
          </p>
        )}
        {msg && <div className="success small">{msg}</div>}
        {error && <div className="error small">{error}</div>}
        <div className="seg-toggle" role="group" aria-label="סינון">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            הכול
          </button>
          <button className={filter === 'unmatched' ? 'on' : ''} onClick={() => setFilter('unmatched')}>
            בלי תנועה תואמת
          </button>
        </div>
        {items.length === 0 && <div className="muted">עוד אין כאן חשבוניות. אחרי חיבור המייל או התיקייה, "סריקה עכשיו" מביאה אותן.</div>}
        <ul className="receipt-list">
          {items.map((r) => (
            <li key={r.id}>
              <div>
                <b>{r.vendor ?? r.fileName}</b>
                <div className="muted small">
                  {SOURCE_LABEL[r.source]} · {r.docDate ? date(r.docDate) : 'תאריך לא ידוע'}
                  {r.number ? ` · מס' ${r.number}` : ''}
                </div>
                <div className="small">
                  {r.status === 'new' && <span className="muted">ממתין לקריאה</span>}
                  {r.status === 'failed' && <span className="warm">לא הצלחתי לקרוא את הקובץ</span>}
                  {r.status === 'read' && r.txn && (
                    <span className="pos">
                      ✓ {r.txn.description}, {date(r.txn.date)}
                    </span>
                  )}
                  {r.status === 'read' && !r.txn && <span className="warm">לא נמצאה תנועה בסכום הזה</span>}
                </div>
              </div>
              <div className="receipt-side">
                {r.amount !== null && <b>{money(r.amount)}</b>}
                <button className="link small" onClick={() => openReceiptFile(r.id).catch(() => setError('לא הצלחתי לפתוח את הקובץ.'))}>
                  פתיחה
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GmailCard({ st, onChange }: { st: ReceiptsState; onChange: (s: ReceiptsState) => void }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onChange(await api<ReceiptsState>('/receipts/gmail', { method: 'PUT', json: { email: email.trim(), appPassword: pass } }));
      setPass('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'COMPUTER_ONLY'
          ? 'את החיבור עושים מהמחשב.'
          : 'Gmail לא קיבל את הפרטים. צריך את כתובת המייל המלאה ו"סיסמת אפליקציה" (16 אותיות), לא הסיסמה הרגילה.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card form">
      <h3>✉️ Gmail</h3>
      {st.gmail ? (
        <>
          <p>
            מחובר: <b dir="ltr">{st.gmail.email}</b>
          </p>
          <p className="muted small">
            {st.gmailLastSync ? `נסרק לאחרונה ${new Date(st.gmailLastSync).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}. ` : ''}
            המערכת מחפשת מיילים עם קובץ מצורף ועם המילים חשבונית, קבלה או invoice, וקוראת רק את הקבצים האלה. היא לא שולחת ולא מוחקת כלום.
          </p>
          {st.gmailError && <div className="error small">{st.gmailError}</div>}
          <button className="link small" onClick={async () => onChange(await api<ReceiptsState>('/receipts/gmail', { method: 'DELETE' }))}>
            ניתוק
          </button>
        </>
      ) : (
        <>
          <ol className="howto">
            <li>
              בחשבון Google צריך אימות דו-שלבי פעיל (<b dir="ltr">myaccount.google.com/security</b>).
            </li>
            <li>
              נכנסים ל-<b dir="ltr">myaccount.google.com/apppasswords</b>, נותנים שם (למשל "שפע ובהירות") ומעתיקים את הסיסמה בת 16 האותיות.
            </li>
            <li>מדביקים כאן. היא נשמרת מוצפנת בסיסמת-העל, ואפשר לבטל אותה ב-Google בכל רגע.</li>
          </ol>
          <form className="stack-s" onSubmit={save}>
            <input type="email" dir="ltr" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="כתובת Gmail" />
            <input type="password" dir="ltr" placeholder="abcd efgh ijkl mnop" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="סיסמת אפליקציה" autoComplete="off" />
            <button className="primary" disabled={busy || !email.includes('@') || pass.replace(/\s/g, '').length < 12}>
              {busy ? 'בודק…' : 'חיבור Gmail'}
            </button>
          </form>
          {error && <div className="error small">{error}</div>}
        </>
      )}
    </section>
  );
}

function FolderCard({ st, onChange }: { st: ReceiptsState; onChange: (s: ReceiptsState) => void }) {
  const [folder, setFolder] = useState(st.folder ?? '');
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      onChange(await api<ReceiptsState>('/receipts/folder', { method: 'PUT', json: { folder: folder.trim() || null } }));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'COMPUTER_ONLY' ? 'את החיבור עושים מהמחשב.' : 'התיקייה לא נמצאה במחשב. כדאי להעתיק את הנתיב משורת הכתובת של סייר הקבצים.');
    }
  };
  return (
    <section className="card form">
      <h3>📁 תיקייה ב-Google Drive</h3>
      <ol className="howto">
        <li>
          מתקינים במחשב את <b>Google Drive למחשב</b> (<b dir="ltr">google.com/drive/download</b>). הוא מוסיף כונן, בדרך כלל <b dir="ltr">G:</b>.
        </li>
        <li>יוצרים ב-Drive תיקייה לחשבוניות, ושומרים אליה חשבוניות גם מהטלפון.</li>
        <li>
          מעתיקים כאן את הנתיב שלה, למשל <b dir="ltr">G:\My Drive\חשבוניות</b>.
        </li>
      </ol>
      <form className="row wrap" onSubmit={save}>
        <input dir="ltr" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="G:\My Drive\חשבוניות" aria-label="נתיב התיקייה" />
        <button className="ghost small">שמירה</button>
      </form>
      {st.folder && (
        <p className="muted small">
          נסרקת: <span dir="ltr">{st.folder}</span>
          {st.folderLastScan ? `, לאחרונה ${new Date(st.folderLastScan).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}. גם תיקיות משנה, PDF ותמונות.
        </p>
      )}
      {(error || st.folderError) && <div className="error small">{error || st.folderError}</div>}
    </section>
  );
}
