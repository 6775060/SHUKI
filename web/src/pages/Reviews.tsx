import { useEffect, useState } from 'react';
import { api, type Category, type Review } from '../api';
import { date, moneyExact } from '../format';
import { CategoryPicker } from '../CategoryPicker';

// Charges the user didn't recognize. Each one gets clues to work out what it
// is, a place for notes, and a way to close it with what happened.

const RESOLUTIONS: { key: Review['resolution'] & string; label: string; icon: string }[] = [
  { key: 'ok', label: 'זיהיתי – זה בסדר', icon: '✓' },
  { key: 'cancelled', label: 'ביטלתי את המנוי / השירות', icon: '✂' },
  { key: 'refund', label: 'ביקשתי החזר', icon: '↩' },
  { key: 'disputed', label: 'חיוב שגוי – פניתי לחברת האשראי', icon: '⚑' },
];

const RES_LABEL = Object.fromEntries(RESOLUTIONS.map((r) => [r.key, r.label]));

export function Reviews() {
  const [items, setItems] = useState<Review[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const load = () => api<Review[]>('/reviews').then(setItems);
  useEffect(() => {
    load();
    api<Category[]>('/categories').then(setCategories);
  }, []);

  const open = items.filter((r) => r.status === 'open');
  const done = items.filter((r) => r.status === 'done');
  const total = open.reduce((s, r) => s - r.amount, 0);

  return (
    <div className="stack">
      <h2 className="title">לבירור</h2>
      <p className="muted">
        חיובים שלא ברור מה הם. מסמנים "לבירור" במסך התנועות, והם מחכים כאן עד שמבררים. אין לחץ – הם רשומים ולא ייעלמו.
      </p>

      <div className="kpis">
        <div className="tile">
          <div className="tile-label">פתוחים</div>
          <div className="tile-value">{open.length}</div>
          <div className="sub">בסך {moneyExact(total)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">נסגרו</div>
          <div className="tile-value">{done.length}</div>
          <div className="sub">{done.filter((d) => d.resolution === 'refund' || d.resolution === 'cancelled').length} עם החזר או ביטול</div>
        </div>
      </div>

      {open.length === 0 && (
        <section className="card hero-empty">
          <h3>אין חיובים לבירור 🌿</h3>
          <p className="muted">כשתראה חיוב לא מוכר – במסך התנועות לוחצים "לבירור".</p>
        </section>
      )}

      <div className="reviews">
        {open.map((r) => (
          <ReviewCard key={r.id} r={r} categories={categories} onChanged={load} onCreated={(c) => setCategories((l) => [...l, c])} />
        ))}
      </div>

      {done.length > 0 && (
        <details className="card">
          <summary>בירורים שנסגרו ({done.length})</summary>
          {done.map((r) => (
            <div key={r.id} className="split-row">
              <span>
                {r.description} <span className="muted small">· {date(r.date)}</span>
              </span>
              <span className="small">{RES_LABEL[r.resolution ?? 'ok']}</span>
              <b>{moneyExact(r.amount)}</b>
              <button
                className="ghost small"
                onClick={async () => {
                  await api(`/reviews/${r.id}`, { method: 'PATCH', json: { status: 'open' } });
                  load();
                }}
              >
                לפתוח שוב
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function clues(r: Review): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  const h = r.history;
  if (h.count === 0) out.push({ icon: '🆕', text: 'חיוב ראשון מבית העסק הזה – לא היה ממנו חיוב קודם.' });
  else if (h.months >= 3)
    out.push({
      icon: '🔁',
      text: `חוזר כמעט כל חודש: ${h.count} חיובים קודמים מאז ${date(h.first!)}. כנראה מנוי, הוראת קבע או מקום קבוע.${h.sameAmount === 0 ? ' הפעם הסכום שונה מהרגיל.' : ''}`,
    });
  else out.push({ icon: '🧾', text: `${h.count} חיובים קודמים מבית העסק הזה, האחרון ב-${date(h.last!)}.` });
  if (r.originalCurrency && r.originalCurrency !== 'ILS') out.push({ icon: '🌍', text: `חיוב במטבע חוץ (${r.originalAmount} ${r.originalCurrency}) – לרוב שירות דיגיטלי, אפליקציה או רכישה באתר.` });
  if (r.installmentTotal && r.installmentTotal > 1) out.push({ icon: '📆', text: `תשלום ${r.installmentNumber} מתוך ${r.installmentTotal} – חלק מעסקה בתשלומים.` });
  if (/PAYPAL|פייפאל/i.test(r.description)) out.push({ icon: '🅿', text: 'דרך PayPal – הפירוט המלא נמצא בחשבון ה-PayPal.' });
  if (/GOOGLE|APPLE|ITUNES/i.test(r.description)) out.push({ icon: '📱', text: 'חנות אפליקציות – אולי מנוי באפליקציה. בטלפון: הגדרות ← מינויים.' });
  if (r.memo) out.push({ icon: '📝', text: `פירוט נוסף מהבנק: ${r.memo}` });
  return out;
}

function ReviewCard({ r, categories, onChanged, onCreated }: { r: Review; categories: Category[]; onChanged: () => void; onCreated: (c: Category) => void }) {
  const [note, setNote] = useState(r.note ?? '');
  const [saved, setSaved] = useState(false);
  const days = Math.max(0, Math.round((Date.now() - Date.parse(`${r.openedAt.replace(' ', 'T')}Z`)) / 86400000));

  const close = async (resolution: string) => {
    await api(`/reviews/${r.id}`, { method: 'PATCH', json: { status: 'done', resolution, note } });
    onChanged();
  };

  return (
    <article className="card review">
      <div className="review-head">
        <div>
          <div className="review-title">{r.description}</div>
          <div className="sub">
            {date(r.date)} · {r.accountLabel}
            {r.processedDate && r.processedDate !== r.date ? ` · יורד בחשבון ${date(r.processedDate)}` : ''}
          </div>
        </div>
        <div className="review-amount">{moneyExact(r.amount)}</div>
      </div>

      <ul className="clues">
        {clues(r).map((c, i) => (
          <li key={i}>
            <span aria-hidden>{c.icon}</span> {c.text}
          </li>
        ))}
        <li>
          <span aria-hidden>🔎</span> לא מזהה? באזור האישי של חברת האשראי יש "פרטי עסקה" עם שם העסק המלא, ולרוב גם "בירור עסקה".
        </li>
      </ul>

      <label>
        מה לא ברור / מה גיליתי
        <textarea
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          onBlur={async () => {
            if (note !== (r.note ?? '')) {
              await api(`/reviews/${r.id}`, { method: 'PATCH', json: { note } });
              setSaved(true);
            }
          }}
          placeholder="למשל: לא זוכר קנייה כזו, בדקתי בקבלות…"
        />
      </label>
      {saved && <div className="success small">נשמר</div>}

      <div className="review-cat">
        <span className="small muted">קטגוריה:</span>
        <CategoryPicker
          categories={categories}
          value={r.categoryId}
          onPick={async (id) => {
            await api(`/reviews/${r.id}`, { method: 'PATCH', json: { categoryId: id } });
            onChanged();
          }}
          onCreated={onCreated}
        />
        <span className="muted small">בבירור {days === 0 ? 'מהיום' : `${days} ימים`}</span>
      </div>

      <div className="resolve">
        {RESOLUTIONS.map((x) => (
          <button key={x.key} className="ghost small" onClick={() => close(x.key)}>
            <span aria-hidden>{x.icon}</span> {x.label}
          </button>
        ))}
        <button
          className="link small"
          onClick={async () => {
            await api(`/reviews/${r.id}`, { method: 'DELETE' });
            onChanged();
          }}
        >
          הוצאה מהבירורים
        </button>
      </div>
    </article>
  );
}
