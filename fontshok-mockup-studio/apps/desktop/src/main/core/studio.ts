/**
 * Studio: orchestration of the whole production flow. No Electron imports, so it is testable in Node.
 *
 *   addSites → scanSites (Playwright) → review findings (user confirms) → proposeGroups (4 × distinct fonts)
 *   → buildGroup (crop + Figma build + preview + validation) → approveMockup (user) → exportGroup (PNG)
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Db } from '@fontshok/db';
import {
  AppError,
  buildCredits,
  buildHeadline,
  canonicalDomain,
  displayUrl,
  hexToRgb,
  normalizeUrl,
  toAppError,
  type BuildRequest,
  type BuildResult,
  type Finding,
  type FindingDraft,
  type FindingField,
  type FindingStatus,
  type AliasKind,
  type FontFamily,
  type ImageResult,
  type InventoryItem,
  type MockupContent,
  type Site,
  type TemplateInfo,
  type TemplateRecord,
} from '@fontshok/shared';
import { AUTO_CONFIRM_THRESHOLD, FONTSHOK_SITE_URL, FontMatcher, buildSiteCatalog, parseCatalogCsv, parseFontMenu, parseFontPage, slugify, type SiteFontPage } from '@fontshok/fonts';
import { extractCredits, extractProjectName, fontFindings, type CaptureOptions, type CaptureResult, type TextBox } from '@fontshok/scanner';
import { planCrops, prepareSlotImage, sampleBrandColor, thumbnailDataUrl, type ScoredBox } from '@fontshok/imaging';
import { buildGroups, GROUP_SIZE } from '@fontshok/grouping';
import { FsGuard, dedupeKey, groupFolderName, mockupFileName, validateMockup, writeExport } from '@fontshok/exporter';
import type { BridgeStatus } from '@fontshok/figma-bridge';
import type { GroupView, MockupView, SiteDetail, SiteImportReport, SiteSummary, StudioApi, StudioEvent } from '../api.js';
import { loadSettings, saveSettings, type StudioSettings } from './settings.js';
import { bookmarkFolderUrls, defaultBrowserRoots, listBookmarkFolders, type BookmarkFolder, type BrowserRoot } from './bookmarks.js';

export interface BridgeLike {
  status(): BridgeStatus;
  request<T>(type: string, payload: unknown, opts?: { jobId?: string; blobs?: { id: string; data: Uint8Array }[]; timeoutMs?: number }): Promise<T>;
  requestWithRetry<T>(type: string, payload: unknown, opts?: { jobId?: string; blobs?: { id: string; data: Uint8Array }[]; timeoutMs?: number; retries?: number }): Promise<T>;
  takeBlob(blobId: string): Uint8Array;
  on(event: 'connected' | 'disconnected', fn: (...a: unknown[]) => void): unknown;
}

export interface CapturerLike {
  capture(url: string, opts: CaptureOptions): Promise<CaptureResult>;
}

export interface StudioDeps {
  db: Db;
  dataDir: string;
  bridge: BridgeLike;
  capturer: CapturerLike;
  now?: () => Date;
  /** HTTP GET returning the body as text (injected in tests). Defaults to fetch(). */
  fetchText?: (url: string) => Promise<string>;
  /** Base URL of the FontShok site (tests point it at a local server). */
  fontshokSiteUrl?: string;
  /** Browser "User Data" directories to read bookmarks from (tests point them at fixtures). */
  browserRoots?: BrowserRoot[];
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'FontShok-Mockup-Studio/1.0', accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new AppError('NETWORK', `HTTP ${res.status} for ${url}`);
  return res.text();
}

/** What the scanner stored for a scan (enough to re-crop for any template later). */
interface ScanRaw {
  finalUrl: string;
  pageWidthCss: number;
  pageHeightCss: number;
  dpr: number;
  textBoxes: TextBox[];
  targetFamilies: string[];
  meta: CaptureResult['meta'];
  dismissedConsent: string | null;
  durationMs: number;
}

const sha256 = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex');

export class Studio extends EventEmitter implements StudioApi {
  private settings: StudioSettings;
  private guard: FsGuard;
  private readonly scanQueue: number[] = [];
  private activeScans = 0;
  private readonly busyGroups = new Set<number>();

  constructor(private readonly deps: StudioDeps) {
    super();
    this.settings = loadSettings(deps.db);
    this.guard = this.makeGuard();
    this.recoverJobs();
    deps.bridge.on('connected', () => {
      this.emitEvent({ type: 'figma', status: this.deps.bridge.status() });
      void this.reconcileWithFigma().catch((e) => this.emitEvent({ type: 'error', scope: 'figma', message: toAppError(e).message }));
    });
    deps.bridge.on('disconnected', () => this.emitEvent({ type: 'figma', status: this.deps.bridge.status() }));
  }

  private get db() {
    return this.deps.db;
  }
  private now() {
    return this.deps.now?.() ?? new Date();
  }
  private emitEvent(e: StudioEvent) {
    this.emit('event', e);
  }
  private makeGuard() {
    return new FsGuard([this.deps.dataDir, this.settings.exportRoot, ...this.settings.extraAllowedDirs].filter(Boolean));
  }

  // ================================================================ settings
  getSettings(): StudioSettings {
    return { ...this.settings };
  }
  updateSettings(patch: Partial<StudioSettings>): StudioSettings {
    const next = { ...this.settings, ...patch };
    if (next.exportScale !== 1 && next.exportScale !== 2) throw new AppError('INVALID_INPUT', 'exportScale must be 1 or 2');
    this.settings = next;
    this.guard = this.makeGuard();
    saveSettings(this.db, next);
    this.db.audit('user', 'settings.update', patch);
    return this.getSettings();
  }
  regeneratePairingToken(): StudioSettings {
    return this.updateSettings({ pairingToken: String(Math.floor(100000 + Math.random() * 900000)) });
  }
  figmaStatus(): BridgeStatus {
    return this.deps.bridge.status();
  }

  // ================================================================ font catalogue
  listFonts(): FontFamily[] {
    return this.db.listFonts(true);
  }
  addFont(nameHe: string, nameEn: string | null, aliases: string[]): FontFamily[] {
    if (!nameHe.trim()) throw new AppError('INVALID_INPUT', 'Hebrew name is required');
    this.db.tx(() => {
      const id = this.db.upsertFont(nameHe.trim(), nameEn?.trim() || null, slugify(nameEn || nameHe));
      this.db.addAlias(id, nameHe.trim(), 'he');
      if (nameEn?.trim()) this.db.addAlias(id, nameEn.trim(), 'en');
      for (const a of aliases) if (a.trim()) this.db.addAlias(id, a.trim(), 'css-family');
    });
    this.db.audit('user', 'font.add', { nameHe, nameEn, aliases });
    return this.listFonts();
  }
  addAlias(familyId: number, alias: string) {
    const ok = this.db.addAlias(familyId, alias.trim(), 'css-family');
    return { ok, conflict: !ok };
  }
  removeAlias(aliasId: number) {
    this.db.removeAlias(aliasId);
  }
  setFontActive(familyId: number, active: boolean) {
    this.db.setFontActive(familyId, active);
  }
  importCatalogCsv(text: string) {
    const { rows, errors } = parseCatalogCsv(text);
    const conflicts: string[] = [];
    let aliasesAdded = 0;
    this.db.tx(() => {
      for (const r of rows) {
        const id = this.db.upsertFont(r.nameHe, r.nameEn, slugify(r.nameEn || r.nameHe));
        const all: [string, 'he' | 'en' | 'css-family'][] = [[r.nameHe, 'he'], ...(r.nameEn ? ([[r.nameEn, 'en']] as [string, 'en'][]) : []), ...r.aliases.map((a) => [a, 'css-family'] as [string, 'css-family'])];
        for (const [a, kind] of all) {
          if (this.db.addAlias(id, a, kind)) aliasesAdded++;
          else conflicts.push(`${a} (${r.nameHe})`);
        }
      }
    });
    this.db.audit('user', 'font.importCsv', { rows: rows.length, conflicts: conflicts.length });
    return { added: rows.length, aliasesAdded, conflicts, errors };
  }

  async importFontsFromSite(): Promise<SiteImportReport> {
    const base = this.deps.fontshokSiteUrl ?? FONTSHOK_SITE_URL;
    const get = this.deps.fetchText ?? defaultFetchText;
    const origin = new URL(base).origin;
    const menu = parseFontMenu(await get(base), base).filter((f) => new URL(f.url).origin === origin);
    if (menu.length === 0) throw new AppError('PARSE_FAILED', 'no fonts found in the site menu');
    const errors: string[] = [];
    const pages: SiteFontPage[] = [];
    for (let i = 0; i < menu.length; i += 3) {
      const batch = menu.slice(i, i + 3);
      const res = await Promise.allSettled(batch.map(async (f) => parseFontPage(f.slug, await get(f.url))));
      res.forEach((r, j) => (r.status === 'fulfilled' ? pages.push(r.value) : errors.push(`${batch[j]!.nameHe}: ${toAppError(r.reason).message}`)));
    }
    const catalog = buildSiteCatalog(menu, pages);
    const report: SiteImportReport = { fontsOnSite: menu.length, added: [], updated: [], aliasesAdded: 0, conflicts: [], unassigned: [], missingFromSite: [], errors };
    const heBySlug = new Map(catalog.fonts.map((f) => [f.slug, f.nameHe]));
    report.unassigned = catalog.unassigned.map((u) => ({ font: heBySlug.get(u.slug) ?? u.slug, name: u.name }));
    this.db.tx(() => {
      const before = this.db.listFonts(true);
      const known = new Set(before.flatMap((f) => f.aliases.map((a) => `${f.id}:${a.alias.toLowerCase()}`)));
      for (const f of catalog.fonts) {
        try {
          const existing = before.find((b) => b.slug === f.slug) ?? before.find((b) => b.nameHe === f.nameHe);
          const id = existing?.id ?? this.db.upsertFont(f.nameHe, f.nameEn, f.slug);
          (existing ? report.updated : report.added).push(f.nameHe);
          const all: [string, AliasKind][] = [[f.nameHe, 'he'], ...(f.nameEn ? ([[f.nameEn, 'en']] as [string, 'en'][]) : []), ...f.aliases.map((a) => [a.alias, a.kind] as [string, typeof a.kind])];
          for (const [alias, kind] of all) {
            const fresh = !known.has(`${id}:${alias.toLowerCase()}`);
            if (!this.db.addAlias(id, alias, kind)) report.conflicts.push(`${alias} (${f.nameHe})`);
            else if (fresh) report.aliasesAdded++;
          }
        } catch (e) {
          report.errors.push(`${f.nameHe}: ${toAppError(e).message}`);
        }
      }
      const onSite = new Set(catalog.fonts.map((f) => f.slug));
      report.missingFromSite = before.filter((b) => b.active && !onSite.has(b.slug) && !catalog.fonts.some((f) => f.nameHe === b.nameHe)).map((b) => b.nameHe);
    });
    this.db.audit('user', 'font.importSite', { url: base, fonts: menu.length, added: report.added.length, aliasesAdded: report.aliasesAdded, conflicts: report.conflicts.length, errors: errors.length });
    return report;
  }

  // ================================================================ sites
  /** Bookmark folders of Chrome / Edge on this computer (read-only). */
  listBookmarkFolders(): BookmarkFolder[] {
    return listBookmarkFolders(this.deps.browserRoots ?? defaultBrowserRoots());
  }
  /** Adds every site of a bookmark folder (same rules as addSites: duplicates and invalid URLs are skipped). */
  importBookmarkFolder(folderId: string, includeSubfolders: boolean) {
    const urls = bookmarkFolderUrls(this.deps.browserRoots ?? defaultBrowserRoots(), folderId, includeSubfolders);
    const r = this.addSites(urls);
    this.db.audit('user', 'sites.importBookmarks', { folderId, includeSubfolders, found: urls.length, added: r.added.length });
    return { found: urls.length, ...r };
  }
  addSites(urls: string[]) {
    const added: Site[] = [];
    const duplicates: string[] = [];
    const invalid: string[] = [];
    for (const raw of urls.map((u) => u.trim()).filter(Boolean)) {
      let url: string;
      let domain: string;
      try {
        url = normalizeUrl(raw);
        domain = canonicalDomain(url);
        if (!domain.includes('.')) throw new Error('no TLD');
      } catch {
        invalid.push(raw);
        continue;
      }
      if (this.db.findSiteByDomain(domain)) {
        duplicates.push(raw);
        continue;
      }
      added.push(this.db.insertSite(url, domain));
    }
    if (added.length) this.db.audit('user', 'sites.add', { domains: added.map((s) => s.canonicalDomain) });
    this.emitEvent({ type: 'sites-changed' });
    return { added, duplicates, invalid };
  }

  private latestFindings(siteId: number): { scanId: number | null; findings: Finding[] } {
    const scan = this.db.latestScan(siteId);
    return scan ? { scanId: scan.id, findings: this.db.listFindings(scan.id) } : { scanId: null, findings: [] };
  }

  private confirmed(findings: Finding[], field: FindingField): Finding[] {
    return findings.filter((f) => f.field === field && f.status === 'confirmed').sort((a, b) => b.confidence - a.confidence);
  }

  private siteMembership(): Map<number, string> {
    const rows = this.db.raw.prepare('SELECT m.site_id AS s, g.code AS c FROM mockup m JOIN mockup_group g ON g.id=m.group_id').all() as { s: number; c: string }[];
    return new Map(rows.map((r) => [Number(r.s), String(r.c)]));
  }

  listSites(): SiteSummary[] {
    const membership = this.siteMembership();
    const exported = this.db.exportedSiteIds();
    const fonts = new Map(this.db.listFonts(true).map((f) => [f.id, f.nameHe]));
    return this.db.listSites().map((site) => {
      const scan = this.db.latestScan(site.id);
      const findings = scan ? this.db.listFindings(scan.id) : [];
      const confirmedFonts = this.confirmed(findings, 'font').map((f) => fonts.get(f.fontFamilyId ?? -1) ?? f.value);
      const missing: string[] = [];
      if (!scan || scan.status !== 'done') missing.push('סריקה');
      if (confirmedFonts.length === 0) missing.push('פונט מאושר');
      if (!this.projectName(site, findings)) missing.push('שם פרויקט');
      return { site, scan, confirmedFonts, ready: missing.length === 0, missing, inGroup: membership.get(site.id) ?? null, exported: exported.has(site.id) };
    });
  }

  private projectName(site: Site, findings: Finding[]): string | null {
    return site.projectName?.trim() || this.confirmed(findings, 'project_name')[0]?.value || null;
  }

  scanSites(siteIds: number[]) {
    for (const id of siteIds) if (!this.scanQueue.includes(id)) this.scanQueue.push(id);
    this.pumpScans();
  }

  private pumpScans() {
    while (this.activeScans < Math.max(1, this.settings.scanConcurrency) && this.scanQueue.length) {
      const siteId = this.scanQueue.shift()!;
      this.activeScans++;
      void this.runScan(siteId).finally(() => {
        this.activeScans--;
        this.pumpScans();
      });
    }
  }

  /** Public for tests; the UI goes through scanSites(). */
  async runScan(siteId: number): Promise<number> {
    const site = this.db.getSite(siteId);
    const scanId = this.db.createScan(siteId);
    const jobId = `scan-${scanId}`;
    this.db.upsertJob({ id: jobId, kind: 'scan', refId: scanId, state: 'running' });
    this.db.setScanStatus(scanId, 'running');
    this.emitEvent({ type: 'sites-changed' });
    try {
      const outDir = join(this.deps.dataDir, 'scans', String(siteId), String(scanId));
      this.guard.assert(outDir);
      const cap = await this.deps.capturer.capture(site.url, { outDir, maxPageHeight: this.settings.maxPageHeight });
      const fullId = this.db.addScreenshot(scanId, 'full', cap.fullScreenshotPath, cap.width, cap.height, cap.fullScreenshotSha256, null, null);
      void fullId;

      const matcher = new FontMatcher(this.db.listFonts());
      const drafts: FindingDraft[] = [
        ...fontFindings(cap.fonts, matcher),
        ...extractCredits({ footerText: cap.footerText, links: cap.links, pageUrl: cap.finalUrl }),
        ...extractProjectName({ ogSiteName: cap.meta.ogSiteName, title: cap.title, applicationName: cap.meta.applicationName }),
        { field: 'source_url', value: cap.finalUrl, method: 'meta', confidence: 1, evidence: { source: 'final URL after redirects', url: cap.finalUrl, snippet: cap.requestedUrl } },
      ];
      // Brand colour from the top of the page (hero), sampled on a temporary crop.
      const heroH = Math.round((cap.width * 631) / 995);
      const hero = await prepareSlotImage(cap.fullScreenshotPath, { left: 0, top: 0, width: cap.width, height: Math.min(heroH, cap.height) }, { width: 995, height: 631 }, outDir, 'hero', 1);
      drafts.push((await sampleBrandColor(hero.path)).finding);

      const targetFamilies = cap.fonts.usage.filter((u) => matcher.match(u.family)).map((u) => u.family);
      const raw: ScanRaw = {
        finalUrl: cap.finalUrl,
        pageWidthCss: cap.width / cap.deviceScaleFactor,
        pageHeightCss: cap.height / cap.deviceScaleFactor,
        dpr: cap.deviceScaleFactor,
        textBoxes: cap.textBoxes,
        targetFamilies,
        meta: cap.meta,
        dismissedConsent: cap.dismissedConsent,
        durationMs: cap.durationMs,
      };
      this.db.tx(() => {
        for (const d of drafts) {
          const id = this.db.addFinding(scanId, d);
          // Only deterministic, high-confidence font evidence is auto-confirmed. Credits never are.
          if (d.field === 'font' && d.confidence >= AUTO_CONFIRM_THRESHOLD) this.db.setFindingStatus(id, 'confirmed');
          if (d.field === 'source_url') this.db.setFindingStatus(id, 'confirmed');
        }
        this.db.setScanRaw(scanId, raw, cap.htmlPath);
        this.db.setScanStatus(scanId, 'done');
        this.db.upsertJob({ id: jobId, kind: 'scan', refId: scanId, state: 'done' });
      });
      this.db.audit('system', 'scan.done', { siteId, scanId, findings: drafts.length, ms: cap.durationMs });
      return scanId;
    } catch (e) {
      const err = toAppError(e, 'NETWORK');
      this.db.setScanStatus(scanId, 'failed', err.message);
      this.db.failJob(jobId, err.message);
      this.emitEvent({ type: 'error', scope: `scan:${site.canonicalDomain}`, message: err.message });
      return scanId;
    } finally {
      this.emitEvent({ type: 'sites-changed' });
    }
  }

  async getSiteDetail(siteId: number): Promise<SiteDetail> {
    const site = this.db.getSite(siteId);
    const { scanId, findings } = this.latestFindings(siteId);
    const shots = scanId ? this.db.listScreenshots(scanId) : [];
    const full = shots.find((s) => s.kind === 'full');
    return {
      site,
      scanId,
      findings,
      screenshots: await Promise.all(shots.filter((s) => s.kind !== 'full').map(async (s) => ({ ...s, dataUrl: existsSync(s.path) ? await thumbnailDataUrl(s.path, 640) : null }))),
      fullScreenshotDataUrl: full && existsSync(full.path) ? await thumbnailDataUrl(full.path, 480, 3000) : null,
    };
  }

  setFindingStatus(findingId: number, status: FindingStatus) {
    this.db.setFindingStatus(findingId, status);
    this.db.audit('user', 'finding.status', { findingId, status });
    this.emitEvent({ type: 'sites-changed' });
  }

  addManualFinding(siteId: number, field: FindingField, value: string, fontFamilyId: number | null = null) {
    if (!value.trim()) throw new AppError('INVALID_INPUT', 'value is required');
    let scan = this.db.latestScan(siteId);
    let scanId = scan?.id;
    if (!scanId) {
      scanId = this.db.createScan(siteId);
      this.db.setScanStatus(scanId, 'failed', 'manual entry without scan');
    }
    if (field === 'font' && !fontFamilyId) {
      const m = new FontMatcher(this.db.listFonts()).match(value);
      if (!m) throw new AppError('INVALID_INPUT', `"${value}" is not in the FontShok catalogue`);
      fontFamilyId = m.family.id;
      value = m.family.nameHe;
    }
    this.db.addFinding(scanId, { field, value: value.trim(), fontFamilyId, method: 'manual', confidence: 1, evidence: { source: 'entered manually by the user' } });
    this.db.audit('user', 'finding.manual', { siteId, field, value });
    void scan;
    this.emitEvent({ type: 'sites-changed' });
  }

  updateSiteMeta(siteId: number, projectName: string | null, siteType: string | null) {
    this.db.updateSiteMeta(siteId, projectName?.trim() || null, siteType?.trim() || null);
    this.db.audit('user', 'site.meta', { siteId, projectName, siteType });
    this.emitEvent({ type: 'sites-changed' });
  }

  // ================================================================ templates
  async syncTemplates(): Promise<TemplateRecord[]> {
    const { templates } = await this.deps.bridge.requestWithRetry<{ templates: TemplateInfo[] }>('template.list', {});
    if (templates.length === 0) throw new AppError('NOT_FOUND', 'no templates found on the "Templates" page');
    const fileKey = this.deps.bridge.status().plugin?.fileKey ?? this.settings.figmaFileKey;
    for (const t of templates) {
      this.db.upsertTemplate({
        figmaFileKey: fileKey,
        nodeId: t.nodeId,
        variant: t.variant,
        version: t.version,
        name: t.name,
        fingerprint: t.fingerprint,
        fields: t.fields.map((f) => ({ field: f.field, nodeId: f.nodeId, x: f.x, y: f.y, width: f.width, height: f.height })),
      });
    }
    this.db.audit('system', 'templates.sync', { count: templates.length, names: templates.map((t) => t.name) });
    return this.listTemplates();
  }
  listTemplates(): TemplateRecord[] {
    return this.db.listTemplates();
  }

  // ================================================================ groups
  private fontName(id: number): string {
    return this.db.listFonts(true).find((f) => f.id === id)?.nameHe ?? `#${id}`;
  }

  private scanRaw(siteId: number): ScanRaw | null {
    const scan = this.db.latestScan(siteId);
    if (!scan || scan.status !== 'done') return null;
    const r = this.db.raw.prepare('SELECT raw_json FROM scan WHERE id=?').get(scan.id) as { raw_json: string | null } | undefined;
    return r?.raw_json ? (JSON.parse(r.raw_json) as ScanRaw) : null;
  }

  private assembleContent(site: Site, findings: Finding[], primaryFontId: number): MockupContent {
    const fontIds = [primaryFontId, ...this.confirmed(findings, 'font').map((f) => f.fontFamilyId!).filter((id) => id && id !== primaryFontId)];
    const projectName = this.projectName(site, findings);
    if (!projectName) throw new AppError('VALIDATION_FAILED', `${site.canonicalDomain}: project name is not confirmed`);
    const designer = this.confirmed(findings, 'designer')[0]?.value ?? null;
    const developer = this.confirmed(findings, 'developer')[0]?.value ?? null;
    const brand = this.confirmed(findings, 'brand_color')[0] ?? findings.filter((f) => f.field === 'brand_color').sort((a, b) => b.confidence - a.confidence)[0];
    return {
      siteType: site.siteType,
      projectName,
      projectTitle: [site.siteType, projectName].filter(Boolean).join(' '),
      fonts: [...new Set(fontIds)].map((id) => this.fontName(id)),
      designer,
      developer: developer && developer !== designer ? developer : null,
      displayUrl: displayUrl(site.url),
      brandColor: brand ? hexToRgb(brand.value) : { r: 0.2, g: 0.2, b: 0.2 },
    };
  }

  async proposeGroups() {
    const templates = this.db.listTemplates();
    if (templates.length === 0) throw new AppError('NOT_FOUND', 'sync templates from Figma first');
    const membership = this.siteMembership();
    const ready = this.listSites().filter((s) => s.ready && !membership.has(s.site.id) && !s.exported);
    const candidates = ready.map((s) => {
      const { findings } = this.latestFindings(s.site.id);
      return { siteId: s.site.id, fontIds: [...new Set(this.confirmed(findings, 'font').map((f) => f.fontFamilyId!).filter(Boolean))], priority: s.site.id };
    });
    const result = buildGroups(candidates, { fontExportCounts: this.db.fontExportCounts(), alreadyExportedSiteIds: this.db.exportedSiteIds() });
    const created: string[] = [];
    const pick = (variant: string) => templates.find((t) => t.variant === variant) ?? templates[0]!;
    for (const g of result.groups) {
      const code = this.db.nextGroupCode(this.now());
      this.db.tx(() => {
        const groupId = this.db.createGroup(code);
        g.forEach((a, i) => {
          const site = this.db.getSite(a.siteId);
          const { findings } = this.latestFindings(a.siteId);
          const raw = this.scanRaw(a.siteId);
          // long pages get the split template (main + secondary strip); short pages the single one
          const variant = raw && raw.pageHeightCss > raw.pageWidthCss * 1.6 ? 'split' : 'single';
          this.db.insertMockup({
            groupId,
            slot: i + 1,
            siteId: a.siteId,
            primaryFontId: a.primaryFontId,
            templateId: pick(variant).id,
            jobId: randomUUID(),
            content: this.assembleContent(site, findings, a.primaryFontId),
            mainScreenshotId: null,
            secondaryScreenshotId: null,
          });
        });
      });
      created.push(code);
    }
    this.db.audit('system', 'groups.propose', { created, leftovers: result.leftovers.length });
    this.emitEvent({ type: 'groups-changed' });
    this.emitEvent({ type: 'sites-changed' });
    return { created, leftovers: result.leftovers.map((l) => ({ domain: this.db.getSite(l.siteId).canonicalDomain, reason: l.reason })) };
  }

  async listGroups(): Promise<GroupView[]> {
    const templates = new Map(this.db.listTemplates().map((t) => [t.id, t]));
    const exportsByMockup = new Map(this.db.listExports(10000).map((e) => [e.mockupId, e.path]));
    const out: GroupView[] = [];
    for (const g of this.db.listGroups()) {
      const mockups: MockupView[] = [];
      for (const m of this.db.listMockups(g.id)) {
        const preview = join(this.deps.dataDir, 'previews', `${m.jobId}.png`);
        mockups.push({
          ...m,
          siteDomain: this.db.getSite(m.siteId).canonicalDomain,
          templateName: templates.get(m.templateId)?.name ?? `#${m.templateId}`,
          primaryFontName: this.fontName(m.primaryFontId),
          previewDataUrl: m.previewSha256 && existsSync(preview) ? `data:image/png;base64,${(await readFile(preview)).toString('base64')}` : null,
          approved: !!this.db.activeApproval(m.id),
          exportedPath: exportsByMockup.get(m.id) ?? null,
        });
      }
      out.push({ ...g, mockups });
    }
    return out;
  }

  private requireFigma() {
    if (!this.deps.bridge.status().connected) throw new AppError('FIGMA_DISCONNECTED', 'Figma plugin is not connected');
  }

  async buildGroup(groupId: number) {
    this.requireFigma();
    if (this.busyGroups.has(groupId)) throw new AppError('INVALID_INPUT', 'this group is already being built');
    this.busyGroups.add(groupId);
    try {
      const group = this.db.getGroup(groupId);
      const groupIndex = this.db.listGroups().findIndex((g) => g.id === groupId);
      for (const m of this.db.listMockups(groupId)) {
        if (m.status === 'exported') continue;
        await this.buildMockup(m.id, group.code, Math.max(0, groupIndex));
      }
      this.db.setGroupStatus(groupId, 'review');
    } finally {
      this.busyGroups.delete(groupId);
      this.emitEvent({ type: 'groups-changed' });
    }
  }

  async rebuildMockup(mockupId: number) {
    this.requireFigma();
    const m = this.db.getMockup(mockupId);
    const group = this.db.getGroup(m.groupId);
    const groupIndex = this.db.listGroups().findIndex((g) => g.id === m.groupId);
    await this.buildMockup(mockupId, group.code, Math.max(0, groupIndex));
    this.emitEvent({ type: 'groups-changed' });
  }

  private async buildMockup(mockupId: number, groupCode: string, groupIndex: number) {
    const m = this.db.getMockup(mockupId);
    if (m.status === 'exported') throw new AppError('INVALID_INPUT', 'exported mockups are immutable');
    const jobKey = `build-${mockupId}`;
    this.db.upsertJob({ id: jobKey, kind: 'build', refId: mockupId, state: 'running' });
    this.db.revokeApprovals(mockupId, 'rebuilt');
    this.emitEvent({ type: 'progress', scope: `mockup:${mockupId}`, message: 'מכין צילומים…' });
    try {
      const template = this.db.getTemplate(m.templateId);
      const site = this.db.getSite(m.siteId);
      const scan = this.db.latestScan(m.siteId);
      const raw = this.scanRaw(m.siteId);
      if (!scan || !raw) throw new AppError('VALIDATION_FAILED', 'site has no completed scan');
      const full = this.db.listScreenshots(scan.id).find((s) => s.kind === 'full');
      if (!full || !existsSync(full.path)) throw new AppError('NOT_FOUND', 'full screenshot missing – rescan the site');

      const main = template.fields.find((f) => f.field === '@shot.main');
      if (!main) throw new AppError('VALIDATION_FAILED', 'template has no @shot.main');
      const sec = template.fields.find((f) => f.field === '@shot.secondary') ?? null;
      const overlap = sec && sec.y > main.y && sec.y < main.y + main.height ? (sec.y - main.y) / main.height : 1;
      const target = new Set(raw.targetFamilies.map((f) => f.toLowerCase()));
      const boxes: ScoredBox[] = raw.textBoxes.map((b) => ({ ...b, isTarget: target.has(b.family.toLowerCase()) }));
      const plan = planCrops({
        boxes,
        pageWidth: raw.pageWidthCss,
        pageHeight: raw.pageHeightCss,
        deviceScaleFactor: raw.dpr,
        main: { width: main.width, height: main.height, visibleFraction: overlap },
        secondary: sec ? { width: sec.width, height: sec.height } : null,
      });
      const cropDir = join(this.deps.dataDir, 'crops', m.jobId);
      this.guard.assert(cropDir);
      const mainImg = await prepareSlotImage(full.path, plan.main.rect, main, cropDir, 'main', 2);
      const mainShotId = this.db.addScreenshot(scan.id, 'main', mainImg.path, mainImg.width, mainImg.height, mainImg.sha256, mainImg.crop, plan.main.score);
      let secImg: Awaited<ReturnType<typeof prepareSlotImage>> | null = null;
      let secShotId: number | null = null;
      if (sec && plan.secondary) {
        secImg = await prepareSlotImage(full.path, plan.secondary.rect, sec, cropDir, 'secondary', 2);
        secShotId = this.db.addScreenshot(scan.id, 'secondary', secImg.path, secImg.width, secImg.height, secImg.sha256, secImg.crop, plan.secondary.score);
      }
      this.db.setMockupImages(mockupId, mainShotId, secShotId);

      const mainBlob = { id: randomUUID(), data: new Uint8Array(await readFile(mainImg.path)) };
      const blobs = [mainBlob];
      let secBlobId: string | null = null;
      if (secImg) {
        const b = { id: randomUUID(), data: new Uint8Array(await readFile(secImg.path)) };
        blobs.push(b);
        secBlobId = b.id;
      }
      const req: BuildRequest = {
        templateNodeId: template.nodeId,
        expectedTemplateFingerprint: template.fingerprint,
        frameName: `${groupCode} · ${m.slot} · ${m.content.fonts[0]} · ${m.content.projectName}`,
        headline: buildHeadline(m.content),
        credits: buildCredits(m.content),
        gradientColor: m.content.brandColor,
        mainImageBlobId: mainBlob.id,
        secondaryImageBlobId: secBlobId,
        position: { column: m.slot - 1, row: groupIndex },
      };
      this.emitEvent({ type: 'progress', scope: `mockup:${mockupId}`, message: 'בונה ב־Figma…' });
      // build is idempotent per jobId (the plugin replaces the previous frame), so retry is safe
      const built = await this.deps.bridge.requestWithRetry<BuildResult>('mockup.build', req, { jobId: m.jobId, blobs, timeoutMs: 60000, retries: 1 });
      this.db.setMockupBuilt(mockupId, built.nodeId, built.fingerprint);

      this.emitEvent({ type: 'progress', scope: `mockup:${mockupId}`, message: 'תצוגה מקדימה ובדיקות…' });
      const preview = await this.deps.bridge.requestWithRetry<ImageResult>('mockup.preview', { nodeId: built.nodeId, scale: 0.5 }, { jobId: m.jobId });
      const png = this.deps.bridge.takeBlob(preview.blobId);
      const previewDir = join(this.deps.dataDir, 'previews');
      this.guard.assert(previewDir);
      await mkdir(previewDir, { recursive: true });
      await writeFile(join(previewDir, `${m.jobId}.png`), png);

      const tplNow = await this.deps.bridge.requestWithRetry<TemplateInfo>('template.inspect', { templateNodeId: template.nodeId });
      const issues = this.validate(mockupId, tplNow, built, mainImg.width);
      this.db.setMockupValidation(mockupId, issues, sha256(png), preview.fingerprint);
      this.db.upsertJob({ id: jobKey, kind: 'build', refId: mockupId, state: 'done' });
      this.db.audit('system', 'mockup.built', { mockupId, nodeId: built.nodeId, issues: issues.length, site: site.canonicalDomain });
    } catch (e) {
      const err = toAppError(e, 'FIGMA_ERROR');
      this.db.setMockupValidation(mockupId, [{ code: err.code, severity: 'error', message: err.message }], null, null);
      this.db.setMockupStatus(mockupId, 'failed');
      this.db.failJob(jobKey, err.message);
      this.emitEvent({ type: 'error', scope: `mockup:${mockupId}`, message: err.message });
    }
  }

  private validate(mockupId: number, tplNow: TemplateInfo, built: BuildResult | null, mainWidth: number) {
    const m = this.db.getMockup(mockupId);
    const template = this.db.getTemplate(m.templateId);
    const site = this.db.getSite(m.siteId);
    const { findings } = this.latestFindings(m.siteId);
    const groupMockups = this.db.listMockups(m.groupId);
    const confirmedVal = (field: FindingField, v: string | null) => !!v && this.confirmed(findings, field).some((f) => f.value.trim() === v.trim());
    const tplInfo: TemplateInfo = { ...tplNow, fields: tplNow.fields };
    return validateMockup({
      content: m.content,
      confirmed: {
        fonts: this.confirmed(findings, 'font').some((f) => f.fontFamilyId === m.primaryFontId),
        projectName: !!site.projectName?.trim() || confirmedVal('project_name', m.content.projectName),
        designer: m.content.designer ? confirmedVal('designer', m.content.designer) || confirmedVal('developer', m.content.designer) : 'unknown',
      },
      template: tplInfo,
      build: built,
      mainImageWidth: mainWidth,
      templateFingerprintNow: tplNow.fingerprint,
      templateFingerprintExpected: template.fingerprint,
      alreadyExported: !!this.db.findExportByDedupeKey(dedupeKey(site.canonicalDomain, m.primaryFontId, template.name)),
      siteDomain: site.canonicalDomain,
      group: { primaryFontIds: groupMockups.map((x) => x.primaryFontId), size: groupMockups.length },
      primaryFontId: m.primaryFontId,
    });
  }

  updateMockupContent(mockupId: number, content: MockupContent) {
    const m = this.db.getMockup(mockupId);
    if (m.status === 'exported') throw new AppError('INVALID_INPUT', 'exported mockups are immutable');
    // Edits made by the user in the review screen are recorded as manual (confirmed) findings = evidence.
    const scan = this.db.latestScan(m.siteId);
    if (scan) {
      const { findings } = this.latestFindings(m.siteId);
      const record = (field: FindingField, value: string | null) => {
        if (value && !this.confirmed(findings, field).some((f) => f.value === value)) {
          this.db.addFinding(scan.id, { field, value, method: 'manual', confidence: 1, evidence: { source: 'edited by the user in the review screen', extra: { mockupId } } });
        }
      };
      record('designer', content.designer);
      record('developer', content.developer);
      record('project_name', content.projectName);
    }
    this.db.updateMockupContent(mockupId, content);
    this.db.audit('user', 'mockup.edit', { mockupId });
    this.emitEvent({ type: 'groups-changed' });
  }

  setMockupTemplate(mockupId: number, templateId: number) {
    this.db.getTemplate(templateId);
    this.db.setMockupTemplate(mockupId, templateId);
    this.emitEvent({ type: 'groups-changed' });
  }

  approveMockup(mockupId: number, note: string | null = null) {
    this.db.approve(mockupId, note);
    this.db.audit('user', 'mockup.approve', { mockupId, note });
    const m = this.db.getMockup(mockupId);
    const all = this.db.listMockups(m.groupId);
    if (all.length === GROUP_SIZE && all.every((x) => this.db.activeApproval(x.id))) this.db.setGroupStatus(m.groupId, 'approved');
    this.emitEvent({ type: 'groups-changed' });
  }

  rejectMockup(mockupId: number) {
    this.db.revokeApprovals(mockupId, 'rejected by user');
    this.db.setMockupStatus(mockupId, 'rejected');
    this.db.audit('user', 'mockup.reject', { mockupId });
    this.emitEvent({ type: 'groups-changed' });
  }

  async exportGroup(groupId: number) {
    this.requireFigma();
    const group = this.db.getGroup(groupId);
    const mockups = this.db.listMockups(groupId);
    if (mockups.length !== GROUP_SIZE) throw new AppError('VALIDATION_FAILED', `a group must contain exactly ${GROUP_SIZE} mockups`);
    const unapproved = mockups.filter((m) => m.status !== 'exported' && (!this.db.activeApproval(m.id) || m.status !== 'approved'));
    if (unapproved.length) throw new AppError('NOT_APPROVED', `${unapproved.length} mockup(s) are not approved – nothing was exported`);

    // Pre-flight: every frame must still be exactly what the user approved, BEFORE any file is written.
    for (const m of mockups) {
      if (m.status === 'exported') continue;
      const approval = this.db.activeApproval(m.id)!;
      if (!m.figmaNodeId) throw new AppError('NOT_APPROVED', `mockup ${m.slot} has no Figma frame`);
      const probe = await this.deps.bridge.request<ImageResult>('mockup.preview', { nodeId: m.figmaNodeId, scale: 0.05 }, { jobId: m.jobId });
      this.deps.bridge.takeBlob(probe.blobId);
      if (probe.fingerprint !== approval.figmaFingerprint) {
        this.db.revokeApprovals(m.id, 'frame changed in Figma after approval');
        this.db.setMockupStatus(m.id, 'built');
        this.emitEvent({ type: 'groups-changed' });
        throw new AppError('NOT_APPROVED', `mockup ${m.slot} (${m.content.projectName}) was changed in Figma after approval – approval revoked, nothing was exported`);
      }
    }

    // folder date and number come from the group code (G-YYYY-MM-DD-NNN) so folder and code always agree
    const codeParts = /^G-(\d{4}-\d{2}-\d{2})-(\d{3})$/.exec(group.code);
    const seq = Number(codeParts?.[2] ?? '1');
    const groupDate = codeParts ? new Date(`${codeParts[1]}T12:00:00Z`) : new Date(group.createdAt.replace(' ', 'T') + 'Z');
    const folder = join(this.settings.exportRoot, groupFolderName(groupDate, seq, mockups.map((m) => m.content.fonts[0] ?? '')));
    this.guard.assert(folder);
    const written: string[] = [];
    const skipped: string[] = [];
    for (const m of mockups) {
      const template = this.db.getTemplate(m.templateId);
      const site = this.db.getSite(m.siteId);
      const key = dedupeKey(site.canonicalDomain, m.primaryFontId, template.name);
      const prior = this.db.findExportByDedupeKey(key);
      if (prior) {
        skipped.push(`${site.canonicalDomain}: already exported → ${prior.path}`);
        continue;
      }
      const approval = this.db.activeApproval(m.id);
      if (!approval || !m.figmaNodeId) throw new AppError('NOT_APPROVED', `mockup ${m.slot} lost its approval`);
      // Export is never retried automatically.
      const res = await this.deps.bridge.request<ImageResult>('mockup.export', { nodeId: m.figmaNodeId, scale: this.settings.exportScale, approvedFingerprint: approval.figmaFingerprint }, { jobId: m.jobId, timeoutMs: 90000 });
      const png = this.deps.bridge.takeBlob(res.blobId);
      const fileName = mockupFileName(m.content.fonts[0] ?? '', m.content.projectName, m.content.designer);
      const outcome = await writeExport(this.guard, folder, fileName, png);
      this.db.tx(() => {
        this.db.recordExport(m.id, outcome.path, outcome.sha256, key);
        this.db.setMockupStatus(m.id, 'exported');
      });
      this.db.audit('user', 'mockup.export', { mockupId: m.id, path: outcome.path, outcome: outcome.kind });
      written.push(outcome.path);
    }
    if (this.db.listMockups(groupId).every((m) => m.status === 'exported')) this.db.setGroupStatus(groupId, 'exported');
    this.emitEvent({ type: 'groups-changed' });
    return { written, skipped };
  }

  async deleteGroup(groupId: number) {
    const mockups = this.db.listMockups(groupId);
    if (this.deps.bridge.status().connected) {
      for (const m of mockups) if (m.figmaNodeId) await this.deps.bridge.request('mockup.delete', { nodeId: m.figmaNodeId }).catch(() => undefined);
    }
    this.db.deleteGroup(groupId);
    this.db.audit('user', 'group.delete', { groupId });
    this.emitEvent({ type: 'groups-changed' });
    this.emitEvent({ type: 'sites-changed' });
  }

  listExports() {
    return this.db.listExports();
  }
  listAudit() {
    return this.db.listAudit();
  }

  // ================================================================ recovery
  /** On start-up: anything left "running" was interrupted by a crash or by closing the app. */
  private recoverJobs() {
    for (const j of this.db.listJobs(['running'])) {
      if (j.kind === 'scan' && j.refId) this.db.setScanStatus(j.refId, 'failed', 'interrupted – please rescan');
      if (j.kind === 'build' && j.refId) {
        try {
          const m = this.db.getMockup(j.refId);
          if (m.status !== 'exported') this.db.setMockupStatus(j.refId, 'pending');
        } catch {
          /* mockup deleted */
        }
      }
      this.db.failJob(j.id, 'interrupted');
    }
  }

  /** When the plugin connects, drop references to frames that no longer exist in Figma. */
  async reconcileWithFigma() {
    const { items } = await this.deps.bridge.request<{ items: InventoryItem[] }>('inventory', {});
    const present = new Set(items.map((i) => i.nodeId));
    const rows = this.db.raw.prepare(`SELECT id, figma_node_id AS n, status FROM mockup WHERE figma_node_id IS NOT NULL AND status != 'exported'`).all() as { id: number; n: string; status: string }[];
    let cleared = 0;
    for (const r of rows) {
      if (!present.has(r.n)) {
        this.db.clearMockupFigma(r.id);
        cleared++;
      }
    }
    if (cleared) {
      this.db.audit('system', 'figma.reconcile', { cleared });
      this.emitEvent({ type: 'groups-changed' });
    }
  }
}
