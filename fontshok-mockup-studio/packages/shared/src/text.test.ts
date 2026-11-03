import { describe, expect, it } from 'vitest';
import { buildCredits, buildHeadline, canonicalDomain, displayUrl, joinHebrewList, normalizeUrl, plainText } from './text.js';
import { contrastRatio, hexToRgb, rgbToHex } from './color.js';
import { decodeBlob, encodeBlob } from './protocol.js';

describe('Hebrew text builders', () => {
  it('joins lists with the attached ו', () => {
    expect(joinHebrewList(['האנגר'])).toBe('האנגר');
    expect(joinHebrewList(['האנגר', 'דיסקברי'])).toBe('האנגר ודיסקברי');
    expect(joinHebrewList(['א', 'ב', 'ג'])).toBe('א, ב וג');
  });

  it('reproduces the existing headline wording (single font)', () => {
    const h = buildHeadline({ siteType: 'הסטודיו', projectName: 'Zinka', fonts: ['פומפאי בלוק'] });
    expect(plainText(h)).toBe('גם באתר הסטודיו "Zinka"\nמשתמשים בפונט פומפאי בלוק\nמבית פונטשוק');
    expect(h.runs.map((r) => r.role)).toEqual(['line1', 'line2', 'line3']);
  });

  it('reproduces the existing headline wording (two fonts, no site type)', () => {
    expect(plainText(buildHeadline({ siteType: null, projectName: 'קראפט', fonts: ['האנגר', 'דיסקברי'] }))).toBe(
      'גם באתר "קראפט"\nמשתמשים בפונטים האנגר ודיסקברי\nמבית פונטשוק',
    );
  });

  it('builds credits with label/value roles and omits an unknown designer', () => {
    const c = buildCredits({ fonts: ['דיסקברי'], designer: 'עדן ג׳רמון', developer: null, projectTitle: 'קונטריל', displayUrl: 'www.contreal.io' });
    expect(plainText(c)).toBe('פונטים: דיסקברי\nעיצוב אתר: עדן ג׳רמון\nפרויקט: קונטריל\nwww.contreal.io');
    expect(c.runs.filter((r) => r.role === 'label').map((r) => r.text)).toEqual(['פונטים: ', 'עיצוב אתר: ', 'פרויקט: ']);
    const noDesigner = buildCredits({ fonts: ['האנגר', 'טאלנט'], designer: null, developer: null, projectTitle: 'חברת ניסור בטון', displayUrl: 'www.x.com' });
    expect(plainText(noDesigner)).not.toContain('עיצוב');
    expect(plainText(noDesigner)).toContain('פונטים: האנגר, טאלנט');
  });

  it('normalises URLs and domains', () => {
    expect(canonicalDomain('https://www.Zinkadesigns.com/about?x=1')).toBe('zinkadesigns.com');
    expect(canonicalDomain('contreal.io')).toBe('contreal.io');
    expect(displayUrl('https://contreal.io')).toBe('www.contreal.io');
    expect(normalizeUrl('caramello.co.il#top')).toBe('https://caramello.co.il/');
  });
});

describe('colour + protocol helpers', () => {
  it('round-trips hex colours', () => {
    expect(rgbToHex(hexToRgb('#F89E38'))).toBe('#F89E38');
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 })).toBeCloseTo(21, 0);
  });
  it('encodes and decodes binary frames', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const out = decodeBlob(encodeBlob(id, new Uint8Array([1, 2, 3])));
    expect(out.blobId).toBe(id);
    expect([...out.data]).toEqual([1, 2, 3]);
  });
});
