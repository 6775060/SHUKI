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
