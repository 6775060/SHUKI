/**
 * Builds the font catalogue from the FontShok website itself (fontshok.co.il):
 *   1. the fonts menu on the home page gives the Hebrew name and the slug of every font;
 *   2. each font page gives the English name (<title>) and the technical names the font is
 *      served under (@font-face family names and font file names), which are exactly the names
 *      other sites use when they embed the font.
 *
 * Pure functions only (HTML in, data out). Fetching lives in the app.
 * Never guesses: a technical name is attached to a font only when it contains the font's name,
 * or when it appears on that font's page alone and is spelled almost like it (e.g. "KissofinFS"
 * on the Kissufim page). Anything else is returned as "unassigned" for manual review.
 */
import { levenshtein, normalizeFontKey } from './normalize.js';

export const FONTSHOK_SITE_URL = 'https://fontshok.co.il/';

export interface SiteMenuFont {
  slug: string;
  nameHe: string;
  url: string;
}

export interface SiteFontPage {
  slug: string;
  nameEn: string | null;
  /** font-family names declared in @font-face rules on the page */
  families: string[];
  /** font file base names without weight/extension, e.g. "Pompei_Block_FS" */
  fileBases: string[];
}

export interface SiteCatalogFont {
  slug: string;
  nameHe: string;
  nameEn: string | null;
  url: string;
  aliases: { alias: string; kind: 'css-family' | 'file-name' | 'typo' | 'former-name' }[];
}

export interface SiteCatalog {
  fonts: SiteCatalogFont[];
  /** Technical names found on a font page that could not be attributed with certainty. */
  unassigned: { slug: string; name: string }[];
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Reads the fonts menu: links to /font/<slug>/ inside menu items. Falls back to any /font/ link. */
export function parseFontMenu(html: string, baseUrl = FONTSHOK_SITE_URL): SiteMenuFont[] {
  const out = new Map<string, SiteMenuFont>();
  const collect = (re: RegExp) => {
    for (const m of html.matchAll(re)) {
      const href = decode(m[1]!);
      let url: URL;
      try {
        url = new URL(href, baseUrl);
      } catch {
        continue;
      }
      const slug = /^\/font\/([^/]+)\/?$/.exec(url.pathname)?.[1];
      const name = stripTags(m[2]!);
      if (!slug || !name || name.length > 40 || !/\p{L}/u.test(name)) continue;
      const key = decodeURIComponent(slug).toLowerCase();
      if (!out.has(key)) out.set(key, { slug: key, nameHe: name, url: url.href });
    }
  };
  collect(/<li[^>]*menu-item[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
  if (out.size === 0) collect(/<a[^>]*href="([^"]*\/font\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g);
  return [...out.values()];
}

/** "Discovery_Fs-Demibold-3" -> "Discovery_Fs", "SdHangar-Crunchy" -> "SdHangar" (the family part precedes the first "-"). */
export function fontFileBase(fileName: string): string {
  const s = fileName.replace(/\.(woff2?|ttf|otf|eot)$/i, '');
  return s.split('-')[0] ?? s;
}

export function parseFontPage(slug: string, html: string): SiteFontPage {
  const families = new Set<string>();
  for (const m of html.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*['"]?([^;'"}]+)['"]?/g)) {
    const f = m[1]!.trim();
    if (f) families.add(f);
  }
  const fileBases = new Set<string>();
  for (const m of html.matchAll(/\/([\w\-%]+)\.(?:woff2?|ttf|otf)\b/g)) fileBases.add(fontFileBase(decodeURIComponent(m[1]!)));
  // <title>פונט דיסקברי Discovery – סנס סריף גאומטרי בעברית | פונטשוק</title>
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const nameEn = /([A-Za-z][A-Za-z0-9 ]*[A-Za-z0-9])\s*[–\-|]/.exec(title)?.[1]?.trim() ?? null;
  return { slug, nameEn, families: [...families], fileBases: [...fileBases] };
}

const compact = (s: string) => normalizeFontKey(s).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Former names of FontShok fonts, confirmed by FontShok. Sites built before a rename still embed
 * the old name, and it may still appear on the FontShok site itself (e.g. "PortoFs" on the Hangar page).
 */
export const FONTSHOK_FORMER_NAMES: Record<string, { en: string[]; he: string[] }> = {
  discovery: { en: ['Porto'], he: ['פורטו'] },
};

type AliasKind = SiteCatalogFont['aliases'][number]['kind'];

/** Builds the catalogue, attributing technical names to fonts only when it is certain. */
export function buildSiteCatalog(menu: SiteMenuFont[], pages: SiteFontPage[], formerNames = FONTSHOK_FORMER_NAMES): SiteCatalog {
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));
  // On how many font pages does each technical name appear? (site-wide UI fonts appear on all)
  const seenOn = new Map<string, Set<string>>();
  for (const p of pages) for (const n of [...p.families, ...p.fileBases]) {
    const k = compact(n);
    if (!k) continue;
    if (!seenOn.has(k)) seenOn.set(k, new Set());
    seenOn.get(k)!.add(p.slug);
  }
  const keysOf = (f: SiteMenuFont) => {
    const page = pageBySlug.get(f.slug);
    return [compact(f.slug), page?.nameEn ? compact(page.nameEn) : ''].filter((k) => k.length >= 3);
  };
  const allKeys = menu.map((f) => ({ slug: f.slug, keys: [...keysOf(f), ...(formerNames[f.slug]?.en ?? []).map(compact)] }));

  /** Which font does this name contain? Longest match wins ("pompeiblock" over "pompei"). */
  const containing = (k: string) => {
    let best: { slug: string; len: number } | null = null;
    for (const f of allKeys) for (const key of f.keys) if (k.includes(key) && (!best || key.length > best.len)) best = { slug: f.slug, len: key.length };
    return best?.slug ?? null;
  };

  // one alias per comparable key and font, keeping the shortest spelling ("Nostela" rather than "Nostela_VF")
  const bySlug = new Map(menu.map((f) => [f.slug, new Map<string, SiteCatalogFont['aliases'][number]>()]));
  const push = (slug: string, alias: string, kind: AliasKind) => {
    const k = compact(alias);
    const map = bySlug.get(slug)!;
    const prev = map.get(k);
    if (k && (!prev || alias.length < prev.alias.length)) map.set(k, { alias, kind });
  };
  const unassigned: SiteCatalog['unassigned'] = [];
  for (const f of menu) {
    const page = pageBySlug.get(f.slug);
    if (!page) continue;
    const candidates: [string, AliasKind][] = [
      ...page.families.map((n) => [n, 'css-family'] as [string, AliasKind]),
      ...page.fileBases.map((n) => [n, 'file-name'] as [string, AliasKind]),
    ];
    for (const [name, kind] of candidates) {
      const k = compact(name);
      if (!k) continue;
      const owner = containing(k);
      if (owner) {
        push(owner, name, kind); // may belong to another font (site UI fonts, former names)
        continue;
      }
      const onlyHere = seenOn.get(k)?.size === 1;
      const close = keysOf(f).some((key) => {
        const core = k.slice(0, Math.max(key.length, 1));
        return key.length >= 5 && levenshtein(core, key) <= 2 && k.length - key.length <= 4;
      });
      if (onlyHere && close) push(f.slug, name, 'typo');
      else if (onlyHere) unassigned.push({ slug: f.slug, name });
    }
  }
  const fonts: SiteCatalogFont[] = menu.map((f) => {
    const former = formerNames[f.slug];
    const aliases = [...bySlug.get(f.slug)!.values()];
    for (const en of former?.en ?? []) if (!aliases.some((a) => compact(a.alias) === compact(en))) aliases.push({ alias: en, kind: 'former-name' });
    for (const he of former?.he ?? []) aliases.push({ alias: he, kind: 'former-name' });
    return { slug: f.slug, nameHe: f.nameHe, nameEn: pageBySlug.get(f.slug)?.nameEn ?? null, url: f.url, aliases };
  });
  return { fonts, unassigned };
}
