import { useState, type FormEvent } from 'react';
import { api, ApiError, restoreBackup, restoreErrorText } from '../api';

export function Unlock({ mode, onDone, onReset }: { mode: 'setup' | 'locked'; onDone: (token: string) => void; onReset: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetWord, setResetWord] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const reset = async () => {
    setBusy(true);
    try {
      await api('/reset', { method: 'POST', json: { confirm: resetWord.trim() } });
      setPassword('');
      setForgot(false);
      onReset();
    } catch {
      setError('האיפוס לא הצליח. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const r = await restoreBackup(file, password);
      if (r.token) onDone(r.token);
      else onReset();
    } catch (err) {
      setError(restoreErrorText(err instanceof ApiError ? err.code : ''));
    } finally {
      setBusy(false);
    }
  };

  if (restoring) {
    return (
      <div className="center">
        <form className="card unlock" onSubmit={restore}>
          <h1>שחזור מקובץ גיבוי</h1>
          <p className="muted">
            בוחרים את קובץ הגיבוי (מסתיים ב-<span dir="ltr">.shefa</span>) שנוצר במחשב הקודם ב"הגדרות" ← "גיבוי והעברה למחשב אחר", ומזינים את סיסמת-העל
            של אותו מחשב. הכול יחזור, כולל החיבורים לבנקים.
          </p>
          <label>
            קובץ הגיבוי
            <input type="file" accept=".shefa" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label>
            סיסמת-על
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || !file || !password}>
            {busy ? 'משחזר…' : 'שחזור'}
          </button>
          <button
            type="button"
            className="link small"
            onClick={() => {
              setError('');
              setRestoring(false);
            }}
          >
            חזרה – זו התקנה ראשונה
          </button>
        </form>
      </div>
    );
  }

  if (forgot) {
    return (
      <div className="center">
        <div className="card unlock">
          <h1>שכחתי את סיסמת-העל</h1>
          <p className="muted">
            את הסיסמה עצמה אי אפשר לשחזר – היא לא נשמרת בשום מקום, וזה מה ששומר על פרטי הבנק שלך. אבל אפשר <b>לאפס</b> ולבחור סיסמה חדשה.
          </p>
          <ul className="small">
            <li>✓ נשמרים: כל התנועות, הקטגוריות, הכללים, הבירורים וההגדרות.</li>
            <li>✗ נמחקים: פרטי הכניסה לבנקים, לכרטיסים ול-SUMIT. אחרי האיפוס מזינים אותם שוב במסך "חיבורים".</li>
          </ul>
          <label>
            כדי לאשר, כתבו <b>איפוס</b>
            <input value={resetWord} onChange={(e) => setResetWord(e.target.value)} autoFocus />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || resetWord.trim() !== 'איפוס'} onClick={reset}>
            {busy ? 'רגע…' : 'איפוס ובחירת סיסמה חדשה'}
          </button>
          <button className="link small" onClick={() => setForgot(false)}>
            חזרה – נזכרתי
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'setup') {
      if (password.length < 8) return setError('סיסמה של 8 תווים לפחות.');
      if (password !== confirm) return setError('הסיסמאות לא זהות.');
    }
    setBusy(true);
    try {
      const r = await api<{ token: string }>(mode === 'setup' ? '/setup' : '/unlock', { method: 'POST', json: { password } });
      onDone(r.token);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'WRONG_PASSWORD' ? 'הסיסמה לא נכונה.' : 'משהו השתבש. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card unlock" onSubmit={submit}>
        <div className="logo big" aria-hidden>
          ◐
        </div>
        <h1>שפע ובהירות</h1>
        {mode === 'setup' ? (
          <>
            <p className="muted">
              ברוך הבא. בוחרים <b>סיסמת-על</b> אחת. היא מצפינה את פרטי הכניסה לבנקים, ונשמרת רק בראש שלך – אי אפשר לשחזר אותה.
            </p>
            <label>
              סיסמת-על
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
            </label>
            <label>
              שוב, לאימות
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
          </>
        ) : (
          <>
            <p className="muted">המערכת נעולה. הסיסמה פותחת את הכספת, והסנכרון היומי חוזר לפעול.</p>
            <label>
              סיסמת-על
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
            </label>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'רגע…' : mode === 'setup' ? 'יוצאים לדרך' : 'פתיחה'}
        </button>
        {mode === 'setup' && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              setError('');
              setPassword('');
              setRestoring(true);
            }}
          >
            עוברים ממחשב אחר? שחזור מקובץ גיבוי
          </button>
        )}
        {mode === 'locked' && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              setError('');
              setForgot(true);
            }}
          >
            שכחתי סיסמה
          </button>
        )}
      </form>
    </div>
  );
}
