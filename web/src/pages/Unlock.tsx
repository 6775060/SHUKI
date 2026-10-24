import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';

export function Unlock({ mode, onDone }: { mode: 'setup' | 'locked'; onDone: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      </form>
    </div>
  );
}
