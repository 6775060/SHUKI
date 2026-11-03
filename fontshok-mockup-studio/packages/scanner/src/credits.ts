/**
 * Deterministic credit extraction. Works on text + links already pulled out of the page.
 * Returns findings with the exact snippet as evidence. Never invents a name: if no label is found,
 * nothing is returned and the UI shows "לא ידוע".
 */
import type { FindingDraft } from '@fontshok/shared';

export interface PageLink {
  text: string;
  href: string;
  /** Text of the closest block containing the link (e.g. footer row). */
  context: string;
}

export interface CreditInput {
  footerText: string;
  links: PageLink[];
  pageUrl: string;
}

interface LabelRule {
  field: 'designer' | 'developer';
  re: RegExp;
  /** When a single label covers both design and development. */
  both?: boolean;
}

// Order matters: combined labels first.
const LABELS: LabelRule[] = [
  { field: 'designer', both: true, re: /(עיצוב\s*(?:ו|&)\s*(?:פיתוח|בניי?ת\s*אתרים|בנייה)|design\s*(?:&|and|\+)\s*develop(?:ment|ed)(?:\s*by)?)/i },
  { field: 'designer', both: true, re: /(נבנה\s*(?:ע["״']?\s*י|על\s*ידי)|בניי?ת\s*(?:ה?אתר|אתרים)(?:\s*(?:ע["״']?\s*י|על\s*ידי|:))?|website\s*by|site\s*by|built\s*by|made\s*by|created\s*by|crafted\s*by)/i },
  { field: 'designer', re: /(עיצוב\s*(?:ה?אתר|גרפי|UI|UX)?|designed\s*by|design\s*by|design:|art\s*direction)/i },
  { field: 'developer', re: /(פיתוח(?:\s*(?:ה?אתר|ותכנות))?|תכנות|developed\s*by|development(?:\s*by)?|dev\s*by|code\s*by)/i },
];

/** Platform/CMS credits that are not designers. */
const NOT_A_DESIGNER = /^(wordpress|wix|shopify|elementor|webflow|squarespace|joomla|drupal|magento|godaddy|bigcommerce|tilda|framer|google|cloudflare|wp\s*engine)$/i;

const SEPARATORS = /\s*(?:\||•|·|–|—|©|\n|\r|\s-\s|,\s*כל\s*הזכויות|all\s*rights)\s*/i;

function cleanValue(v: string): string {
  return v
    .replace(/^[\s:\-–—|"'״׳]+/, '')
    .replace(/[\s.,:;|"'״׳]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function plausibleName(v: string): boolean {
  if (v.length < 2 || v.length > 60) return false;
  if (NOT_A_DESIGNER.test(v)) return false;
  if (/^(by|ע["״']?י|על ידי)$/i.test(v)) return false;
  // must contain at least one letter
  return /\p{L}/u.test(v);
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function extractCredits(input: CreditInput): FindingDraft[] {
  const out: FindingDraft[] = [];
  const seen = new Set<string>();
  const pageHost = hostOf(input.pageUrl);
  const push = (d: FindingDraft) => {
    const key = `${d.field}|${d.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };

  // 1) Links whose surrounding text carries a credit label (strongest evidence).
  for (const link of input.links) {
    const linkHost = hostOf(link.href);
    if (!linkHost || linkHost === pageHost) continue;
    const ctx = link.context.replace(/\s+/g, ' ');
    const idx = ctx.indexOf(link.text.trim());
    const before = idx >= 0 ? ctx.slice(Math.max(0, idx - 60), idx) : ctx;
    for (const rule of LABELS) {
      const m = rule.re.exec(before);
      if (!m) continue;
      const value = cleanValue(link.text);
      if (!plausibleName(value)) break;
      const evidence = { source: 'footer link next to a credit label', snippet: ctx.slice(0, 200), url: link.href, extra: { label: m[1] } };
      push({ field: rule.field, value, method: 'link', confidence: 0.85, evidence });
      if (rule.both) push({ field: 'developer', value, method: 'link', confidence: 0.8, evidence });
      break;
    }
  }

  // 2) Plain text "label: value" in the footer. A line may hold several credits
  //    ("Designed by X · Development: Y"), so it is split into segments first.
  const lines = input.footerText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const segments = line.split(/\s*(?:\||•|·|–|—|\s-\s)\s*/).map((x) => x.trim()).filter(Boolean);
    for (const seg of segments) {
      for (const rule of LABELS) {
        const m = rule.re.exec(seg);
        if (!m) continue;
        const rest = seg.slice(m.index + m[0].length);
        const value = cleanValue(rest.split(SEPARATORS)[0] ?? '');
        if (!plausibleName(value)) continue;
        const evidence = { source: 'footer text', snippet: line.slice(0, 200), extra: { label: m[1] } };
        push({ field: rule.field, value, method: 'footer-text', confidence: 0.7, evidence });
        if (rule.both) push({ field: 'developer', value, method: 'footer-text', confidence: 0.65, evidence });
        break;
      }
    }
  }
  return out;
}

/** Project name candidates from metadata. Low confidence unless og:site_name. */
export function extractProjectName(meta: { ogSiteName: string | null; title: string; applicationName: string | null }): FindingDraft[] {
  const out: FindingDraft[] = [];
  if (meta.ogSiteName?.trim()) {
    out.push({ field: 'project_name', value: meta.ogSiteName.trim(), method: 'meta', confidence: 0.8, evidence: { source: 'og:site_name', snippet: meta.ogSiteName } });
  }
  if (meta.applicationName?.trim()) {
    out.push({ field: 'project_name', value: meta.applicationName.trim(), method: 'meta', confidence: 0.7, evidence: { source: 'application-name', snippet: meta.applicationName } });
  }
  const title = meta.title.trim();
  if (title) {
    const parts = title.split(/\s+[|\-–—:]\s+/).map((p) => p.trim()).filter(Boolean);
    const candidate = parts.length > 1 ? parts.reduce((a, b) => (b.length < a.length ? b : a)) : parts[0]!;
    out.push({ field: 'project_name', value: candidate, method: 'title', confidence: parts.length > 1 ? 0.5 : 0.4, evidence: { source: '<title>', snippet: title } });
  }
  return out;
}
