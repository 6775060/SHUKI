import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type BusinessData } from '../api';
import { currentMonth, date, money, monthLabel, relativeTime } from '../format';
import { CategoryCompareChart, IncomeExpenseChart, Meter, TableToggle } from '../charts';
import type { Nav } from '../App';

const shortMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
};

export function Business({ nav }: { nav: Nav }) {
  const [month, setMonth] = useState(nav.params.month ?? currentMonth());
  const [d, setD] = useState<BusinessData | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<BusinessData>(`/business?month=${month}`).then(setD);
  }, [month, reload]);

  if (!d) return <div className="muted">טוען…</div>;

  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const t = new Date();
    months.push(new Date(t.getFullYear(), t.getMonth() - i, 15).toISOString().slice(0, 7));
  }
  const first = d.trend.findIndex((p) => p.bizIncome > 0 || p.bizExpenses > 0);
  const trend = d.trend.slice(Math.max(0, first)).map((p) => ({ label: shortMonth(p.month), income: p.bizIncome, expenses: p.bizExpenses }));
  const cats = d.categories.filter((c) => c.total > 0 || c.avg > 0).slice(0, 8);
  const op = d.ownerPay;

  return (
    <div className="stack">
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="חודש">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <h2 className="title">העסק</h2>

      <div className="kpis">
        <div className="tile">
          <div className="tile-label">הכנסות</div>
          <div className="tile-value">{money(d.income)}</div>
          <div className="sub">ממוצע 6 חודשים: {d.avgIncome !== null ? money(d.avgIncome) : '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">הוצאות (כולל מסים)</div>
          <div className="tile-value">{money(d.expenses)}</div>
          <div className="sub">כולל מע"מ וביטוח לאומי ששולמו</div>
        </div>
        <div className="tile">
          <div className="tile-label">נשאר בעסק</div>
          <div className={`tile-value ${d.net >= 0 ? 'pos' : 'warm'}`}>{money(d.net)}</div>
          <div className="sub">{d.margin !== null ? `${Math.round(d.margin * 100)}% מההכנסה` : ''}</div>
        </div>
        <div className="tile">
          <div className="tile-label">להפריש למע"מ (הערכה)</div>
          <div className="tile-value">{money(d.vat.estimate)}</div>
          <div className="sub">
            עסקאות {money(d.vat.sales)} − תשומות {money(d.vat.purchases)}
          </div>
        </div>
      </div>

      {d.tips.length > 0 && (
        <section>
          <h3>איך להגדיל רווחיות – לפי המספרים שלך</h3>
          <div className="tips">
            {d.tips.map((t) => (
              <article key={t.key} className={`tip ${t.relevance}`}>
                <div className="tip-head">
                  <span className="insight-icon" aria-hidden>
                    {t.icon}
                  </span>
                  <div>
                    <div className="insight-tone">
                      {t.relevance === 'high' ? 'רלוונטי מאוד עכשיו' : 'כדאי לשקול'}
                      {t.impact ? ` · פוטנציאל: ${money(t.impact)} בחודש` : ''}
                    </div>
                    <h4>{t.title}</h4>
                  </div>
                </div>
                <p>
                  <b>למה זה רלוונטי לך: </b>
                  {t.why}
                </p>
                <p>
                  <b>הצעד: </b>
                  {t.action}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid-main">
        <section className="card">
          <h3>הכנסות והוצאות העסק</h3>
          <TableToggle
            table={
              <table className="data-table">
                <thead>
                  <tr>
                    <th>חודש</th>
                    <th>הכנסות</th>
                    <th>הוצאות</th>
                    <th>נשאר</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t) => (
                    <tr key={t.label}>
                      <td>{t.label}</td>
                      <td>{money(t.income)}</td>
                      <td>{money(t.expenses)}</td>
                      <td>{money(t.income - t.expenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <IncomeExpenseChart data={trend} />
          </TableToggle>
        </section>

        <section className="card">
          <h3>משכורת לעצמך</h3>
          {op.sustainable !== null ? (
            <>
              <div className="tile-label">מה העסק יכול לשלם לך כל חודש, ביציבות</div>
              <div className="tile-value">{money(op.sustainable)}</div>
              <p className="sub">
                ממוצע של {op.months} חודשים: נשאר בעסק כ-{money(op.businessNetAvg ?? 0)} אחרי כל ההוצאות והמסים. 10% נשארים כרית לעסק.
              </p>
              {op.actualAvg !== null && (
                <>
                  <div className="split-row">
                    <span>עובר הביתה בפועל (ממוצע 3 חודשים)</span>
                    <b>{money(op.actualAvg)}</b>
                  </div>
                  <Meter value={op.actualAvg} max={Math.max(op.actualAvg, op.sustainable) * 1.1 || 1} marker={op.sustainable} tone={op.actualAvg > op.sustainable * 1.1 ? 'warning' : 'accent'} label="משכורת בפועל מול בת-קיימא" />
                  <p className="sub">
                    {op.actualAvg > op.sustainable * 1.1
                      ? 'הבית מקבל יותר ממה שהעסק מייצר. לאורך זמן זה שוחק את העסק.'
                      : op.actualAvg < op.sustainable * 0.8
                        ? 'יש מקום להעלות את המשכורת לבית – או להשאיר בעסק ולבנות כרית.'
                        : 'המשכורת לבית מאוזנת עם מה שהעסק מייצר. 👌'}
                  </p>
                </>
              )}
            </>
          ) : (
            <p className="muted">צריך לפחות חודשיים מלאים של נתונים מחשבון העסק.</p>
          )}
          <div className="sep" />
          <h3>חלוקת ההכנסה החודש (Profit First)</h3>
          <p className="sub">כל שקל שנכנס לעסק מתחלק מיד. כך מע"מ ומס לא מבהילים, והרווח לא "מה שנשאר".</p>
          {d.allocation.map((a) => (
            <div key={a.label} className="split-row">
              <span>{a.label}</span>
              <span className="muted small">{a.pct}%</span>
              <b>{money(a.amount)}</b>
            </div>
          ))}
          <TaxReserve pct={d.taxReservePct} onSaved={() => setReload((r) => r + 1)} />
        </section>
      </div>

      <div className="grid-main">
        <section className="card">
          <h3>הוצאות העסק מול חודש רגיל</h3>
          {cats.length ? (
            <CategoryCompareChart data={cats.map((c) => ({ id: c.categoryId, name: c.name, total: c.total, avg: c.avg }))} onSelect={(id) => nav.go('transactions', { month, categoryId: String(id) })} />
          ) : (
            <div className="muted">אין הוצאות עסקיות בחודש הזה.</div>
          )}
        </section>

        <section className="card">
          <h3>לקוחות (3 חודשים)</h3>
          <p className="sub">{d.clientSource === 'documents' ? 'לפי החשבוניות שהוצאו' : 'לפי ההעברות לחשבון העסק. חיבור SUMIT ייתן תמונה מדויקת יותר.'}</p>
          {d.clients.slice(0, 8).map((c) => (
            <div key={c.name} className="source-row">
              <span className="source-name">{c.name}</span>
              <Meter value={c.share} max={1} label={c.name} />
              <span className="muted small">{Math.round(c.share * 100)}%</span>
            </div>
          ))}
          <div className="sep" />
          <h3>עמלות סליקה ובנק (3 חודשים)</h3>
          <div className="split-row strong">
            <span>סה"כ</span>
            <span>
              {money(d.fees.total)}
              {d.fees.pctOfTurnover !== null ? ` · ${(d.fees.pctOfTurnover * 100).toFixed(1)}% מהמחזור` : ''}
            </span>
          </div>
          {d.fees.bySource.slice(0, 5).map((f) => (
            <div key={f.name} className="split-row">
              <span>{f.name}</span>
              <span>{money(f.total)}</span>
            </div>
          ))}
        </section>
      </div>

      {(d.docs.openInvoices.length > 0 || d.docs.expensesWithoutInvoice.length > 0) && (
        <div className="grid-main">
          <section className="card">
            <h3>חשבוניות שעוד לא נגבו</h3>
            {d.docs.openInvoices.length === 0 && <div className="muted">אין. 👏</div>}
            {d.docs.openInvoices.map((i, idx) => (
              <div key={idx} className="split-row">
                <span>
                  {i.counterparty ?? 'לקוח'} {i.number ? <span className="muted small">#{i.number}</span> : null}
                </span>
                <span className={i.days > 45 ? 'warm small' : 'muted small'}>לפני {i.days} ימים</span>
                <b>{money(i.amount)}</b>
              </div>
            ))}
          </section>
          <section className="card">
            <h3>הוצאות עסקיות בלי חשבונית</h3>
            {d.docs.expensesWithoutInvoice.length === 0 && <div className="muted">הכול מתועד. 👏</div>}
            {d.docs.expensesWithoutInvoice.map((e, idx) => (
              <div key={idx} className="split-row">
                <span>{e.description}</span>
                <span className="muted small">{date(e.date)}</span>
                <b>{money(e.amount)}</b>
              </div>
            ))}
          </section>
        </div>
      )}

      <Connections d={d} onChanged={() => setReload((r) => r + 1)} />
    </div>
  );
}

function TaxReserve({ pct, onSaved }: { pct: number; onSaved: () => void }) {
  const [v, setV] = useState(String(pct));
  return (
    <details className="settings">
      <summary className="muted small">אחוז הפרשה למס הכנסה וביטוח לאומי</summary>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          await api('/settings', { method: 'PUT', json: { taxReservePct: Number(v) || 0 } });
          onSaved();
        }}
      >
        <input type="number" min={0} max={60} value={v} onChange={(e) => setV(e.target.value)} dir="ltr" style={{ width: 80 }} />
        <span>%</span>
        <button className="ghost small">שמירה</button>
      </form>
      <p className="sub">את האחוז המתאים לך כדאי לקבוע עם רואה החשבון, לפי המדרגה והמקדמות.</p>
    </details>
  );
}

const SOURCES = [
  { id: 'grow', name: 'Grow (משולם)', kind: 'payment' as const, hint: 'באזור האישי של Grow: דוחות → עסקאות → ייצוא לאקסל.' },
  { id: 'sumit', name: 'SUMIT – מסמכים', kind: 'income' as const, hint: 'ב-SUMIT: מסמכים → סינון לפי תאריכים → ייצוא לאקסל.' },
  { id: 'paperless', name: 'Paperless – חשבוניות הוצאה', kind: 'expense' as const, hint: 'ב-Paperless: ייצוא רשימת המסמכים לאקסל.' },
];

function Connections({ d, onChanged }: { d: BusinessData; onChanged: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState(SOURCES[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ count: number; skipped: number; headers: string[]; preview: { date: string; counterparty?: string; amount: number; fee?: number }[] } | null>(null);
  const source = SOURCES.find((s) => s.id === src)!;
  const count = (id: string) => d.connections.sources.find((s) => s.source === id);

  const connectSumit = async (e: FormEvent) => {
    e.preventDefault();
    await api('/business/sumit', { method: 'PUT', json: { companyId, apiKey } });
    setApiKey('');
    await syncSumit();
  };
  const syncSumit = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ added: number; updated: number }>('/business/sumit/sync', { method: 'POST' });
      setMsg(`נמשכו ${r.added} מסמכים חדשים מ-SUMIT.`);
    } catch (err) {
      setMsg(`החיבור ל-SUMIT לא הצליח (${(err as ApiError).code}). בינתיים אפשר לייבא קובץ מ-SUMIT כאן למטה.`);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const send = async (dry: boolean) => {
    if (!file) return;
    const q = new URLSearchParams({ source: src, kind: source.kind, filename: file.name, dryRun: dry ? '1' : '0' });
    try {
      const r = await api<typeof preview & { added: number }>(`/business/import?${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      if (dry) setPreview(r);
      else {
        setMsg(`נוספו ${r!.added} מסמכים מ-${source.name}.`);
        setPreview(null);
        setFile(null);
        onChanged();
      }
    } catch (err) {
      setMsg((err as ApiError).code === 'HEADER_NOT_FOUND' ? 'לא מצאתי בקובץ עמודות של תאריך וסכום.' : 'הייבוא נכשל.');
    }
  };

  return (
    <section className="card">
      <h3>חיבורים: SUMIT, Grow, Paperless</h3>
      <div className="grid2">
        <div className="form">
          <div className="strong">SUMIT – חיבור ישיר (ניסיוני)</div>
          {d.connections.sumit ? (
            <>
              <div className="sub">
                מחובר · סנכרון אחרון: {relativeTime(d.connections.sumitLastSync)}
                {d.connections.sumitError ? ` · שגיאה: ${d.connections.sumitError}` : ''}
              </div>
              <div className="row">
                <button className="primary small" onClick={syncSumit} disabled={busy}>
                  {busy ? 'מסנכרן…' : 'לסנכרן עכשיו'}
                </button>
                <button
                  className="ghost small danger"
                  onClick={async () => {
                    await api('/business/sumit', { method: 'DELETE' });
                    onChanged();
                  }}
                >
                  ניתוק
                </button>
              </div>
            </>
          ) : (
            <form className="form" onSubmit={connectSumit}>
              <p className="sub">ב-SUMIT: הגדרות → API → מזהה חברה ומפתח API. המפתח נשמר מוצפן בכספת, רק במחשב הזה.</p>
              <label>
                מזהה חברה (CompanyID)
                <input value={companyId} onChange={(e) => setCompanyId(e.target.value)} dir="ltr" inputMode="numeric" />
              </label>
              <label>
                מפתח API
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr" autoComplete="off" />
              </label>
              <button className="primary small" disabled={!companyId || apiKey.length < 8}>
                חיבור וסנכרון
              </button>
            </form>
          )}
        </div>

        <div className="form">
          <div className="strong">ייבוא קובץ</div>
          <label>
            מאיפה?
            <select
              value={src}
              onChange={(e) => {
                setSrc(e.target.value);
                setPreview(null);
              }}
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {count(s.id) ? ` (${count(s.id)!.n} מסמכים)` : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="sub">{source.hint}</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="row">
            <button className="ghost small" disabled={!file} onClick={() => send(true)}>
              תצוגה מקדימה
            </button>
            {preview && (
              <button className="primary small" onClick={() => send(false)}>
                לייבא {preview.count} מסמכים
              </button>
            )}
          </div>
          {preview && (
            <div className="sub">
              עמודות: {preview.headers.filter(Boolean).join(' · ')}
              {preview.preview.slice(0, 4).map((p, i) => (
                <div key={i}>
                  {date(p.date)} · {p.counterparty ?? '—'} · {money(p.amount)}
                  {p.fee ? ` · עמלה ${money(p.fee)}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {msg && <div className="note">{msg}</div>}
    </section>
  );
}
