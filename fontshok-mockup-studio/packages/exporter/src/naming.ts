/**
 * Folder and file naming.
 *   folder: "2026-11-02 קבוצה 001 - דיסקברי, טאלנט, האנגר, נוסטלה"
 *   file:   "Font Name - Project Name - Designer Name.png"
 */
export const NO_CREDIT = 'ללא קרדיט';
const MAX_SEGMENT = 80;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Removes characters that are illegal in Windows file names and normalises whitespace. Keeps Hebrew geresh/gershayim. */
export function sanitizeSegment(input: string): string {
  let s = input
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '') // control + bidi marks
    .replace(/"/g, '״') // straight double quote is illegal on Windows → Hebrew gershayim
    .replace(/[<>:/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).trim();
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  return s;
}

export function mockupFileName(fontName: string, projectName: string, designer: string | null): string {
  const parts = [fontName, projectName, designer?.trim() ? designer : NO_CREDIT].map(sanitizeSegment);
  if (parts.some((p) => !p)) throw new Error('file name segment is empty after sanitising');
  return `${parts.join(' - ')}.png`;
}

export function groupFolderName(date: Date, groupNumber: number, fontNames: string[]): string {
  const ymd = date.toISOString().slice(0, 10);
  const fonts = sanitizeSegment(fontNames.join(', '));
  return sanitizeSegment(`${ymd} קבוצה ${String(groupNumber).padStart(3, '0')} - ${fonts}`);
}

/** "same site + same font + same template version" may be exported only once. */
export function dedupeKey(siteDomain: string, fontId: number, templateName: string): string {
  return `${siteDomain.toLowerCase()}|${fontId}|${templateName}`;
}

/** Windows MAX_PATH guard. Returns the extended-length form when needed. */
export function toLongPath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || p.length < 240 || p.startsWith('\\\\?\\')) return p;
  return `\\\\?\\${p}`;
}
