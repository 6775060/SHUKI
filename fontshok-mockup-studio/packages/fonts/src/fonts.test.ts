import { describe, expect, it } from 'vitest';
import type { FontFamily } from '@fontshok/shared';
import { FontMatcher, isGenericFamily, normalizeFontKey, parseCatalogCsv } from './index.js';

const fam = (id: number, nameHe: string, nameEn: string, aliases: string[] = []): FontFamily => ({
  id,
  nameHe,
  nameEn,
  slug: nameEn.toLowerCase(),
  active: true,
  aliases: aliases.map((alias, i) => ({ id: id * 100 + i, familyId: id, alias, kind: 'css-family' })),
});

const catalogue = [
  fam(1, 'דיסקברי', 'Discovery', ['FS Discovery']),
  fam(2, 'פומפאי בלוק', 'Pompei Block', ['pompei-block-fs']),
  fam(3, 'פומפאי צר', 'Pompei Narrow'),
  fam(4, 'טאלנט', 'Talent'),
  fam(5, 'האנגר', 'Hangar'),
];

describe('normalizeFontKey', () => {
  it.each([
    ['pompei-block-fs', 'pompei block'],
    ['"FS Discovery"', 'discovery'],
    ['https://cdn.site.com/fonts/Sprinter_FS-Black.woff2?v=3', 'sprinter'],
    ['HangarFS-Bold', 'hangar'],
    ['Talent 700', 'talent'],
  ])('%s → %s', (input, out) => expect(normalizeFontKey(input)).toBe(out));

  it('flags generic and icon families', () => {
    expect(isGenericFamily('sans-serif')).toBe(true);
    expect(isGenericFamily('Font Awesome 6 Free')).toBe(true);
    expect(isGenericFamily('eicons')).toBe(true);
    expect(isGenericFamily('Discovery')).toBe(false);
  });
});

describe('FontMatcher', () => {
  const m = new FontMatcher(catalogue);
  it('matches CSS families, file names and Hebrew names exactly', () => {
    expect(m.match('pompei-block-fs')?.family.id).toBe(2);
    expect(m.match('FS Discovery')?.family.id).toBe(1);
    expect(m.match('discovery-webfont')?.family.id).toBe(1);
    expect(m.match('/fonts/HangarFS-Regular.woff2')?.family.id).toBe(5);
    expect(m.match('טאלנט')?.family.id).toBe(4);
  });
  it('allows single-typo fuzzy matches with low confidence only', () => {
    const r = m.match('Discovry');
    expect(r?.family.id).toBe(1);
    expect(r?.kind).toBe('fuzzy');
    expect(r!.confidence).toBeLessThan(0.9);
  });
  it('never matches generic or unknown fonts', () => {
    expect(m.match('Arial')).toBeNull();
    expect(m.match('Heebo')).toBeNull();
    expect(m.match('Rubik')).toBeNull();
  });
  it('refuses ambiguous aliases', () => {
    const amb = new FontMatcher([fam(1, 'א', 'Alpha', ['shared-name']), fam(2, 'ב', 'Beta', ['shared-name'])]);
    expect(amb.match('shared-name')).toBeNull();
    expect(amb.conflicts()).toContain('shared name');
  });
});

describe('catalogue CSV', () => {
  it('parses quoted cells, BOM and aliases', () => {
    const csv = '﻿name_he,name_en,aliases\r\nדיסקברי,Discovery,"FS Discovery|discovery-fs"\nטאלנט,,\n,Bad,\n';
    const { rows, errors } = parseCatalogCsv(csv);
    expect(rows).toEqual([
      { nameHe: 'דיסקברי', nameEn: 'Discovery', aliases: ['FS Discovery', 'discovery-fs'] },
      { nameHe: 'טאלנט', nameEn: null, aliases: [] },
    ]);
    expect(errors).toHaveLength(1);
  });
});
