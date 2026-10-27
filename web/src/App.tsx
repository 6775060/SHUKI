import { useEffect, useState } from 'react';
import { api, setOnLocked, setToken } from './api';
import { Unlock } from './pages/Unlock';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Connections } from './pages/Connections';
import { Import } from './pages/Import';
import { Rules } from './pages/Rules';
import { Insights } from './pages/Insights';
import { Funds } from './pages/Funds';
import { Business } from './pages/Business';
import { Settings } from './pages/Settings';
import { Reviews } from './pages/Reviews';
import { applyFont, type FontSetting } from './font';

export type Page = 'dashboard' | 'insights' | 'funds' | 'business' | 'transactions' | 'reviews' | 'connections' | 'import' | 'rules' | 'settings';

const NAV: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'בהירות' },
  { id: 'insights', label: 'תובנות' },
  { id: 'funds', label: 'קופות' },
  { id: 'business', label: 'עסק' },
  { id: 'transactions', label: 'תנועות' },
  { id: 'reviews', label: 'לבירור' },
  { id: 'connections', label: 'חיבורים' },
  { id: 'import', label: 'ייבוא קובץ' },
  { id: 'rules', label: 'קטגוריות' },
  { id: 'settings', label: 'הגדרות' },
];

export interface Nav {
  go: (page: Page, params?: Record<string, string>) => void;
  params: Record<string, string>;
}

export function App() {
  const [state, setState] = useState<'loading' | 'setup' | 'locked' | 'open'>('loading');
  const [page, setPage] = useState<Page>('dashboard');
  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    setOnLocked(() => setState('locked'));
    api<{ initialized: boolean; unlocked: boolean }>('/status').then(async (s) => {
      if (!s.initialized) return setState('setup');
      if (!s.unlocked) return setState('locked');
      try {
        await api('/categories');
        setState('open');
      } catch {
        setState('locked');
      }
    });
  }, []);

  useEffect(() => {
    if (state === 'open') api<{ font: FontSetting }>('/settings').then((r) => applyFont(r.font)).catch(() => {});
  }, [state]);

  const go: Nav['go'] = (p, prm = {}) => {
    setPage(p);
    setParams(prm);
    window.scrollTo(0, 0);
  };

  if (state === 'loading') return <div className="center muted">טוען…</div>;
  if (state === 'setup' || state === 'locked') {
    return (
      <Unlock
        mode={state}
        onDone={(token) => {
          setToken(token);
          setState('open');
        }}
        onReset={() => setState('setup')}
      />
    );
  }

  const lock = async () => {
    await api('/lock', { method: 'POST' }).catch(() => {});
    setToken(null);
    setState('locked');
  };

  const nav: Nav = { go, params };
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◐
          </span>
          שפע ובהירות
        </div>
        <nav className="tabs">
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? 'tab active' : 'tab'} onClick={() => go(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <button className="ghost small" onClick={lock} title="נעילה">
          🔒 נעילה
        </button>
      </header>
      <main className="content">
        {page === 'dashboard' && <Dashboard nav={nav} />}
        {page === 'insights' && <Insights nav={nav} />}
        {page === 'funds' && <Funds />}
        {page === 'business' && <Business nav={nav} />}
        {page === 'transactions' && <Transactions nav={nav} />}
        {page === 'reviews' && <Reviews />}
        {page === 'connections' && <Connections />}
        {page === 'import' && <Import />}
        {page === 'rules' && <Rules />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
