/**
 * Builders for the two dynamic text fields. They produce plain text plus style "roles"
 * per range. The Figma plugin maps each role to the exact font/size/fill sampled from the
 * template, so the original typography is preserved and no style is hard-coded here.
 */
import type { MockupContent } from './types.js';

/** Headline roles map to template lines: line1=Black, line2=Regular, line3=Bold (sampled). */
export type HeadlineRole = 'line1' | 'line2' | 'line3';
/** Credit roles map to the template's label style (Demi-bold) and value style (Regular). */
export type CreditRole = 'label' | 'value';

export interface StyledRun<R extends string> {
  text: string;
  role: R;
}

export interface StyledText<R extends string> {
  runs: StyledRun<R>[];
}

export const plainText = <R extends string>(t: StyledText<R>): string => t.runs.map((r) => r.text).join('');

/** Joins Hebrew list items: "א", "א וב", "א, ב וג". The conjunction ו attaches to the last item. */
export function joinHebrewList(items: string[]): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  const last = clean[clean.length - 1]!;
  return `${clean.slice(0, -1).join(', ')} ו${last}`;
}

export function buildHeadline(c: Pick<MockupContent, 'siteType' | 'projectName' | 'fonts'>): StyledText<HeadlineRole> {
  if (c.fonts.length === 0) throw new Error('buildHeadline: at least one font is required');
  const type = c.siteType?.trim();
  const line1 = `גם באתר ${type ? type + ' ' : ''}"${c.projectName.trim()}"`;
  const fontPhrase = c.fonts.length === 1 ? `בפונט ${c.fonts[0]!.trim()}` : `בפונטים ${joinHebrewList(c.fonts)}`;
  return {
    runs: [
      { text: line1 + '\n', role: 'line1' },
      { text: `משתמשים ${fontPhrase}\n`, role: 'line2' },
      { text: 'מבית פונטשוק', role: 'line3' },
    ],
  };
}

export function buildCredits(
  c: Pick<MockupContent, 'fonts' | 'designer' | 'developer' | 'projectTitle' | 'displayUrl'>,
): StyledText<CreditRole> {
  const runs: StyledRun<CreditRole>[] = [];
  const line = (label: string, value: string) => {
    if (runs.length) runs.push({ text: '\n', role: 'value' });
    runs.push({ text: `${label}: `, role: 'label' });
    runs.push({ text: value.trim(), role: 'value' });
  };
  line('פונטים', c.fonts.map((f) => f.trim()).join(', '));
  if (c.designer?.trim()) line('עיצוב אתר', c.designer);
  if (c.developer?.trim()) line('פיתוח', c.developer);
  line('פרויקט', c.projectTitle);
  runs.push({ text: '\n', role: 'value' });
  runs.push({ text: c.displayUrl.trim(), role: 'value' });
  return { runs };
}

/** "https://www.Example.co.il/path?q" -> "example.co.il" */
export function canonicalDomain(url: string): string {
  const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  return u.hostname.toLowerCase().replace(/^www\./, '');
}

/** Display form used on the mockup: "www.example.co.il" */
export function displayUrl(url: string): string {
  return `www.${canonicalDomain(url)}`;
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  u.hash = '';
  return u.toString();
}
