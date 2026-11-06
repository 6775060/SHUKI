import { useEffect, useState } from 'react';
import type { BridgeStatus } from '@fontshok/figma-bridge';
import type { StudioSettings } from '../../../main/core/settings';
import { api } from '../api';
import { useAction, type Toast } from '../ui';

export function SettingsPage({ figma, toast }: { figma: BridgeStatus | null; toast: Toast }) {
  const [s, setS] = useState<StudioSettings | null>(null);
  const [manifest, setManifest] = useState<string | null>(null);
  const { run } = useAction(toast);
  useEffect(() => {
    void api.getSettings().then(setS);
    void window.studio.pluginManifest().then(setManifest);
  }, []);
  if (!s) return null;
  const save = (patch: Partial<StudioSettings>) => run('save', async () => setS(await api.updateSettings(patch)), 'נשמר');

  const missingFonts = (() => {
    if (!figma?.plugin) return [];
    const have = new Set(figma.plugin.availableFonts);
    return ['Sprinter_FS|Black ', 'Sprinter_FS|Regular', 'Sprinter_FS|Bold', 'Sprinter_FS|Demi-bold'].filter((f) => !have.has(f));
  })();

  return (
    <div className="settings">
      <section className="panel">
        <h2>חיבור ל־Figma</h2>
        <p>
          <b>פעם ראשונה בלבד:</b> ב־Figma Desktop, קליק ימני על משטח העבודה ← Plugins ← Development ← Import plugin from manifest…, ובוחרים את הקובץ:
        </p>
        <div className="row">
          <input dir="ltr" value={manifest ?? ''} readOnly onFocus={(e) => e.target.select()} />
          <button onClick={() => void navigator.clipboard.writeText(manifest ?? '').then(() => toast('ok', 'הנתיב הועתק. בחלון הבחירה של Figma מדביקים אותו בשורת שם הקובץ'))}>העתק נתיב</button>
          <button onClick={() => void window.studio.revealPlugin()}>פתח את התיקייה</button>
        </div>
        <p>
          <b>בכל פעם:</b> פותחים ב־Figma Desktop את הקובץ עם עמוד <b>Templates</b>, קליק ימני ← Plugins ← Development ← FontShok Mockup Studio Bridge, ומזינים בפלאגין את קוד החיבור:
        </p>
        <div className="pairing">{s.pairingToken}</div>
        <div className="row">
          <button onClick={() => run('tok', async () => setS(await api.regeneratePairingToken()), 'נוצר קוד חדש')}>קוד חדש</button>
        </div>
        <p>
          מצב: <b>{figma?.connected ? `מחובר – ${figma.plugin?.fileName}` : 'לא מחובר'}</b>
        </p>
        {figma?.connected && missingFonts.length > 0 && <p className="bad">חסרים במחשב הפונטים: {missingFonts.join(', ')} – לא ניתן לבנות מוקאפים עד שיותקנו.</p>}
        <label>פורט (דורש הפעלה מחדש)</label>
        <input dir="ltr" type="number" value={s.wsPort} onChange={(e) => setS({ ...s, wsPort: Number(e.target.value) })} onBlur={() => save({ wsPort: s.wsPort })} />
      </section>
      <section className="panel">
        <h2>ייצוא</h2>
        <label>תיקיית יעד (תיקייה לכל קבוצה תיווצר בתוכה)</label>
        <div className="row">
          <input dir="rtl" value={s.exportRoot} readOnly />
          <button
            onClick={async () => {
              const p = await window.studio.pickFolder();
              if (p) save({ exportRoot: p });
            }}
          >
            בחירה…
          </button>
        </div>
        <label>רזולוציה</label>
        <select value={s.exportScale} onChange={(e) => save({ exportScale: Number(e.target.value) as 1 | 2 })}>
          <option value={1}>1080 × 1350 (1x)</option>
          <option value={2}>2160 × 2700 (2x)</option>
        </select>
        <p className="muted small">הכתיבה לדיסק מוגבלת לתיקיית הייצוא ולתיקיית הנתונים של האפליקציה בלבד.</p>
      </section>
      <section className="panel">
        <h2>סריקה</h2>
        <label>דפדפן לסריקה</label>
        <select value={s.browserChannel} onChange={(e) => save({ browserChannel: e.target.value })}>
          <option value="msedge">Microsoft Edge המותקן (מומלץ ב־Windows)</option>
          <option value="chrome">Google Chrome המותקן</option>
          <option value="">Chromium של Playwright</option>
        </select>
        <label>סריקות במקביל</label>
        <input type="number" min={1} max={4} value={s.scanConcurrency} onChange={(e) => setS({ ...s, scanConcurrency: Number(e.target.value) })} onBlur={() => save({ scanConcurrency: s.scanConcurrency })} />
        <label>גובה עמוד מקסימלי לצילום (px)</label>
        <input type="number" value={s.maxPageHeight} onChange={(e) => setS({ ...s, maxPageHeight: Number(e.target.value) })} onBlur={() => save({ maxPageHeight: s.maxPageHeight })} />
        <p className="muted small">שינוי דפדפן נכנס לתוקף אחרי הפעלה מחדש של האפליקציה.</p>
      </section>
    </div>
  );
}
