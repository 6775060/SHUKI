import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Account } from '../api';
import { date, moneyExact } from '../format';

interface Preview {
  headers: string[];
  count: number;
  skipped: number;
  preview: { date: string; amount: number; description: string }[];
}

const ERRORS: Record<string, string> = {
  HEADER_NOT_FOUND: 'לא מצאתי בקובץ עמודות של תאריך, תיאור וסכום.',
  UNSUPPORTED_FORMAT: 'הקובץ צריך להיות xlsx, csv או קובץ xls שהבנק הוריד. קובץ xls ישן: לפתוח באקסל ולשמור כ-xlsx.',
};

export function Import() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [newAcc, setNewAcc] = useState({ label: '', kind: 'bank' as 'bank' | 'card' | 'cash', scope: 'private' as 'private' | 'business' });

  const loadAccounts = () => api<Account[]>('/accounts').then(setAccounts);
  useEffect(() => {
    loadAccounts();
  }, []);

  const send = async (dryRun: boolean) => {
    if (!file || !accountId) return;
    setError('');
    const q = new URLSearchParams({ accountId, filename: file.name, dryRun: dryRun ? '1' : '0' });
    try {
      const r = await api<Preview & { added: number }>(`/import?${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      if (dryRun) setPreview(r);
      else {
        setResult(`נוספו ${r.added} תנועות חדשות. ${r.skipped ? `${r.skipped} שורות דולגו (סיכומים או שורות ריקות).` : ''}`);
        setPreview(null);
        setFile(null);
      }
    } catch (err) {
      setError(ERRORS[(err as ApiError).code] ?? 'הייבוא נכשל.');
    }
  };

  const createAccount = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<{ id: number }>('/accounts', {
      method: 'POST',
      json: { kind: newAcc.kind, label: newAcc.label, companyId: null, accountNumber: `manual-${Date.now()}`, defaultScope: newAcc.scope },
    });
    await loadAccounts();
    setAccountId(String(r.id));
    setNewAcc({ ...newAcc, label: '' });
  };

  return (
    <div className="stack">
      <h2 className="title">ייבוא קובץ מהבנק או מהכרטיס</h2>
      <p className="muted">
        גיבוי לחיבור האוטומטי: אם אתר שינה משהו והסנכרון לא עובד, מורידים מהאתר קובץ Excel ומעלים כאן. תנועות שכבר קיימות לא ייכנסו פעמיים.
      </p>

      <section className="card form">
        <label>
          לאיזה חשבון?
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">בחירה…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.kind === 'card' ? 'כרטיס' : a.kind === 'bank' ? 'בנק' : 'מזומן'})
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary className="muted">החשבון לא ברשימה? יצירת חשבון חדש</summary>
          <form className="row wrap" onSubmit={createAccount}>
            <input placeholder="שם (למשל: ישראכרט 1234)" value={newAcc.label} onChange={(e) => setNewAcc({ ...newAcc, label: e.target.value })} />
            <select value={newAcc.kind} onChange={(e) => setNewAcc({ ...newAcc, kind: e.target.value as 'bank' | 'card' | 'cash' })}>
              <option value="bank">בנק</option>
              <option value="card">כרטיס אשראי</option>
              <option value="cash">מזומן</option>
            </select>
            <select value={newAcc.scope} onChange={(e) => setNewAcc({ ...newAcc, scope: e.target.value as 'private' | 'business' })}>
              <option value="private">פרטי</option>
              <option value="business">עסקי</option>
            </select>
            <button className="ghost small" disabled={!newAcc.label.trim()}>
              יצירה
            </button>
          </form>
        </details>
        <label>
          קובץ
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.txt,.html"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult('');
            }}
          />
        </label>
        {error && <div className="error">{error}</div>}
        {result && <div className="success">{result}</div>}
        <div className="row">
          <button className="primary" disabled={!file || !accountId} onClick={() => send(true)}>
            תצוגה מקדימה
          </button>
        </div>
      </section>

      {preview && (
        <section className="card">
          <h3>נמצאו {preview.count} תנועות</h3>
          <p className="muted small">עמודות שזוהו: {preview.headers.filter(Boolean).join(' · ')}</p>
          <table className="txns">
            <tbody>
              {preview.preview.map((t, i) => (
                <tr key={i}>
                  <td className="muted nowrap">{date(t.date)}</td>
                  <td className="desc">{t.description}</td>
                  <td className={`amount nowrap ${t.amount > 0 ? 'pos' : ''}`}>{moneyExact(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">בדקו שהסימנים נכונים: הוצאות במינוס, הכנסות בפלוס.</p>
          <button className="primary" onClick={() => send(false)}>
            לייבא {preview.count} תנועות
          </button>
        </section>
      )}
    </div>
  );
}
