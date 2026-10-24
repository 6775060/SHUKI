import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_TYPES, isVariableFont } from '../src/fonts.js';

// A minimal sfnt header listing the given table tags.
function sfnt(tags: string[]): Buffer {
  const b = Buffer.alloc(12 + tags.length * 16);
  b.writeUInt32BE(0x00010000, 0);
  b.writeUInt16BE(tags.length, 4);
  tags.forEach((t, i) => b.write(t, 12 + i * 16, 'latin1'));
  return b;
}

describe('font checks', () => {
  it('recognizes a variable TTF by its fvar table', () => {
    const v = sfnt(['GDEF', 'fvar', 'glyf', 'gvar']);
    expect(FONT_TYPES.ttf(v)).toBe(true);
    expect(isVariableFont(v, 'ttf', 'MyFont.ttf')).toBe(true);
    expect(isVariableFont(sfnt(['GDEF', 'glyf']), 'ttf', 'MyFont-Variable.ttf')).toBe(false); // tables win over the name
  });

  it('treats a static font as static', () => {
    const f = '/usr/share/fonts/opentype/inter/Inter-Regular.otf';
    if (!fs.existsSync(f)) return;
    const b = fs.readFileSync(f);
    expect(FONT_TYPES.otf(b)).toBe(true);
    expect(isVariableFont(b, 'otf', 'Inter-Regular.otf')).toBe(false);
  });

  it('falls back to the file name for WOFF2', () => {
    const b = Buffer.from('wOF2xxxxxxxxxxxx', 'latin1');
    expect(isVariableFont(b, 'woff2', 'Discovery-Variable.woff2')).toBe(true);
    expect(isVariableFont(b, 'woff2', 'heebo-hebrew-wght-normal.woff2')).toBe(true);
    expect(isVariableFont(b, 'woff2', 'Discovery-Bold.woff2')).toBe(false);
  });

  it('rejects files that are not fonts', () => {
    expect(FONT_TYPES.ttf(Buffer.from('date,amount\n1,2'))).toBe(false);
  });
});
