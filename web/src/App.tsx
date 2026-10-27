import { useEffect, useState } from 'react';
import { api, setOnLocked, setToken, type SyncAlert } from './api';
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
import { Savings } from './pages/Savings';
import { applyFont, type FontSetting } from './font';

export type Page = 'dashboard' | 'insights' | 'funds' | 'savings' | 'business' | 'transactions' | 'reviews' | 'connections' | 'import' | 'rules' | 'settings';

const NAV: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'בהירות' },
  { id: 'insights', label: 'תובנות' },
  { id: 'funds', label: 'קופות' },
  { id: 'savings', label: 'חסכונות' },
  { id: 'business', label: 'עסק' },
  { id: 'transactions', label: 'תנועות' },
  { id: 'reviews', label: 'לבירור' },
  { id: 'connections', label: 'חיבורים' },
  { id: 'import', label: 'ייבוא קובץ' },
  { id: 'rules', label: 'קטגוריות' },
  { id: 'settings', label: 'הגדרות' },
];

// On a phone: the four screens used most, at the thumb; the rest under "עוד".
const MOBILE_NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'בהירות', icon: '◐' },
  { id: 'transactions', label: 'תנועות', icon: '☰' },
  { id: 'reviews', label: 'לבירור', icon: '?' },
  { id: 'savings', label: 'חסכונות', icon: '₪' },
];

export interface Nav {
  go: (page: Page, params?: Record<string, string>) => void;
  params: Record<string, string>;
}

export function App() {
  const [state, setState] = useState<'loading' | 'setup' | 'locked' | 'open'>('loading');
  const [page, setPage] = useState<Page>('dashboard');
  const [params, setParams] = useState<Record<string, string>>({});
  const [syncAlerts, setSyncAlerts] = useState<SyncAlert[]>([]);
  const [more, setMore] = useState(false);

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

  // Re-checked on every page change, so a fixed connection clears the banner.
  useEffect(() => {
    if (state === 'open') api<SyncAlert[]>('/sync-alerts').then(setSyncAlerts).catch(() => {});
  }, [state, page]);

  useEffect(() => {
    if (state === 'open') api<{ font: FontSetting }>('/settings').then((r) => applyFont(r.font)).catch(() => {});
  }, [state]);

  const go: Nav['go'] = (p, prm = {}) => {
    setPage(p);
    setParams(prm);
    setMore(false);
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
  const alerts = syncAlerts.filter((a) => a.level !== 'info');
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
        <button className="ghost small lock-btn" onClick={lock} title="נעילה">
          🔒 נעילה
        </button>
      </header>
      <main className="content">
        {alerts.length > 0 && page !== 'connections' && <SyncBanner alerts={alerts} go={go} />}
        {page === 'dashboard' && <Dashboard nav={nav} />}
        {page === 'insights' && <Insights nav={nav} />}
        {page === 'funds' && <Funds />}
        {page === 'savings' && <Savings />}
        {page === 'business' && <Business nav={nav} />}
        {page === 'transactions' && <Transactions nav={nav} />}
        {page === 'reviews' && <Reviews />}
        {page === 'connections' && <Connections />}
        {page === 'import' && <Import />}
        {page === 'rules' && <Rules />}
        {page === 'settings' && <Settings />}
      </main>

      <nav className="bottom-nav" aria-label="ניווט">
        {MOBILE_NAV.map((n) => (
          <button key={n.id} className={page === n.id ? 'on' : ''} aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <span className="bn-icon" aria-hidden>
              {n.icon}
            </span>
            {n.label}
          </button>
        ))}
        <button className={more || !MOBILE_NAV.some((n) => n.id === page) ? 'on' : ''} aria-expanded={more} onClick={() => setMore(!more)}>
          <span className="bn-icon" aria-hidden>
            ⋯
          </span>
          עוד
        </button>
      </nav>

      {more && (
        <div className="sheet-overlay" onClick={() => setMore(false)}>
          <div className="sheet" role="dialog" aria-label="עוד מסכים" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden />
            {NAV.filter((n) => !MOBILE_NAV.some((m) => m.id === n.id)).map((n) => (
              <button key={n.id} className={page === n.id ? 'sheet-item on' : 'sheet-item'} onClick={() => go(n.id)}>
                {n.label}
              </button>
            ))}
            <button className="sheet-item muted" onClick={lock}>
              🔒 נעילה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncBanner({ alerts, go }: { alerts: SyncAlert[]; go: Nav['go'] }) {
  const critical = alerts.some((a) => a.level === 'critical');
  const first = alerts[0];
  return (
    <div className={`sync-banner ${critical ? 'critical' : ''}`} role="status">
      <span aria-hidden>⚠️</span>
      <span>
        <b>חסר סנכרון:</b> {alerts.length === 1 ? first.title : alerts.map((a) => a.source).join(', ')}
      </span>
      <span className="muted small">{alerts.length === 1 ? first.action : 'התמונה לא מלאה עד שיתעדכנו.'}</span>
      <button className="link small" onClick={() => go(first.page)}>
        לטיפול ←
      </button>
    </div>
  );
}
