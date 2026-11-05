// Font file checks for the user's own font.

export const FONT_TYPES: Record<string, (b: Buffer) => boolean> = {
  woff2: (b) => b.subarray(0, 4).toString('latin1') === 'wOF2',
  woff: (b) => b.subarray(0, 4).toString('latin1') === 'wOFF',
  ttf: (b) => b.readUInt32BE(0) === 0x00010000 || b.subarray(0, 4).toString('latin1') === 'true',
  otf: (b) => b.subarray(0, 4).toString('latin1') === 'OTTO',
};

// A variable font carries an 'fvar' table (with a weight axis it covers
// every weight from one file). TTF/OTF/WOFF list their tables in the clear;
// WOFF2 compresses the directory, so fall back to the usual naming.
export function isVariableFont(buf: Buffer, ext: string, filename: string): boolean {
  const tags: string[] = [];
  if (ext === 'ttf' || ext === 'otf') {
    const n = buf.readUInt16BE(4);
    for (let i = 0; i < n && 12 + i * 16 + 4 <= buf.length; i++) tags.push(buf.subarray(12 + i * 16, 16 + i * 16).toString('latin1'));
  } else if (ext === 'woff') {
    const n = buf.readUInt16BE(12);
    for (let i = 0; i < n && 44 + i * 20 + 4 <= buf.length; i++) tags.push(buf.subarray(44 + i * 20, 48 + i * 20).toString('latin1'));
  }
  if (tags.length) return tags.includes('fvar');
  return /variable|\bvf\b|wght|-vf\b/i.test(filename);
}

// The weight axis range of a variable TTF/OTF ("100 800"), so CSS asks only
// for weights the font really has.
export function weightRange(buf: Buffer, ext: string): [number, number] | null {
  if (ext !== 'ttf' && ext !== 'otf') return null;
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length || buf.toString('latin1', rec, rec + 4) !== 'fvar') continue;
    const fvar = buf.readUInt32BE(rec + 8);
    const axesOffset = buf.readUInt16BE(fvar + 4);
    const axisCount = buf.readUInt16BE(fvar + 8);
    const axisSize = buf.readUInt16BE(fvar + 10);
    for (let a = 0; a < axisCount; a++) {
      const ax = fvar + axesOffset + a * axisSize;
      if (buf.toString('latin1', ax, ax + 4) === 'wght') return [buf.readInt32BE(ax + 4) / 65536, buf.readInt32BE(ax + 12) / 65536];
    }
  }
  return null;
}
