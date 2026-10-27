import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type SavingsAccount, type SavingsProduct, type SavingsView } from '../api';
import { date, money } from '../format';
import { Donut, type Slice } from '../charts';

// Pension, provident and study funds, investments: everything saved for the
// long run, with the fees that quietly eat it made visible.

const PRODUCTS: { key: SavingsProduct; label: string }[] = [
  { key: 'pension', label: 'קרן פנסיה' },
  { key: 'managers', label: 'ביטוח מנהלים' },
  { key: 'gemel', label: 'קופת גמל' },
  { key: 'hishtalmut', label: 'קרן השתלמות' },
  { key: 'gemel_invest', label: 'גמל להשקעה' },
  { key: 'investment', label: 'תיק השקעות' },
  { key: 'savings', label: 'חיסכון / פיקדון' },
  { key: 'other', label: 'אחר' },
];
const LABEL = Object.fromEntries(PRODUCTS.map((p) => [p.key, p.label])) as Record<SavingsProduct, string>;
const SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'];

type Draft = Omit<SavingsAccount, 'id' | 'source' | 'updatedAt'> & { id?: number };
const EMPTY: Draft = {
  provider: '',
  product: 'pension',
  accountNumber: '',
  track: null,
  status: 'active',
  balance: 0,
  balanceDate: new Date().toLocaleDateString('sv-SE'),
  monthlyDeposit: null,
  feeBalancePct: null,
  feeDepositPct: null,
};

export function Savings() {
  const [v, setV] = useState<SavingsView | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const load = () => api<SavingsView>('/savings').then(setV);
  useEffect(() => {
    load();
  }, []);

  if (!v) return <div className="muted">טוען…</div>;
  const slices: Slice[] = v.byProduct.map((p, i) => ({ key: p.product, label: p.label, value: p.total, cls: SLOTS[i % 6] }));

  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h2 className="title">חסכונות ופנסיה</h2>
          <p className="muted">פנסיה, גמל, השתלמות והשקעות – כל מה שנחסך לטווח ארוך, במקום אחד. נשמר רק במחשב הזה.</p>
        </div>
        <div className="row wrap">
          <button className="ghost" onClick={() => setImporting(true)}>
            ייבוא דוח מסלקה / קובץ
          </button>
          <button className="primary" onClick={() => setEditing({ ...EMPTY })}>
            + הוספת חשבון
          </button>
        </div>
      </div>

      {importing && (
        <ImportSavings
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            load();
          }}
        />
      )}
      {editing && (
        <EditAccount
          draft={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {v.accounts.length === 0 ? (
        <section className="card hero-empty">
          <h3>עוד אין כאן חסכונות</h3>
          <p className="muted">הדרך הכי מהירה לראות הכול: דוח מסלקה פנסיונית – קובץ אחד עם כל הפנסיה, הגמל וההשתלמות שרשומים על שמך.</p>
          <HowTo />
          <div className="row wrap center-row">
            <button className="primary" onClick={() => setImporting(true)}>
              ייבוא הקובץ
            </button>
            <button className="ghost" onClick={() => setEditing({ ...EMPTY })}>
              הוספה ידנית
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="kpis">
            <div className="tile">
              <div className="tile-label">סך הכול נחסך</div>
              <div className="tile-value">{money(v.total)}</div>
              <div className="sub">ב-{v.accounts.length} חשבונות</div>
            </div>
            <div className="tile">
              <div className="tile-label">הפקדות בחודש</div>
              <div className="tile-value">{v.monthlyDeposits || v.bankMonthly ? money(v.monthlyDeposits || v.bankMonthly) : '—'}</div>
              <div className="sub">
                {v.bankMonthly ? `בבנק רואים כ-${money(v.bankMonthly)} בחודש לפנסיה וגמל` : v.monthlyDeposits ? 'לפי הנתונים שהוזנו' : 'אפשר להזין ב"עריכה" לכל חשבון'}
              </div>
            </div>
            <div className="tile">
              <div className="tile-label">דמי ניהול בשנה</div>
              <div className="tile-value">{money(v.feeTotal)}</div>
              <div className="sub">{v.feeSave > 100 ? `אפשר לחסוך כ-${money(v.feeSave)} בשנה` : 'לפי האחוזים שהוזנו'}</div>
            </div>
          </div>

          <div className="grid-main">
            <section className="card vcard">
              <h3>איפה הכסף נמצא</h3>
              <p className="vcard-sub">כל החיסכון לטווח ארוך לפי סוג.</p>
              <Donut slices={slices} center={money(v.total)} sub="סך הכול" />
            </section>
            <section className="card">
              <h3>מה כדאי לעשות</h3>
              <div className="stack-s">
                {v.insights.map((i, n) => (
                  <article key={n} className={`insight ${i.tone}`}>
                    <div className="insight-icon" aria-hidden>
                      {i.icon}
                    </div>
                    <div>
                      <h4>
                        {i.title}
                        {i.yearly ? <span className="idea-gain">כ-{money(i.yearly)} בשנה</span> : null}
                      </h4>
                      <p>{i.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="card flush">
            <table className="data-table savings-table">
              <thead>
                <tr>
                  <th>חברה</th>
                  <th>סוג</th>
                  <th>יתרה</th>
                  <th>הפקדה חודשית</th>
                  <th>דמי ניהול</th>
                  <th>מעודכן ל-</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.accounts.map((a) => (
                  <tr key={a.id} className={a.status === 'inactive' ? 'dim' : ''}>
                    <td className="sv-provider">
                      <b>{a.provider}</b>
                      <div className="sub">
                        {a.accountNumber}
                        {a.track ? ` · ${a.track}` : ''}
                      </div>
                    </td>
                    <td className="sv-type">
                      {LABEL[a.product]}
                      {a.status === 'inactive' && <span className="badge warm">לא פעיל</span>}
                    </td>
                    <td className="nowrap sv-balance">
                      <b>{money(a.balance)}</b>
                    </td>
                    <td className="nowrap" data-label="הפקדה חודשית">{a.monthlyDeposit ? money(a.monthlyDeposit) : '—'}</td>
                    <td className="nowrap" data-label="דמי ניהול">
                      {a.feeBalancePct !== null ? `${a.feeBalancePct}% מצבירה` : '—'}
                      {a.feeDepositPct !== null ? <div className="sub">{a.feeDepositPct}% מהפקדה</div> : null}
                    </td>
                    <td className="nowrap muted" data-label="מעודכן ל-">{a.balanceDate ? date(a.balanceDate) : '—'}</td>
                    <td className="nowrap sv-edit">
                      <button className="link small" onClick={() => setEditing({ ...a })}>
                        עריכה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <details className="card">
            <summary>איך מעדכנים את הנתונים?</summary>
            <HowTo />
          </details>
        </>
      )}
    </div>
  );
}

function HowTo() {
  return (
    <ol className="howto">
      <li>
        <b>דוח מסלקה פנסיונית</b> – מבקשים מהסוכן "דוח מסלקה" בקובץ Excel, או מזמינים בעצמך באתר המסלקה (סוויפטנס). הקובץ כולל יתרות, מסלולים ודמי ניהול.
      </li>
      <li>
        <b>הר הכסף</b> (משרד האוצר) – מראה את כל החשבונות על שמך, כולל ישנים ונשכחים. אם אפשר לשמור משם קובץ – אפשר לייבא אותו כאן.
      </li>
      <li>
        <b>דוח רבעוני או שנתי מהחברה</b> – מספיק להעתיק את היתרה ואת דמי הניהול ב"הוספת חשבון".
      </li>
      <li>
        <b>השקעות ופיקדונות</b> – מוסיפים ידנית ומעדכנים פעם בכמה חודשים.
      </li>
    </ol>
  );
}

function EditAccount({ draft, onClose, onDone }: { draft: Draft; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [error, setError] = useState('');
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setD((x) => ({ ...x, [k]: val }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { id, ...body } = d;
      await api(id ? `/savings/${id}` : '/savings', { method: id ? 'PUT' : 'POST', json: { ...body, accountNumber: body.accountNumber ?? '' } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? 'חסר שם חברה או יתרה.' : 'משהו השתבש.');
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="calm-card form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{d.id ? 'עריכת חשבון' : 'חשבון חיסכון חדש'}</h3>
        <div className="grid2">
          <label>
            חברה
            <input value={d.provider} onChange={(e) => set('provider', e.target.value)} placeholder="הראל, הפניקס, אלטשולר שחם…" autoFocus />
          </label>
          <label>
            סוג
            <select value={d.product} onChange={(e) => set('product', e.target.value as SavingsProduct)}>
              {PRODUCTS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            יתרה (₪)
            <input inputMode="decimal" value={d.balance || ''} onChange={(e) => set('balance', num(e.target.value) ?? 0)} />
          </label>
          <label>
            נכון לתאריך
            <input type="date" value={d.balanceDate ?? ''} onChange={(e) => set('balanceDate', e.target.value || null)} />
          </label>
          <label>
            הפקדה חודשית (₪)
            <input inputMode="decimal" value={d.monthlyDeposit ?? ''} onChange={(e) => set('monthlyDeposit', num(e.target.value))} />
          </label>
          <label>
            מספר חשבון / פוליסה
            <input value={d.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
          </label>
          <label>
            דמי ניהול מהצבירה (%)
            <input inputMode="decimal" value={d.feeBalancePct ?? ''} onChange={(e) => set('feeBalancePct', num(e.target.value))} placeholder="למשל 0.25" />
          </label>
          <label>
            דמי ניהול מההפקדה (%)
            <input inputMode="decimal" value={d.feeDepositPct ?? ''} onChange={(e) => set('feeDepositPct', num(e.target.value))} placeholder="למשל 1.5" />
          </label>
          <label>
            מסלול השקעה
            <input value={d.track ?? ''} onChange={(e) => set('track', e.target.value || null)} placeholder="כללי, מנייתי, הלכה…" />
          </label>
          <label className="check">
            <input type="checkbox" checked={d.status === 'inactive'} onChange={(e) => set('status', e.target.checked ? 'inactive' : 'active')} />
            לא פעיל (כבר לא מפקידים אליו)
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row between">
          {d.id ? (
            <button
              type="button"
              className="link small"
              onClick={async () => {
                if (!confirm(`למחוק את ${d.provider} מהרשימה?`)) return;
                await api(`/savings/${d.id}`, { method: 'DELETE' });
                onDone();
              }}
            >
              מחיקה
            </button>
          ) : (
            <span />
          )}
          <div className="row">
            <button type="button" className="ghost" onClick={onClose}>
              ביטול
            </button>
            <button className="primary" disabled={!d.provider.trim()}>
              שמירה
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ImportSavings({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ accounts: Omit<SavingsAccount, 'id' | 'source' | 'updatedAt'>[]; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (f: File, dryRun: boolean) => {
    setBusy(true);
    setError('');
    try {
      const q = new URLSearchParams({ filename: f.name, dryRun: dryRun ? '1' : '0' });
      const r = await api<typeof preview & { added?: number }>(`/savings/import?${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await f.arrayBuffer(),
      });
      if (dryRun) setPreview(r);
      else onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'HEADER_NOT_FOUND'
          ? 'לא מצאתי בקובץ עמודות של חברה ויתרה. אפשר לשלוח לי צילום של שורת הכותרות, או להוסיף ידנית.'
          : 'לא הצלחתי לקרוא את הקובץ (Excel ‏.xlsx או CSV).',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="calm-card wide" onClick={(e) => e.stopPropagation()}>
        <h3>ייבוא דוח מסלקה או קובץ חסכונות</h3>
        <p className="sub">Excel או CSV. המערכת מזהה לבד עמודות כמו "גוף מנהל", "סוג מוצר", "יתרה צבורה" ו"דמי ניהול". ייבוא חוזר מעדכן את החשבונות הקיימים.</p>
        <input
          type="file"
          accept=".xlsx,.csv,.xls,.html"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(null);
            if (f) send(f, true);
          }}
        />
        {error && <div className="error">{error}</div>}
        {preview && (
          <>
            <div className="small">
              נמצאו <b>{preview.accounts.length}</b> חשבונות{preview.skipped ? ` (${preview.skipped} שורות דולגו – סיכומים או שורות ריקות)` : ''}:
            </div>
            <table className="data-table">
              <tbody>
                {preview.accounts.map((a, i) => (
                  <tr key={i}>
                    <td>{a.provider}</td>
                    <td>{LABEL[a.product]}</td>
                    <td>{money(a.balance)}</td>
                    <td className="muted small">
                      {a.feeBalancePct !== null ? `${a.feeBalancePct}%` : ''}
                      {a.feeDepositPct !== null ? ` / ${a.feeDepositPct}%` : ''}
                    </td>
                    <td className="muted small">{a.status === 'inactive' ? 'לא פעיל' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="row between">
          <button className="ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="primary" disabled={!file || !preview?.accounts.length || busy} onClick={() => file && send(file, false)}>
            {busy ? 'רגע…' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}
