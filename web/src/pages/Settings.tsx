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
