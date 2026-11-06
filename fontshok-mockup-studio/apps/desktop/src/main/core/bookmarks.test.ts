import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '@fontshok/db';
import { bookmarkFolderUrls, defaultBrowserRoots, listBookmarkFolders, type BrowserRoot } from './bookmarks.js';
import { Studio, type BridgeLike } from './studio.js';

const url = (id: string, u: string) => ({ id, type: 'url', name: u, url: u });
function fixture(): BrowserRoot[] {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-'));
  mkdirSync(join(dir, 'Default'));
  mkdirSync(join(dir, 'Profile 1'));
  mkdirSync(join(dir, 'Crashpad'));
  writeFileSync(join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'אישי' }, 'Profile 1': { name: 'עבודה' } } } }));
  writeFileSync(
    join(dir, 'Default', 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          id: '1', type: 'folder', name: 'Bookmarks bar',
          children: [
            url('5', 'https://news.example.com/'),
            {
              id: '10', type: 'folder', name: 'אתרים לפרסום',
              children: [
                url('11', 'https://www.studio-a.co.il/'),
                url('12', 'https://studio-b.com/about'),
                url('13', 'chrome://settings'),
                url('14', 'https://www.studio-a.co.il/'),
                { id: '20', type: 'folder', name: 'בדיקה', children: [url('21', 'https://studio-c.co.il')] },
              ],
            },
            { id: '30', type: 'folder', name: 'ריק', children: [url('31', 'javascript:void(0)')] },
          ],
        },
        other: { id: '2', type: 'folder', name: 'Other', children: [] },
      },
    }),
  );
  writeFileSync(join(dir, 'Profile 1', 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { id: '1', type: 'folder', children: [url('7', 'https://work.example.org')] } } }));
  return [{ browser: 'Chrome', dir }, { browser: 'Edge', dir: join(dir, 'missing') }];
}

describe('browser bookmarks', () => {
  it('lists folders with web addresses across profiles, with profile names', () => {
    const f = listBookmarkFolders(fixture());
    expect(f.map((x) => `${x.profile}:${x.path.join('/')}:${x.directCount}/${x.totalCount}`)).toEqual([
      'אישי:סרגל הסימניות:1/5',
      'אישי:סרגל הסימניות/אתרים לפרסום:3/4',
      'אישי:סרגל הסימניות/אתרים לפרסום/בדיקה:1/1',
      'עבודה:סרגל הסימניות:1/1',
    ]);
  });
  it('returns the URLs of a folder, with or without subfolders, skipping non-web links and repeats', () => {
    const roots = fixture();
    expect(bookmarkFolderUrls(roots, 'Chrome|Default|10', false)).toEqual(['https://www.studio-a.co.il/', 'https://studio-b.com/about']);
    expect(bookmarkFolderUrls(roots, 'Chrome|Default|10', true)).toEqual(['https://www.studio-a.co.il/', 'https://studio-b.com/about', 'https://studio-c.co.il']);
    expect(() => bookmarkFolderUrls(roots, 'Chrome|Default|999', true)).toThrow(/not found/);
  });
  it('never modifies the bookmarks file', () => {
    const roots = fixture();
    const file = join(roots[0]!.dir, 'Default', 'Bookmarks');
    const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
    listBookmarkFolders(roots);
    bookmarkFolderUrls(roots, 'Chrome|Default|10', true);
    expect([readFileSync(file, 'utf8'), statSync(file).mtimeMs]).toEqual(before);
  });
  it('knows where Chrome and Edge keep their data on Windows', () => {
    expect(defaultBrowserRoots({ LOCALAPPDATA: 'C:\\Users\\1\\AppData\\Local' }, 'win32').map((r) => r.browser)).toEqual(['Chrome', 'Edge']);
  });
  it('imports a folder into the sites list, skipping sites already added', () => {
    const root = mkdtempSync(join(tmpdir(), 'bm-studio-'));
    const db = new Db(join(root, 'db.sqlite'));
    const bridge = { status: () => ({ listening: false, connected: false, plugin: null }), request: async () => { throw new Error(); }, takeBlob: () => new Uint8Array(), on: () => undefined } as unknown as BridgeLike;
    const studio = new Studio({ db, dataDir: root, bridge, capturer: { capture: async () => { throw new Error(); } }, browserRoots: fixture() });
    studio.addSites(['studio-b.com']);
    const r = studio.importBookmarkFolder('Chrome|Default|10', true);
    expect(r.found).toBe(3);
    expect(r.added.map((s) => s.canonicalDomain).sort()).toEqual(['studio-a.co.il', 'studio-c.co.il']);
    expect(r.duplicates).toEqual(['https://studio-b.com/about']);
    db.close();
  });
});
