import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import type { IncomingTxn } from './ingest.js';

// Fallback for when a scraper is broken: the Excel/CSV exports banks and card
// companies offer. Formats differ, so the header row is detected by keywords.

type Cell = string | number | Date | null;

export interface ParsedFile {
  headers: string[];
  mapping: ColumnMapping;
  txns: IncomingTxn[];
  skipped: number;
}

export interface ColumnMapping {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  installments?: number;
}

const DATE_HEADERS = ['תאריך עסקה', 'תאריך רכישה', 'תאריך', 'date'];
const DESC_HEADERS = ['שם בית העסק', 'שם בית עסק', 'בית עסק', 'תיאור', 'הפעולה', 'פרטים', 'תאור', 'description'];
const AMOUNT_HEADERS = ['סכום חיוב', 'סכום החיוב', 'סכום בש"ח', 'סכום', 'amount'];
const DEBIT_HEADERS = ['חובה', 'בחובה', 'חיוב'];
const CREDIT_HEADERS = ['זכות', 'בזכות'];
const INSTALLMENT_HEADERS = ['תשלום', 'פירוט נוסף', 'הערות'];

function clean(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/[‎‏‪-‮]/g, '').trim();
}

function findCol(headers: string[], candidates: string[], exclude: number[] = []): number | undefined {
  for (const c of candidates) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && h.toLowerCase().includes(c.toLowerCase()));
    if (i !== -1) return i;
  }
  return undefined;
}

export function detectMapping(headers: string[]): ColumnMapping | null {
  const date = findCol(headers, DATE_HEADERS);
  if (date === undefined) return null;
  const description = findCol(headers, DESC_HEADERS, [date]);
  if (description === undefined) return null;
  const used = [date, description];
  const debit = findCol(headers.map((h) => (h.length <= 12 ? h : '')), DEBIT_HEADERS, used);
  const credit = findCol(headers.map((h) => (h.length <= 12 ? h : '')), CREDIT_HEADERS, used);
  if (debit !== undefined && credit !== undefined) return { date, description, debit, credit };
  const amount = findCol(headers, AMOUNT_HEADERS, used);
  if (amount === undefined) return null;
  const installments = findCol(headers, INSTALLMENT_HEADERS, [...used, amount]);
  return { date, description, amount, installments };
}

export function parseDate(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseAmount(v: Cell): number | null {
  if (typeof v === 'number') return v;
  let s = clean(v).replace(/[^\d.,()-]/g, '');
  if (!s) return null;
  const negative = /^-|-$|^\(.*\)$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  // "1,234.50" → 1234.50 ; "1.234,50" → 1234.50
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function parseInstallments(v: Cell): { number: number; total: number } | undefined {
  const m = clean(v).match(/(\d+)\s*(?:מתוך|מ-|\/)\s*(\d+)/);
  if (!m) return undefined;
  return { number: Number(m[1]), total: Number(m[2]) };
}

function parseHtmlTable(html: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map((td) =>
      td
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim(),
    );
    rows.push(cells);
  }
  return rows;
}

async function readRows(filename: string, buf: Buffer): Promise<Cell[][]> {
  const lower = filename.toLowerCase();
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  // Several Israeli banks export "xls" files that are really HTML tables.
  if (head.startsWith('<')) return parseHtmlTable(buf.toString('utf8'));
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const rows: Cell[][] = [];
    wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
          if (o.richText) return o.richText.map((r) => r.text).join('');
          return (o.result ?? o.text ?? null) as Cell;
        }
        return (v ?? null) as Cell;
      });
      rows.push(values);
    });
    return rows;
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    let text = buf.toString('utf8');
    if (text.includes('�')) text = new TextDecoder('windows-1255').decode(buf);
    const delimiter = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    // relax_quotes: Hebrew abbreviations like מע"מ use a bare double quote.
    return parseCsv(text.replace(/^﻿/, ''), { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as Cell[][];
  }
  throw new Error('UNSUPPORTED_FORMAT');
}

export async function parseStatement(
  filename: string,
  buf: Buffer,
  accountKind: 'bank' | 'card' | 'cash',
): Promise<ParsedFile> {
  const rows = await readRows(filename, buf);
  let headerIdx = -1;
  let mapping: ColumnMapping | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    mapping = detectMapping(rows[i].map(clean));
    if (mapping) {
      headerIdx = i;
      break;
    }
  }
  if (!mapping) throw new Error('HEADER_NOT_FOUND');

  const txns: IncomingTxn[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    const date = parseDate(row[mapping.date] ?? null);
    const description = clean(row[mapping.description] ?? null);
    let amount: number | null;
    if (mapping.amount !== undefined) {
      amount = parseAmount(row[mapping.amount] ?? null);
      // Card statements list charges as positive numbers.
      if (amount !== null && accountKind === 'card') amount = -amount;
    } else {
      const debit = parseAmount(row[mapping.debit!] ?? null) ?? 0;
      const credit = parseAmount(row[mapping.credit!] ?? null) ?? 0;
      amount = credit - Math.abs(debit);
    }
    if (!date || !description || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const inst = mapping.installments !== undefined ? parseInstallments(row[mapping.installments] ?? null) : undefined;
    txns.push({
      date,
      amount: Math.round(amount * 100) / 100,
      description,
      installmentNumber: inst?.number,
      installmentTotal: inst?.total,
    });
  }
  return { headers: rows[headerIdx].map(clean), mapping, txns, skipped };
}
