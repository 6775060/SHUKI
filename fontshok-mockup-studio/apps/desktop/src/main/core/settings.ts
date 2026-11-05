import { randomInt } from 'node:crypto';
import type { Db } from '@fontshok/db';
import { DEFAULT_WS_PORT } from '@fontshok/shared';

export const DEFAULT_EXPORT_ROOT = 'D:\\Users\\1\\Desktop\\פונטשוק חדש\\פרסום שיווק\\04 פרסום ממומן - מוקאפים לאתרים\\לפרסום ממומן';

export interface StudioSettings {
  /** Root folder for approved PNG exports. One sub-folder per group is created inside. */
  exportRoot: string;
  /** Extra directories the app may write to (the data dir is always allowed). */
  extraAllowedDirs: string[];
  /** 1 = 1080×1350, 2 = 2160×2700 */
  exportScale: 1 | 2;
  wsPort: number;
  /** 6-digit pairing code typed once into the Figma plugin. */
  pairingToken: string;
  figmaFileKey: string;
  /** Playwright browser channel ("msedge" on Windows uses the installed Edge). Empty = bundled Chromium. */
  browserChannel: string;
  scanConcurrency: number;
  maxPageHeight: number;
}

const KEY = 'studio.settings';

export function defaultSettings(platform: NodeJS.Platform = process.platform): StudioSettings {
  return {
    exportRoot: DEFAULT_EXPORT_ROOT,
    extraAllowedDirs: [],
    exportScale: 1,
    wsPort: DEFAULT_WS_PORT,
    pairingToken: String(randomInt(100000, 999999)),
    figmaFileKey: 'RMkG52OlYjXQ30TjFOIzmQ',
    browserChannel: platform === 'win32' ? 'msedge' : '',
    scanConcurrency: 2,
    maxPageHeight: 6000,
  };
}

export function loadSettings(db: Db): StudioSettings {
  const raw = db.getSetting(KEY);
  const defaults = defaultSettings();
  if (!raw) {
    db.setSetting(KEY, JSON.stringify(defaults));
    return defaults;
  }
  return { ...defaults, ...(JSON.parse(raw) as Partial<StudioSettings>) };
}

export function saveSettings(db: Db, s: StudioSettings) {
  db.setSetting(KEY, JSON.stringify(s));
}
