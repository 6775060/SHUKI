/// <reference lib="dom" />
/**
 * Website capture with Playwright: full-page screenshot at 2x, HTML snapshot, font observations,
 * text boxes (for crop scoring) and footer credits input.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AppError } from '@fontshok/shared';
import type { FontObservations, FontUsage } from './fonts.js';
import type { PageLink } from './credits.js';

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  family: string;
  fontSize: number;
  chars: number;
  tag: string;
}

export interface CaptureOptions {
  outDir: string;
  viewportWidth?: number; // CSS px
  viewportHeight?: number;
  deviceScaleFactor?: number;
  /** Full-page captures are capped at this many CSS px. */
  maxPageHeight?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface CaptureResult {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  meta: { ogSiteName: string | null; applicationName: string | null; generator: string | null; description: string | null };
  fullScreenshotPath: string;
  fullScreenshotSha256: string;
  /** Size of the screenshot in device px. */
  width: number;
  height: number;
  deviceScaleFactor: number;
  htmlPath: string;
  fonts: FontObservations;
  textBoxes: TextBox[];
  footerText: string;
  links: PageLink[];
  dismissedConsent: string | null;
  durationMs: number;
}

const CONSENT_TEXTS = [
  'אישור', 'אני מסכים', 'מסכים', 'מאשר', 'קבל', 'הבנתי', 'סגור', 'אשר הכל', 'קבל הכל',
  'Accept', 'Accept all', 'Accept All', 'Allow all', 'I agree', 'Agree', 'Got it', 'OK', 'Close',
];

async function dismissConsent(page: Page): Promise<string | null> {
  for (const text of CONSENT_TEXTS) {
    const btn = page.getByRole('button', { name: text, exact: true }).first();
    try {
      if (await btn.isVisible({ timeout: 150 })) {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(400);
        return text;
      }
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function autoScroll(page: Page, maxHeight: number) {
  await page.evaluate(async (limit) => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < Math.min(document.body.scrollHeight, limit); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  }, maxHeight);
}

/** Runs inside the page. Must be self-contained. */
function collectInPage() {
  const clean = (f: string) => f.replace(/["']/g, '').trim();
  const loadedFaces: { family: string; weight: string; style: string }[] = [];
  document.fonts.forEach((f) => {
    if (f.status === 'loaded') loadedFaces.push({ family: clean(f.family), weight: f.weight, style: f.style });
  });
  const loadedSet = new Set(loadedFaces.map((f) => f.family.toLowerCase()));
  const fontFiles = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(n));

  const usage = new Map<string, { chars: number; weightedChars: number; maxFontSize: number; sampleText: string; sampleSelector: string }>();
  const boxes: { x: number; y: number; w: number; h: number; family: string; fontSize: number; chars: number; tag: string }[] = [];
  const selectorOf = (el: Element) => {
    const parts: string[] = [];
    let e: Element | null = el;
    while (e && parts.length < 4 && e !== document.body) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : e.classList[0] ? `.${e.classList[0]}` : ''));
      e = e.parentElement;
    }
    return parts.join(' > ');
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const perElement = new Map<Element, number>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    perElement.set(el, (perElement.get(el) ?? 0) + text.length);
  }
  for (const [el, chars] of perElement) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const stack = cs.fontFamily.split(',').map(clean);
    // first family in the stack that is actually loaded; otherwise the first declared family
    const family = stack.find((f) => loadedSet.has(f.toLowerCase())) ?? stack[0] ?? '';
    const fontSize = parseFloat(cs.fontSize) || 16;
    const u = usage.get(family) ?? { chars: 0, weightedChars: 0, maxFontSize: 0, sampleText: '', sampleSelector: '' };
    u.chars += chars;
    u.weightedChars += chars * Math.min(6, fontSize / 16);
    if (fontSize > u.maxFontSize) {
      u.maxFontSize = fontSize;
      u.sampleText = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      u.sampleSelector = selectorOf(el);
    }
    usage.set(family, u);
    boxes.push({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, family, fontSize, chars, tag: el.tagName.toLowerCase() });
  }

  const footer = document.querySelector('footer, [role=contentinfo], #footer, .footer, .site-footer') ?? null;
  const footerText = (footer as HTMLElement | null)?.innerText ?? document.body.innerText.slice(-1500);
  const scope = footer ?? document.body;
  const links = Array.from(scope.querySelectorAll('a[href]')).map((a) => {
    const block = a.closest('p, li, div, span, section') ?? a.parentElement;
    return { text: (a as HTMLElement).innerText.trim(), href: (a as HTMLAnchorElement).href, context: ((block as HTMLElement | null)?.innerText ?? '').slice(0, 300) };
  }).filter((l) => l.text);

  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? null;
  return {
    title: document.title,
    meta: {
      ogSiteName: meta('meta[property="og:site_name"]'),
      applicationName: meta('meta[name="application-name"]'),
      generator: meta('meta[name="generator"]'),
      description: meta('meta[name="description"]'),
    },
    fonts: {
      loadedFaces,
      fontFiles: Array.from(new Set(fontFiles)),
      usage: Array.from(usage.entries()).map(([family, u]) => ({ family, ...u })),
    },
    boxes,
    footerText,
    links,
    pageHeight: document.documentElement.scrollHeight,
  };
}

export class SiteCapturer {
  private browser: Browser | null = null;

  /**
   * @param launch.channel  "msedge" / "chrome" uses the browser already installed on Windows,
   *                        so the installer does not need to ship Chromium.
   */
  constructor(private readonly launch: { executablePath?: string; channel?: string } = {}) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        ...(this.launch.executablePath ? { executablePath: this.launch.executablePath } : {}),
        ...(this.launch.channel ? { channel: this.launch.channel } : {}),
      });
    }
    return this.browser;
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  async capture(url: string, opts: CaptureOptions): Promise<CaptureResult> {
    const started = Date.now();
    const dpr = opts.deviceScaleFactor ?? 2;
    const maxH = opts.maxPageHeight ?? 6000;
    await mkdir(opts.outDir, { recursive: true });
    const browser = await this.getBrowser();
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({
        viewport: { width: opts.viewportWidth ?? 1440, height: opts.viewportHeight ?? 900 },
        deviceScaleFactor: dpr,
        reducedMotion: 'reduce',
        locale: 'he-IL',
        ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
      });
      const page = await context.newPage();
      const timeout = opts.timeoutMs ?? 45000;
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch((e: Error) => {
        throw new AppError('NETWORK', `could not open ${url}: ${e.message}`);
      });
      if (resp && resp.status() >= 400) throw new AppError('NETWORK', `HTTP ${resp.status()} for ${url}`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
      const dismissed = await dismissConsent(page);
      await autoScroll(page, maxH);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // stop CSS animations so the capture is deterministic
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.waitForTimeout(300);

      const data = await page.evaluate(collectInPage);
      const pageHeight = Math.min(data.pageHeight, maxH);
      // clip is relative to the full page when fullPage is true, so long pages are capped at maxH
      const shot = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width: opts.viewportWidth ?? 1440, height: pageHeight },
        type: 'png',
      });
      const sha = createHash('sha256').update(shot).digest('hex');
      const shotPath = join(opts.outDir, `full-${sha.slice(0, 12)}.png`);
      await writeFile(shotPath, shot);
      const html = await page.content();
      const htmlPath = join(opts.outDir, `page-${sha.slice(0, 12)}.html`);
      await writeFile(htmlPath, html, 'utf8');

      const cssW = opts.viewportWidth ?? 1440;
      return {
        requestedUrl: url,
        finalUrl: page.url(),
        title: data.title,
        meta: data.meta,
        fullScreenshotPath: shotPath,
        fullScreenshotSha256: sha,
        width: cssW * dpr,
        height: Math.round(pageHeight * dpr),
        deviceScaleFactor: dpr,
        htmlPath,
        fonts: data.fonts as FontObservations & { usage: FontUsage[] },
        textBoxes: data.boxes.filter((b) => b.y < pageHeight),
        footerText: data.footerText,
        links: data.links,
        dismissedConsent: dismissed,
        durationMs: Date.now() - started,
      };
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}
