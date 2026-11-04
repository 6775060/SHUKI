import { describe, expect, it } from 'vitest';
import { extractCredits, extractProjectName } from './credits.js';
import { fontFindings } from './fonts.js';
import { FontMatcher } from '@fontshok/fonts';

describe('extractCredits', () => {
  const page = 'https://www.zinkadesigns.com/';

  it('reads a Hebrew label followed by an external link', () => {
    const r = extractCredits({
      pageUrl: page,
      footerText: 'כל הזכויות שמורות © Zinka | עיצוב ופיתוח: סטודיו לדוגמה',
      links: [{ text: 'סטודיו לדוגמה', href: 'https://example-studio.co.il/', context: 'כל הזכויות שמורות © Zinka | עיצוב ופיתוח: סטודיו לדוגמה' }],
    });
    const designer = r.find((f) => f.field === 'designer' && f.method === 'link');
    expect(designer?.value).toBe('סטודיו לדוגמה');
    expect(designer?.evidence.url).toBe('https://example-studio.co.il/');
    expect(r.some((f) => f.field === 'developer')).toBe(true);
  });

  it('reads English "Designed by" text and separate development credit', () => {
    const r = extractCredits({ pageUrl: page, footerText: '© 2025 Craftad\nDesigned by Dap Agency · Development: Moshe Code', links: [] });
    expect(r.find((f) => f.field === 'designer')?.value).toBe('Dap Agency');
    expect(r.find((f) => f.field === 'developer')?.value).toBe('Moshe Code');
  });

  it('ignores CMS/platform credits and internal links', () => {
    const r = extractCredits({
      pageUrl: page,
      footerText: 'Website by WordPress',
      links: [{ text: 'Zinka', href: 'https://zinkadesigns.com/about', context: 'Website by Zinka' }],
    });
    expect(r).toHaveLength(0);
  });

  it('returns nothing (never guesses) when there is no credit label', () => {
    expect(extractCredits({ pageUrl: page, footerText: 'כל הזכויות שמורות © 2025 ניסור בטון תל אביב', links: [] })).toEqual([]);
  });
});

describe('extractProjectName', () => {
  it('prefers og:site_name and keeps the title as a low-confidence candidate', () => {
    const r = extractProjectName({ ogSiteName: 'Caramello', title: 'מתכונים | Caramello', applicationName: null });
    expect(r[0]).toMatchObject({ value: 'Caramello', method: 'meta' });
    expect(r.find((f) => f.method === 'title')!.confidence).toBeLessThan(0.6);
  });
});

describe('fontFindings', () => {
  const matcher = new FontMatcher([
    { id: 1, nameHe: 'דיסקברי', nameEn: 'Discovery', slug: 'discovery', active: true, aliases: [{ id: 1, familyId: 1, alias: 'FS Discovery', kind: 'css-family' }] },
    { id: 2, nameHe: 'פומפאי בלוק', nameEn: 'Pompei Block', slug: 'pompei-block', active: true, aliases: [] },
  ]);
  it('ranks visible usage with loaded faces above downloaded-but-unused files', () => {
    const r = fontFindings(
      {
        loadedFaces: [{ family: 'FS Discovery', weight: '400', style: 'normal' }],
        fontFiles: ['https://x.com/fonts/pompei-block-fs.woff2'],
        usage: [
          { family: 'FS Discovery', chars: 400, weightedChars: 900, maxFontSize: 64, sampleText: 'כותרת', sampleSelector: 'h1' },
          { family: 'Arial', chars: 50, weightedChars: 50, maxFontSize: 14, sampleText: 'x', sampleSelector: 'p' },
        ],
      },
      matcher,
    );
    expect(r.map((f) => [f.value, f.method])).toEqual([
      ['דיסקברי', 'computed-style'],
      ['פומפאי בלוק', 'font-face'],
    ]);
    expect(r[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r[1]!.confidence).toBeLessThan(0.9);
    expect(r[0]!.evidence.snippet).toBe('כותרת');
  });
});
