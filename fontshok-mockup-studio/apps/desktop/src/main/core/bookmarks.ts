/**
 * Read-only access to browser bookmarks (Chrome / Edge, every profile).
 * Chromium keeps bookmarks in "<User Data>/<Profile>/Bookmarks" (JSON) and profile display names
 * in "<User Data>/Local State". Nothing is ever written to those files.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BrowserRoot {
  browser: string;
  /** the "User Data" directory */
  dir: string;
}

export interface BookmarkFolder {
  /** stable id: "<browser>|<profileDir>|<chromium folder id>" */
  id: string;
  browser: string;
  profile: string;
  /** folder names from the root, e.g. ["סרגל הסימניות", "אתרים לפרסום"] */
  path: string[];
  /** URLs directly in this folder */
  directCount: number;
  /** URLs in this folder and all its subfolders */
  totalCount: number;
}

interface Node {
  id?: string;
  type?: 'folder' | 'url';
  name?: string;
  url?: string;
  children?: Node[];
}

const ROOT_NAMES: Record<string, string> = { bookmark_bar: 'סרגל הסימניות', other: 'סימניות אחרות', synced: 'סימניות בנייד' };

export function defaultBrowserRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): BrowserRoot[] {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    if (!local) return [];
    return [
      { browser: 'Chrome', dir: join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'Edge', dir: join(local, 'Microsoft', 'Edge', 'User Data') },
    ];
  }
  const home = env.HOME ?? '';
  if (platform === 'darwin') {
    return [
      { browser: 'Chrome', dir: join(home, 'Library', 'Application Support', 'Google', 'Chrome') },
      { browser: 'Edge', dir: join(home, 'Library', 'Application Support', 'Microsoft Edge') },
    ];
  }
  return [
    { browser: 'Chrome', dir: join(home, '.config', 'google-chrome') },
    { browser: 'Edge', dir: join(home, '.config', 'microsoft-edge') },
  ];
}

const isWebUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

function profiles(root: BrowserRoot): { dir: string; name: string }[] {
  if (!existsSync(root.dir)) return [];
  let names: Record<string, { name?: string }> = {};
  try {
    names = (JSON.parse(readFileSync(join(root.dir, 'Local State'), 'utf8')) as { profile?: { info_cache?: Record<string, { name?: string }> } }).profile?.info_cache ?? {};
  } catch {
    /* no Local State: fall back to directory names */
  }
  return readdirSync(root.dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root.dir, d.name, 'Bookmarks')))
    .map((d) => ({ dir: d.name, name: names[d.name]?.name || d.name }));
}

function readTree(root: BrowserRoot, profileDir: string): Record<string, Node> {
  const json = JSON.parse(readFileSync(join(root.dir, profileDir, 'Bookmarks'), 'utf8')) as { roots?: Record<string, Node> };
  return json.roots ?? {};
}

function count(n: Node): number {
  return (n.children ?? []).reduce((acc, c) => acc + (c.type === 'url' ? (isWebUrl(c.url) ? 1 : 0) : count(c)), 0);
}

/** Every bookmark folder that contains at least one web address (directly or in subfolders). */
export function listBookmarkFolders(roots: BrowserRoot[]): BookmarkFolder[] {
  const out: BookmarkFolder[] = [];
  for (const root of roots) {
    for (const p of profiles(root)) {
      let tree: Record<string, Node>;
      try {
        tree = readTree(root, p.dir);
      } catch {
        continue;
      }
      const walk = (n: Node, path: string[]) => {
        const totalCount = count(n);
        if (totalCount === 0) return;
        const directCount = (n.children ?? []).filter((c) => c.type === 'url' && isWebUrl(c.url)).length;
        out.push({ id: `${root.browser}|${p.dir}|${n.id ?? path.join('/')}`, browser: root.browser, profile: p.name, path, directCount, totalCount });
        for (const c of n.children ?? []) if (c.type === 'folder') walk(c, [...path, c.name ?? '']);
      };
      for (const [key, node] of Object.entries(tree)) if (node && typeof node === 'object' && node.children) walk(node, [ROOT_NAMES[key] ?? node.name ?? key]);
    }
  }
  return out;
}

/** URLs of one folder (optionally with its subfolders), in bookmark order, without duplicates. */
export function bookmarkFolderUrls(roots: BrowserRoot[], folderId: string, includeSubfolders: boolean): string[] {
  const [browser, profileDir, nodeId] = folderId.split('|');
  const root = roots.find((r) => r.browser === browser);
  if (!root || !profileDir || !nodeId) throw new Error(`unknown bookmark folder: ${folderId}`);
  const tree = readTree(root, profileDir);
  const find = (n: Node): Node | null => (n.id === nodeId ? n : (n.children ?? []).reduce<Node | null>((hit, c) => hit ?? (c.type === 'folder' ? find(c) : null), null));
  const folder = Object.values(tree).reduce<Node | null>((hit, n) => hit ?? (n?.children ? find(n) : null), null);
  if (!folder) throw new Error('bookmark folder not found (was it deleted?)');
  const urls: string[] = [];
  const collect = (n: Node) => {
    for (const c of n.children ?? []) {
      if (c.type === 'url' && isWebUrl(c.url)) urls.push(c.url);
      else if (c.type === 'folder' && includeSubfolders) collect(c);
    }
  };
  collect(folder);
  return [...new Set(urls)];
}
