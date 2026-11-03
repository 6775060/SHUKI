import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '@fontshok/db';
import { Studio, type BridgeLike } from './studio.js';
import { FONTSHOK_FIXTURE } from '../../../../../test/fixtures/fontshokSite.js';

const bridge = {
  status: () => ({ listening: false, connected: false, plugin: null }),
  request: async () => { throw new Error('no figma'); },
  takeBlob: () => new Uint8Array(),
  on: () => undefined,
} as unknown as BridgeLike;

function makeStudio(pages: Record<string, string>, fetched: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'site-import-'));
  const db = new Db(join(root, 'db.sqlite'));
  const studio = new Studio({
    db, dataDir: root, bridge, capturer: { capture: async () => { throw new Error('unused'); } },
    fontshokSiteUrl: 'https://fontshok.co.il/',
    fetchText: async (url) => {
      fetched.push(url);
      const body = pages[new URL(url).pathname];
      if (body === undefined) throw new Error(`HTTP 404 for ${url}`);
      return body;
    },
  });
  return { studio, db };
}

describe('importFontsFromSite', () => {
  it('fills an empty catalogue from the site and is idempotent', async () => {
    const fetched: string[] = [];
    const { studio, db } = makeStudio(FONTSHOK_FIXTURE, fetched);
    const r = await studio.importFontsFromSite();
    expect(r.fontsOnSite).toBe(5);
    expect(r.added).toHaveLength(5);
    expect(r.errors).toEqual([]);
    expect(r.unassigned).toEqual([]);
    const disc = studio.listFonts().find((f) => f.slug === 'discovery')!;
    expect(disc.aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(['PortoFs', 'SdPorto', 'פורטו']));
    expect(fetched.every((u) => u.startsWith('https://fontshok.co.il/'))).toBe(true);
    const kiss = studio.listFonts().find((f) => f.slug === 'kissufim')!;
    expect(kiss.nameHe).toBe('כיסופים');
    expect(kiss.aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(['כיסופים', 'Kissufim', 'KissofinFS', 'KissufimFS']));

    const again = await studio.importFontsFromSite();
    expect(again.added).toEqual([]);
    expect(again.updated).toHaveLength(5);
    expect(again.aliasesAdded).toBe(0);
    expect(db.listAudit().some((a) => a.action === 'font.importSite')).toBe(true);
    db.close();
  });

  it('keeps manual entries, reports fonts no longer on the site and page failures', async () => {
    const pages = { ...FONTSHOK_FIXTURE };
    delete pages['/font/hangar/'];
    const { studio, db } = makeStudio(pages);
    studio.addFont('ישן', 'Old', ['old-fs']);
    const r = await studio.importFontsFromSite();
    expect(r.missingFromSite).toEqual(['ישן']);
    expect(r.errors.join()).toMatch(/האנגר: .*404/);
    // the font is still added from the menu, just without technical names
    expect(studio.listFonts().find((f) => f.slug === 'hangar')?.aliases.map((a) => a.alias)).toEqual(['האנגר']);
    expect(studio.listFonts().find((f) => f.nameHe === 'ישן')?.active).toBe(true);
    db.close();
  });

  it('refuses a page without a fonts menu', async () => {
    const { studio, db } = makeStudio({ '/': '<html><body>maintenance</body></html>' });
    await expect(studio.importFontsFromSite()).rejects.toThrow(/no fonts found/);
    db.close();
  });
});
