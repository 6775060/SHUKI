import { useCallback, useEffect, useState } from 'react';
import type { BridgeStatus } from '@fontshok/figma-bridge';
import { api } from './api';
import { SitesPage } from './pages/Sites';
import { FontsPage } from './pages/Fonts';
import { GroupsPage } from './pages/Groups';
import { HistoryPage } from './pages/History';
import { SettingsPage } from './pages/Settings';
import { Toasts, useToasts } from './ui';

type Tab = 'sites' | 'groups' | 'fonts' | 'history' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'sites', label: 'אתרים' },
  { id: 'groups', label: 'קבוצות ואישור' },
  { id: 'fonts', label: 'מאגר פונטים' },
  { id: 'history', label: 'היסטוריה' },
  { id: 'settings', label: 'הגדרות' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('sites');
  const [figma, setFigma] = useState<BridgeStatus | null>(null);
  const [tick, setTick] = useState({ sites: 0, groups: 0 });
  const toasts = useToasts();

  const refreshFigma = useCallback(() => void api.figmaStatus().then(setFigma).catch(() => undefined), []);
  useEffect(() => {
    refreshFigma();
    return window.studio.onEvent((e) => {
      if (e.type === 'figma') setFigma(e.status);
      if (e.type === 'sites-changed') setTick((t) => ({ ...t, sites: t.sites + 1 }));
      if (e.type === 'groups-changed') setTick((t) => ({ ...t, groups: t.groups + 1 }));
      if (e.type === 'error') toasts.push('error', `${e.scope}: ${e.message}`);
      if (e.type === 'progress') toasts.push('info', e.message, 2500);
    });
  }, [refreshFigma, toasts]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">פונט<br />שוק</span>
          <span>Mockup Studio</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className={figma?.connected ? 'conn on' : 'conn'} title={figma?.plugin ? `${figma.plugin.fileName} · plugin v${figma.plugin.pluginVersion}` : ''}>
          <span className="dot" />
          {figma?.connected ? `Figma: ${figma.plugin?.fileName ?? 'מחובר'}` : 'Figma לא מחובר'}
        </div>
      </header>
      <main>
        {tab === 'sites' && <SitesPage tick={tick.sites} toast={toasts.push} />}
        {tab === 'groups' && <GroupsPage tick={tick.groups} figmaConnected={!!figma?.connected} toast={toasts.push} />}
        {tab === 'fonts' && <FontsPage toast={toasts.push} />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'settings' && <SettingsPage figma={figma} toast={toasts.push} />}
      </main>
      <Toasts items={toasts.items} />
    </div>
  );
}
