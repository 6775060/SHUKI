import { describe, expect, it } from 'vitest';
import { buildSiteCatalog, fontFileBase, parseFontMenu, parseFontPage } from './fontshokSite.js';
import { FontMatcher } from './matcher.js';
import { FONTSHOK_FIXTURE } from '../../../test/fixtures/fontshokSite.js';

const menu = parseFontMenu(FONTSHOK_FIXTURE['/']!);
const pages = menu.map((m) => parseFontPage(m.slug, FONTSHOK_FIXTURE[new URL(m.url).pathname]!));
const catalog = buildSiteCatalog(menu, pages);
const font = (slug: string) => catalog.fonts.find((f) => f.slug === slug)!;
const aliases = (slug: string) => font(slug).aliases.map((a) => a.alias).sort();

describe('FontShok site catalogue', () => {
  it('reads the fonts menu once per font, ignoring non-font links', () => {
    expect(menu.map((m) => `${m.slug}:${m.nameHe}`)).toEqual(['discovery:דיסקברי', 'sprinter:ספרינטר', 'pompei-block:פומפאי בלוק', 'kissufim:כיסופים', 'hangar:האנגר']);
  });
  it('reads the English name from the page title', () => {
    expect(catalog.fonts.map((f) => f.nameEn)).toEqual(['Discovery', 'Sprinter', 'Pompei Block', 'Kissufim', 'Hangar']);
  });
  it('strips weights and styles from font file names', () => {
    expect(fontFileBase('Discovery_Fs-Demibold-3.woff')).toBe('Discovery_Fs');
    expect(fontFileBase('SdHangar-Crunchy')).toBe('SdHangar');
  });
  it('attributes technical names to the right font only', () => {
    expect(aliases('discovery')).toEqual(['Discovery_Fs', 'PortoFs', 'SdPorto', 'פורטו']);
    expect(aliases('sprinter')).toEqual(['Sprinter']);
    // Pompei_Block also appears on the Sprinter page but belongs to Pompei Block
    expect(aliases('pompei-block')).toEqual(['Pompei_Block']);
    expect(aliases('hangar')).toEqual(['SdHangar']);
  });
  it('accepts a near spelling that appears only on that font page, marked as typo', () => {
    expect(font('kissufim').aliases).toEqual(expect.arrayContaining([{ alias: 'KissofinFS', kind: 'typo' }, { alias: 'KissufimFS', kind: 'file-name' }]));
  });
  it('attributes former names to the current font, even when found on another font page', () => {
    expect(font('discovery').aliases).toEqual(expect.arrayContaining([{ alias: 'PortoFs', kind: 'css-family' }, { alias: 'פורטו', kind: 'former-name' }]));
    expect(aliases('hangar')).not.toContain('PortoFs');
  });
  it('never attributes an unrelated name, it is returned for review', () => {
    expect(catalog.unassigned).toEqual([]);
    const withoutFormer = buildSiteCatalog(menu, pages, {});
    expect(withoutFormer.unassigned).toEqual([{ slug: 'hangar', name: 'PortoFs' }, { slug: 'hangar', name: 'SdPorto' }]);
  });
  it('the resulting catalogue matches the names sites actually use', () => {
    const m = new FontMatcher(
      catalog.fonts.map((f, i) => ({ id: i + 1, nameHe: f.nameHe, nameEn: f.nameEn, slug: f.slug, active: true, aliases: f.aliases.map((a, j) => ({ id: j, familyId: i + 1, alias: a.alias, kind: a.kind })) })),
    );
    expect(m.match('KissofinFS-Bold')?.family.slug).toBe('kissufim');
    expect(m.match('SdHangar')?.family.slug).toBe('hangar');
    expect(m.match('Pompei_Block_FS-Black.woff2')?.family.slug).toBe('pompei-block');
    expect(m.match('PortoFs')?.family.slug).toBe('discovery');
    expect(m.match('Porto FS Bold')?.family.slug).toBe('discovery');
    expect(m.match('SomethingElse')).toBeNull();
  });
});
