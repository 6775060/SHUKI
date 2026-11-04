/**
 * CSV import for the FontShok catalogue.
 * Header (UTF-8, comma separated): name_he,name_en,aliases
 * aliases are separated by "|", e.g.  דיסקברי,Discovery,FS Discovery|discovery-fs|דיסקברי FS
 */
export interface CatalogRow {
  nameHe: string;
  nameEn: string | null;
  aliases: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

export function parseCatalogCsv(text: string): { rows: CatalogRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ['empty file'] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const iHe = header.indexOf('name_he');
  const iEn = header.indexOf('name_en');
  const iAl = header.indexOf('aliases');
  if (iHe < 0) return { rows: [], errors: ['missing column name_he'] };
  const rows: CatalogRow[] = [];
  table.slice(1).forEach((r, n) => {
    const nameHe = (r[iHe] ?? '').trim();
    if (!nameHe) {
      errors.push(`row ${n + 2}: empty name_he`);
      return;
    }
    const nameEn = iEn >= 0 ? (r[iEn] ?? '').trim() || null : null;
    const aliases = iAl >= 0 ? (r[iAl] ?? '').split('|').map((a) => a.trim()).filter(Boolean) : [];
    rows.push({ nameHe, nameEn, aliases });
  });
  return { rows, errors };
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
