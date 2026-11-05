import BetterSqlite3 from 'better-sqlite3';
import {
  AppError,
  type AliasKind,
  type CropRect,
  type ExportRecord,
  type Finding,
  type FindingDraft,
  type FindingStatus,
  type FontFamily,
  type GroupStatus,
  type MockupContent,
  type MockupRecord,
  type MockupStatus,
  type ScanStatus,
  type ScreenshotKind,
  type ScreenshotRecord,
  type Site,
  type TemplateFieldInfo,
  type TemplateRecord,
  type TemplateVariant,
  type ValidationIssue,
} from '@fontshok/shared';
import { MIGRATIONS } from './migrations.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => Number(v);

export interface JobRow {
  id: string;
  kind: string;
  refId: number | null;
  state: string;
  attempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Single access point to the SQLite file. Synchronous (better-sqlite3) and used only from the Electron
 * main process. All multi-row writes are wrapped in transactions.
 */
export class Db {
  readonly raw: BetterSqlite3.Database;

  constructor(file: string) {
    this.raw = new BetterSqlite3(file);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('busy_timeout = 5000');
    this.migrate();
  }

  close() {
    this.raw.close();
  }

  private migrate() {
    const current = n(this.raw.pragma('user_version', { simple: true }));
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.raw.transaction(() => {
        this.raw.exec(MIGRATIONS[i]!);
        this.raw.pragma(`user_version = ${i + 1}`);
      })();
    }
  }

  tx<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  // ---------------- settings & audit ----------------
  getSetting(key: string): string | null {
    const r = this.raw.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined;
    return r ? s(r.value) : null;
  }
  setSetting(key: string, value: string) {
    this.raw.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  audit(actor: string, action: string, data: unknown = {}) {
    this.raw.prepare('INSERT INTO audit_log(actor,action,data_json) VALUES(?,?,?)').run(actor, action, JSON.stringify(data));
  }
  listAudit(limit = 200): { at: string; actor: string; action: string; data: unknown }[] {
    return (this.raw.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      at: String(r.at),
      actor: String(r.actor),
      action: String(r.action),
      data: JSON.parse(String(r.data_json)),
    }));
  }

  // ---------------- fonts ----------------
  listFonts(includeInactive = false): FontFamily[] {
    const fams = this.raw
      .prepare(`SELECT * FROM font_family ${includeInactive ? '' : 'WHERE active=1'} ORDER BY name_he`)
      .all() as Row[];
    const aliases = this.raw.prepare('SELECT * FROM font_alias').all() as Row[];
    return fams.map((f) => ({
      id: n(f.id),
      nameHe: String(f.name_he),
      nameEn: s(f.name_en),
      slug: String(f.slug),
      active: n(f.active) === 1,
      aliases: aliases
        .filter((a) => n(a.family_id) === n(f.id))
        .map((a) => ({ id: n(a.id), familyId: n(a.family_id), alias: String(a.alias), kind: a.kind as AliasKind })),
    }));
  }

  upsertFont(nameHe: string, nameEn: string | null, slug: string): number {
    const r = this.raw
      .prepare(
        `INSERT INTO font_family(name_he,name_en,slug) VALUES(?,?,?)
         ON CONFLICT(name_he) DO UPDATE SET name_en=COALESCE(excluded.name_en,font_family.name_en)
         RETURNING id`,
      )
      .get(nameHe, nameEn, slug) as Row;
    return n(r.id);
  }

  /** Returns false when the alias already belongs to another family (conflict is surfaced in the UI). */
  addAlias(familyId: number, alias: string, kind: AliasKind): boolean {
    const existing = this.raw.prepare('SELECT family_id FROM font_alias WHERE alias=?').get(alias) as Row | undefined;
    if (existing) return n(existing.family_id) === familyId;
    this.raw.prepare('INSERT INTO font_alias(family_id,alias,kind) VALUES(?,?,?)').run(familyId, alias, kind);
    return true;
  }

  removeAlias(aliasId: number) {
    this.raw.prepare('DELETE FROM font_alias WHERE id=?').run(aliasId);
  }

  setFontActive(familyId: number, active: boolean) {
    this.raw.prepare('UPDATE font_family SET active=? WHERE id=?').run(active ? 1 : 0, familyId);
  }

  // ---------------- sites & scans ----------------
  findSiteByDomain(domain: string): Site | null {
    const r = this.raw.prepare('SELECT * FROM site WHERE canonical_domain=?').get(domain) as Row | undefined;
    return r ? mapSite(r) : null;
  }
  getSite(id: number): Site {
    const r = this.raw.prepare('SELECT * FROM site WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', `site ${id}`);
    return mapSite(r);
  }
  listSites(): Site[] {
    return (this.raw.prepare('SELECT * FROM site ORDER BY id DESC').all() as Row[]).map(mapSite);
  }
  insertSite(url: string, domain: string): Site {
    const r = this.raw.prepare('INSERT INTO site(url,canonical_domain) VALUES(?,?) RETURNING *').get(url, domain) as Row;
    return mapSite(r);
  }
  updateSiteMeta(id: number, projectName: string | null, siteType: string | null) {
    this.raw.prepare('UPDATE site SET project_name=?, site_type=? WHERE id=?').run(projectName, siteType, id);
  }

  createScan(siteId: number): number {
    const r = this.raw.prepare(`INSERT INTO scan(site_id,status) VALUES(?, 'queued') RETURNING id`).get(siteId) as Row;
    return n(r.id);
  }
  setScanStatus(scanId: number, status: ScanStatus, error: string | null = null) {
    const col = status === 'running' ? ', started_at=datetime(\'now\')' : status === 'done' || status === 'failed' ? ', finished_at=datetime(\'now\')' : '';
    this.raw.prepare(`UPDATE scan SET status=?, error=? ${col} WHERE id=?`).run(status, error, scanId);
  }
  setScanRaw(scanId: number, raw: unknown, htmlPath: string | null) {
    this.raw.prepare('UPDATE scan SET raw_json=?, html_snapshot_path=? WHERE id=?').run(JSON.stringify(raw), htmlPath, scanId);
  }
  latestScan(siteId: number): { id: number; status: ScanStatus; error: string | null; finishedAt: string | null } | null {
    const r = this.raw.prepare('SELECT * FROM scan WHERE site_id=? ORDER BY id DESC LIMIT 1').get(siteId) as Row | undefined;
    return r ? { id: n(r.id), status: r.status as ScanStatus, error: s(r.error), finishedAt: s(r.finished_at) } : null;
  }

  addScreenshot(scanId: number, kind: ScreenshotKind, path: string, width: number, height: number, sha256: string, crop: CropRect | null, score: number | null): number {
    const r = this.raw
      .prepare('INSERT INTO screenshot(scan_id,kind,path,width,height,crop_json,score,sha256) VALUES(?,?,?,?,?,?,?,?) RETURNING id')
      .get(scanId, kind, path, width, height, crop ? JSON.stringify(crop) : null, score, sha256) as Row;
    return n(r.id);
  }
  listScreenshots(scanId: number): ScreenshotRecord[] {
    return (this.raw.prepare('SELECT * FROM screenshot WHERE scan_id=? ORDER BY id').all(scanId) as Row[]).map(mapShot);
  }
  getScreenshot(id: number): ScreenshotRecord {
    const r = this.raw.prepare('SELECT * FROM screenshot WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', `screenshot ${id}`);
    return mapShot(r);
  }

  // ---------------- findings ----------------
  addFinding(scanId: number, f: FindingDraft): number {
    if (!f.evidence || !f.evidence.source) throw new AppError('INVALID_INPUT', 'a finding must carry evidence');
    const r = this.raw
      .prepare(
        `INSERT INTO finding(scan_id,field,value,font_family_id,method,confidence,status,evidence_json)
         VALUES(?,?,?,?,?,?,?,?) RETURNING id`,
      )
      .get(
        scanId,
        f.field,
        f.value,
        f.fontFamilyId ?? null,
        f.method,
        f.confidence,
        f.method === 'manual' ? 'confirmed' : 'suggested',
        JSON.stringify(f.evidence),
      ) as Row;
    return n(r.id);
  }
  listFindings(scanId: number): Finding[] {
    return (this.raw.prepare('SELECT * FROM finding WHERE scan_id=? ORDER BY field, confidence DESC').all(scanId) as Row[]).map(mapFinding);
  }
  setFindingStatus(id: number, status: FindingStatus) {
    this.raw.prepare('UPDATE finding SET status=? WHERE id=?').run(status, id);
  }

  // ---------------- templates ----------------
  upsertTemplate(t: Omit<TemplateRecord, 'id' | 'active'>): number {
    const r = this.raw
      .prepare(
        `INSERT INTO template(figma_file_key,node_id,variant,version,name,fingerprint,fields_json) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(figma_file_key,node_id) DO UPDATE SET variant=excluded.variant, version=excluded.version,
           name=excluded.name, fingerprint=excluded.fingerprint, fields_json=excluded.fields_json, active=1
         RETURNING id`,
      )
      .get(t.figmaFileKey, t.nodeId, t.variant, t.version, t.name, t.fingerprint, JSON.stringify(t.fields)) as Row;
    return n(r.id);
  }
  listTemplates(): TemplateRecord[] {
    return (this.raw.prepare('SELECT * FROM template WHERE active=1 ORDER BY variant').all() as Row[]).map(mapTemplate);
  }
  getTemplate(id: number): TemplateRecord {
    const r = this.raw.prepare('SELECT * FROM template WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', `template ${id}`);
    return mapTemplate(r);
  }

  // ---------------- groups & mockups ----------------
  nextGroupCode(date: Date = new Date()): string {
    const ymd = date.toISOString().slice(0, 10);
    const r = this.raw.prepare(`SELECT COUNT(*) AS c FROM mockup_group WHERE code LIKE ?`).get(`G-${ymd}-%`) as Row;
    return `G-${ymd}-${String(n(r.c) + 1).padStart(3, '0')}`;
  }
  createGroup(code: string): number {
    const r = this.raw.prepare(`INSERT INTO mockup_group(code,status) VALUES(?, 'draft') RETURNING id`).get(code) as Row;
    return n(r.id);
  }
  listGroups(): { id: number; code: string; status: GroupStatus; createdAt: string }[] {
    return (this.raw.prepare('SELECT * FROM mockup_group ORDER BY id DESC').all() as Row[]).map((r) => ({
      id: n(r.id),
      code: String(r.code),
      status: r.status as GroupStatus,
      createdAt: String(r.created_at),
    }));
  }
  getGroup(id: number): { id: number; code: string; status: GroupStatus; createdAt: string } {
    const r = this.raw.prepare('SELECT * FROM mockup_group WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', `group ${id}`);
    return { id: n(r.id), code: String(r.code), status: r.status as GroupStatus, createdAt: String(r.created_at) };
  }
  setGroupStatus(id: number, status: GroupStatus) {
    this.raw.prepare('UPDATE mockup_group SET status=? WHERE id=?').run(status, id);
  }
  deleteGroup(id: number) {
    const exported = this.raw.prepare(`SELECT COUNT(*) AS c FROM export e JOIN mockup m ON m.id=e.mockup_id WHERE m.group_id=?`).get(id) as Row;
    if (n(exported.c) > 0) throw new AppError('INVALID_INPUT', 'cannot delete a group that has exports (production history is preserved)');
    this.raw.prepare('DELETE FROM mockup_group WHERE id=?').run(id);
  }

  insertMockup(m: {
    groupId: number;
    slot: number;
    siteId: number;
    primaryFontId: number;
    templateId: number;
    jobId: string;
    content: MockupContent;
    mainScreenshotId: number | null;
    secondaryScreenshotId: number | null;
  }): number {
    const r = this.raw
      .prepare(
        `INSERT INTO mockup(group_id,slot,site_id,primary_font_id,template_id,job_id,content_json,status,main_screenshot_id,secondary_screenshot_id)
         VALUES(?,?,?,?,?,?,?, 'pending', ?, ?) RETURNING id`,
      )
      .get(m.groupId, m.slot, m.siteId, m.primaryFontId, m.templateId, m.jobId, JSON.stringify(m.content), m.mainScreenshotId, m.secondaryScreenshotId) as Row;
    return n(r.id);
  }
  listMockups(groupId: number): (MockupRecord & { mainScreenshotId: number | null; secondaryScreenshotId: number | null })[] {
    return (this.raw.prepare('SELECT * FROM mockup WHERE group_id=? ORDER BY slot').all(groupId) as Row[]).map(mapMockup);
  }
  getMockup(id: number): MockupRecord & { mainScreenshotId: number | null; secondaryScreenshotId: number | null } {
    const r = this.raw.prepare('SELECT * FROM mockup WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', `mockup ${id}`);
    return mapMockup(r);
  }
  updateMockupContent(id: number, content: MockupContent) {
    this.tx(() => {
      this.raw.prepare(`UPDATE mockup SET content_json=?, status='pending' WHERE id=?`).run(JSON.stringify(content), id);
      this.revokeApprovals(id, 'content edited');
    });
  }
  setMockupBuilt(id: number, figmaNodeId: string, fingerprint: string) {
    this.raw.prepare(`UPDATE mockup SET figma_node_id=?, figma_fingerprint=?, status='built' WHERE id=?`).run(figmaNodeId, fingerprint, id);
  }
  setMockupValidation(id: number, issues: ValidationIssue[], previewSha: string | null, fingerprint: string | null) {
    const hasError = issues.some((i) => i.severity === 'error');
    this.raw
      .prepare(`UPDATE mockup SET validation_json=?, preview_sha256=?, figma_fingerprint=COALESCE(?, figma_fingerprint), status=? WHERE id=?`)
      .run(JSON.stringify(issues), previewSha, fingerprint, hasError ? 'failed' : 'validated', id);
  }
  setMockupImages(id: number, mainScreenshotId: number, secondaryScreenshotId: number | null) {
    this.raw.prepare('UPDATE mockup SET main_screenshot_id=?, secondary_screenshot_id=? WHERE id=?').run(mainScreenshotId, secondaryScreenshotId, id);
  }
  setMockupTemplate(id: number, templateId: number) {
    this.tx(() => {
      this.raw.prepare(`UPDATE mockup SET template_id=?, status='pending' WHERE id=?`).run(templateId, id);
      this.revokeApprovals(id, 'template changed');
    });
  }
  clearMockupFigma(id: number) {
    this.tx(() => {
      this.raw.prepare(`UPDATE mockup SET figma_node_id=NULL, figma_fingerprint=NULL, preview_sha256=NULL, status='pending' WHERE id=?`).run(id);
      this.revokeApprovals(id, 'figma frame missing');
    });
  }
  setMockupStatus(id: number, status: MockupStatus) {
    this.raw.prepare('UPDATE mockup SET status=? WHERE id=?').run(status, id);
  }

  // ---------------- approvals ----------------
  approve(mockupId: number, note: string | null = null): void {
    const m = this.getMockup(mockupId);
    if (m.status !== 'validated') throw new AppError('NOT_APPROVED', `mockup ${mockupId} must be validated before approval (status: ${m.status})`);
    if (!m.figmaFingerprint || !m.previewSha256) throw new AppError('NOT_APPROVED', 'missing preview/fingerprint');
    this.tx(() => {
      this.raw.prepare('INSERT INTO approval(mockup_id,figma_fingerprint,preview_sha256,note) VALUES(?,?,?,?)').run(mockupId, m.figmaFingerprint, m.previewSha256, note);
      this.raw.prepare(`UPDATE mockup SET status='approved' WHERE id=?`).run(mockupId);
    });
  }
  activeApproval(mockupId: number): { figmaFingerprint: string; previewSha256: string; approvedAt: string } | null {
    const r = this.raw
      .prepare('SELECT * FROM approval WHERE mockup_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(mockupId) as Row | undefined;
    return r ? { figmaFingerprint: String(r.figma_fingerprint), previewSha256: String(r.preview_sha256), approvedAt: String(r.approved_at) } : null;
  }
  revokeApprovals(mockupId: number, note: string) {
    this.raw.prepare(`UPDATE approval SET revoked_at=datetime('now'), note=COALESCE(note,'') || ' | revoked: ' || ? WHERE mockup_id=? AND revoked_at IS NULL`).run(note, mockupId);
  }

  // ---------------- exports ----------------
  findExportByDedupeKey(key: string): ExportRecord | null {
    const r = this.raw.prepare('SELECT * FROM export WHERE dedupe_key=?').get(key) as Row | undefined;
    return r ? mapExport(r) : null;
  }
  findExportBySha(sha: string): ExportRecord | null {
    const r = this.raw.prepare('SELECT * FROM export WHERE sha256=? LIMIT 1').get(sha) as Row | undefined;
    return r ? mapExport(r) : null;
  }
  recordExport(mockupId: number, path: string, sha256: string, dedupeKey: string): number {
    const r = this.raw.prepare('INSERT INTO export(mockup_id,path,sha256,dedupe_key) VALUES(?,?,?,?) RETURNING id').get(mockupId, path, sha256, dedupeKey) as Row;
    return n(r.id);
  }
  listExports(limit = 500): (ExportRecord & { groupCode: string })[] {
    return (
      this.raw
        .prepare('SELECT e.*, g.code AS group_code FROM export e JOIN mockup m ON m.id=e.mockup_id JOIN mockup_group g ON g.id=m.group_id ORDER BY e.id DESC LIMIT ?')
        .all(limit) as Row[]
    ).map((r) => ({ ...mapExport(r), groupCode: String(r.group_code) }));
  }
  /** Font families already exported in the past, with how many times (used to rotate fonts across groups). */
  fontExportCounts(): Map<number, number> {
    const rows = this.raw.prepare('SELECT m.primary_font_id AS f, COUNT(*) AS c FROM export e JOIN mockup m ON m.id=e.mockup_id GROUP BY m.primary_font_id').all() as Row[];
    return new Map(rows.map((r) => [n(r.f), n(r.c)]));
  }
  exportedSiteIds(): Set<number> {
    const rows = this.raw.prepare('SELECT DISTINCT m.site_id AS s FROM export e JOIN mockup m ON m.id=e.mockup_id').all() as Row[];
    return new Set(rows.map((r) => n(r.s)));
  }

  // ---------------- jobs (crash recovery) ----------------
  upsertJob(j: { id: string; kind: string; refId: number | null; state: string; payload?: Record<string, unknown> }) {
    this.raw
      .prepare(
        `INSERT INTO job(id,kind,ref_id,state,payload_json) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload_json=excluded.payload_json, updated_at=datetime('now')`,
      )
      .run(j.id, j.kind, j.refId, j.state, JSON.stringify(j.payload ?? {}));
  }
  failJob(id: string, error: string) {
    this.raw.prepare(`UPDATE job SET state='failed', attempts=attempts+1, last_error=?, updated_at=datetime('now') WHERE id=?`).run(error, id);
  }
  bumpAttempt(id: string) {
    this.raw.prepare(`UPDATE job SET attempts=attempts+1, updated_at=datetime('now') WHERE id=?`).run(id);
  }
  listJobs(states: string[]): JobRow[] {
    const q = `SELECT * FROM job WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY updated_at`;
    return (this.raw.prepare(q).all(...states) as Row[]).map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      refId: r.ref_id === null ? null : n(r.ref_id),
      state: String(r.state),
      attempts: n(r.attempts),
      lastError: s(r.last_error),
      payload: JSON.parse(String(r.payload_json)),
      updatedAt: String(r.updated_at),
    }));
  }
}

function mapSite(r: Row): Site {
  return {
    id: n(r.id),
    url: String(r.url),
    canonicalDomain: String(r.canonical_domain),
    projectName: s(r.project_name),
    siteType: s(r.site_type),
    createdAt: String(r.created_at),
  };
}
function mapShot(r: Row): ScreenshotRecord {
  return {
    id: n(r.id),
    scanId: n(r.scan_id),
    kind: r.kind as ScreenshotKind,
    path: String(r.path),
    width: n(r.width),
    height: n(r.height),
    crop: r.crop_json ? (JSON.parse(String(r.crop_json)) as CropRect) : null,
    score: r.score === null ? null : n(r.score),
    sha256: String(r.sha256),
  };
}
function mapFinding(r: Row): Finding {
  return {
    id: n(r.id),
    scanId: n(r.scan_id),
    field: r.field as Finding['field'],
    value: String(r.value),
    fontFamilyId: r.font_family_id === null ? null : n(r.font_family_id),
    method: r.method as Finding['method'],
    confidence: n(r.confidence),
    status: r.status as FindingStatus,
    evidence: JSON.parse(String(r.evidence_json)),
    createdAt: String(r.created_at),
  };
}
function mapTemplate(r: Row): TemplateRecord {
  return {
    id: n(r.id),
    figmaFileKey: String(r.figma_file_key),
    nodeId: String(r.node_id),
    variant: r.variant as TemplateVariant,
    version: n(r.version),
    name: String(r.name),
    fingerprint: String(r.fingerprint),
    fields: JSON.parse(String(r.fields_json)) as TemplateFieldInfo[],
    active: n(r.active) === 1,
  };
}
function mapMockup(r: Row): MockupRecord & { mainScreenshotId: number | null; secondaryScreenshotId: number | null } {
  return {
    id: n(r.id),
    groupId: n(r.group_id),
    slot: n(r.slot) as 1 | 2 | 3 | 4,
    siteId: n(r.site_id),
    primaryFontId: n(r.primary_font_id),
    templateId: n(r.template_id),
    jobId: String(r.job_id),
    figmaNodeId: s(r.figma_node_id),
    content: JSON.parse(String(r.content_json)) as MockupContent,
    status: r.status as MockupStatus,
    validation: JSON.parse(String(r.validation_json)) as ValidationIssue[],
    previewSha256: s(r.preview_sha256),
    figmaFingerprint: s(r.figma_fingerprint),
    mainScreenshotId: r.main_screenshot_id === null ? null : n(r.main_screenshot_id),
    secondaryScreenshotId: r.secondary_screenshot_id === null ? null : n(r.secondary_screenshot_id),
  };
}
function mapExport(r: Row): ExportRecord {
  return {
    id: n(r.id),
    mockupId: n(r.mockup_id),
    path: String(r.path),
    sha256: String(r.sha256),
    dedupeKey: String(r.dedupe_key),
    exportedAt: String(r.exported_at),
  };
}

export { MIGRATIONS };
