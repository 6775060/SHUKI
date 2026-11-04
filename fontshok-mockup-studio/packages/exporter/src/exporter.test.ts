import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsGuard, groupFolderName, mockupFileName, sanitizeSegment, writeExport, validateMockup } from './index.js';
import type { TemplateInfo } from '@fontshok/shared';

describe('naming', () => {
  it('builds "Font - Project - Designer.png"', () => {
    expect(mockupFileName('דיסקברי', 'קונטריל', 'עדן ג׳רמון')).toBe('דיסקברי - קונטריל - עדן ג׳רמון.png');
    expect(mockupFileName('האנגר', 'ניסור בטון', null)).toBe('האנגר - ניסור בטון - ללא קרדיט.png');
  });
  it('removes characters Windows forbids and bidi marks', () => {
    expect(sanitizeSegment('גרינפלד&רפפורט: "GR" / סוכנות?')).toBe('גרינפלד&רפפורט ״GR״ סוכנות');
    expect(sanitizeSegment('\u200fZinka\u202a.')).toBe('Zinka');
    expect(sanitizeSegment('CON')).toBe('_CON');
  });
  it('names the group folder', () => {
    expect(groupFolderName(new Date('2026-11-02T10:00:00Z'), 1, ['דיסקברי', 'טאלנט', 'האנגר', 'נוסטלה'])).toBe('2026-11-02 קבוצה 001 - דיסקברי, טאלנט, האנגר, נוסטלה');
  });
});

describe('FsGuard', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fsguard-'));
    mkdirSync(join(root, 'allowed'));
    mkdirSync(join(root, 'other'));
  });
  it('allows paths inside configured directories only', () => {
    const g = new FsGuard([join(root, 'allowed')]);
    expect(g.isAllowed(join(root, 'allowed', 'a', 'b.png'))).toBe(true);
    expect(g.isAllowed(join(root, 'allowed-evil', 'x.png'))).toBe(false);
    expect(g.isAllowed(join(root, 'allowed', '..', 'other', 'x.png'))).toBe(false);
    expect(() => g.assert(join(root, 'other', 'x.png'))).toThrow(/outside allowed/);
    expect(() => g.assert('relative/path.png')).toThrow();
  });
  it('ignores invalid configured roots instead of crashing', () => {
    const g = new FsGuard(['D:\\not-absolute-on-linux', join(root, 'allowed')], 'linux');
    expect(g.rejectedRoots).toEqual(['D:\\not-absolute-on-linux']);
    expect(() => new FsGuard(['relative'], 'linux')).toThrow(/no valid/);
  });
  it('resolves symlinks that escape the allowed directory', () => {
    symlinkSync(join(root, 'other'), join(root, 'allowed', 'link'));
    const g = new FsGuard([join(root, 'allowed')]);
    expect(g.isAllowed(join(root, 'allowed', 'link', 'x.png'))).toBe(false);
  });
  it('treats Windows paths case-insensitively', () => {
    const g = new FsGuard(['D:\\Exports'], 'win32');
    expect(g.isAllowed('d:\\exports\\קבוצה\\a.png')).toBe(true);
    expect(g.isAllowed('D:\\Exports2\\a.png')).toBe(false);
  });
});

describe('writeExport', () => {
  it('writes atomically, skips identical files and never overwrites different ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'export-'));
    const g = new FsGuard([root]);
    const folder = join(root, '2026-11-02 קבוצה 001 - א');
    const a = await writeExport(g, folder, 'דיסקברי - קונטריל - עדן.png', new Uint8Array([1, 2, 3]));
    expect(a.kind).toBe('written');
    const again = await writeExport(g, folder, 'דיסקברי - קונטריל - עדן.png', new Uint8Array([1, 2, 3]));
    expect(again.kind).toBe('identical-exists');
    const diff = await writeExport(g, folder, 'דיסקברי - קונטריל - עדן.png', new Uint8Array([9]));
    expect(diff.path.endsWith('דיסקברי - קונטריל - עדן (2).png')).toBe(true);
    expect(readdirSync(folder).sort()).toEqual(['דיסקברי - קונטריל - עדן (2).png', 'דיסקברי - קונטריל - עדן.png']);
    await expect(writeExport(g, join(tmpdir(), 'elsewhere'), 'x.png', new Uint8Array([1]))).rejects.toThrow(/outside allowed/);
    writeFileSync(join(folder, 'keep.txt'), 'x');
  });
});

describe('validateMockup', () => {
  const template: TemplateInfo = {
    nodeId: '1:1', name: 'tpl/single/v1', variant: 'single', version: 1, width: 1080, height: 1350, fingerprint: 'fp',
    fields: [
      { field: '@headline', nodeId: 'h', type: 'TEXT', x: 206, y: 67, width: 669, height: 174 },
      { field: '@credits', nodeId: 'c', type: 'TEXT', x: 618, y: 1119, width: 381, height: 156 },
      { field: '@shot.main', nodeId: 's', type: 'RECTANGLE', x: 41, y: 305, width: 998, height: 635 },
    ],
  };
  const base = {
    content: { siteType: 'חברת', projectName: 'GR', projectTitle: 'סוכנות פרסום GR', fonts: ['נוסטלה'], designer: 'גרינפלד&רפפורט', developer: null, displayUrl: 'www.greenfeld-rapaport.co.il', brandColor: { r: 0, g: 0.05, b: 1 } },
    confirmed: { fonts: true, projectName: true, designer: true as const },
    template,
    build: { warnings: [], measurements: { '@headline': { x: 206, y: 67, width: 669, height: 174 }, '@credits': { x: 618, y: 1119, width: 381, height: 156 } } },
    mainImageWidth: 1996,
    templateFingerprintNow: 'fp',
    templateFingerprintExpected: 'fp',
    alreadyExported: false,
    siteDomain: 'greenfeld-rapaport.co.il',
    group: { primaryFontIds: [1, 2, 3, 4], size: 4 },
    primaryFontId: 1,
  };
  it('passes a correct mockup', () => {
    expect(validateMockup(base).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('blocks unconfirmed credits, overflow, template change and duplicates', () => {
    const codes = validateMockup({
      ...base,
      confirmed: { fonts: true, projectName: true, designer: false },
      build: { warnings: [], measurements: { ...base.build.measurements, '@headline': { x: 10, y: 67, width: 1060, height: 240 } } },
      templateFingerprintNow: 'changed',
      alreadyExported: true,
      group: { primaryFontIds: [1, 1, 3, 4], size: 4 },
    })
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DESIGNER_UNCONFIRMED', 'TEXT_OVERFLOW', 'TEXT_OUT_OF_FRAME', 'TEMPLATE_CHANGED', 'ALREADY_EXPORTED', 'GROUP_FONTS_NOT_DISTINCT']));
  });
});
