/**
 * End-to-end test of the production flow with:
 *   real Chromium scans of local fixture sites, real SQLite, real WebSocket bridge,
 *   real image processing and real file export – only Figma is replaced by FakePlugin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Db } from '@fontshok/db';
import { FigmaBridge } from '@fontshok/figma-bridge';
import { SiteCapturer } from '@fontshok/scanner';
import { Studio } from './studio.js';
import { FIXTURE_SITES, startFixtureServer } from '../../../../../test/fixtures/sites.js';
import { FakePlugin } from '../../../../../test/fixtures/fakePlugin.js';

const PORT = 47920;
let server: Awaited<ReturnType<typeof startFixtureServer>>;
let db: Db;
let studio: Studio;
let bridge: FigmaBridge;
let plugin: FakePlugin;
const capturer = new SiteCapturer();
const root = mkdtempSync(join(tmpdir(), 'studio-e2e-'));
const dataDir = join(root, 'data');
const exportRoot = join(root, 'פונטשוק חדש', 'לפרסום ממומן');

beforeAll(async () => {
  server = await startFixtureServer();
  db = new Db(join(root, 'studio.sqlite'));
  bridge = new FigmaBridge({ port: PORT, token: () => studio.getSettings().pairingToken, appVersion: 'test', defaultTimeoutMs: 10000 });
  await bridge.start();
  studio = new Studio({ db, dataDir, bridge, capturer, now: () => new Date('2026-11-02T09:00:00Z') });
  studio.updateSettings({ exportRoot, wsPort: PORT });
});

afterAll(async () => {
  plugin?.close();
  await bridge.stop();
  await capturer.close();
  await server.close();
  db.close();
});

describe('Studio end-to-end', () => {
  it('imports the font catalogue', () => {
    const r = studio.importCatalogCsv(
      'name_he,name_en,aliases\n' +
        'פומפאי בלוק,Pompei Block,pompei-block-fs\n' +
        'דיסקברי,Discovery,FS Discovery\n' +
        'טאלנט,Talent,talent-fs\n' +
        'נוסטלה,Nostalgia,Nostalgia FS\n' +
        'האנגר,Hangar,\n',
    );
    expect(r.added).toBe(5);
    expect(r.errors).toEqual([]);
  });

  it('adds sites, rejects duplicates and invalid URLs', () => {
    const urls = FIXTURE_SITES.map((s) => server.url(s.host));
    const r = studio.addSites([...urls, urls[0]!, 'not a url']);
    expect(r.added).toHaveLength(5);
    expect(r.duplicates).toHaveLength(1);
    expect(r.invalid).toEqual(['not a url']);
  });

  it('scans every site with evidence for each finding', async () => {
    for (const s of studio.listSites()) await studio.runScan(s.site.id);
    const sites = studio.listSites();
    expect(sites.every((s) => s.scan?.status === 'done')).toBe(true);
    // fonts are auto-confirmed only with deterministic, high-confidence evidence
    expect(sites.map((s) => s.confirmedFonts.length)).toEqual([1, 1, 1, 1, 1]);
    // project names are NOT auto-confirmed → sites are not ready yet
    expect(sites.every((s) => !s.ready && s.missing.includes('שם פרויקט'))).toBe(true);

    const zinka = sites.find((s) => s.site.canonicalDomain === 'zinka.localhost')!;
    const d = await studio.getSiteDetail(zinka.site.id);
    expect(d.findings.every((f) => f.evidence.source.length > 0)).toBe(true);
    const designer = d.findings.find((f) => f.field === 'designer')!;
    expect(designer).toMatchObject({ value: 'סטודיו לדוגמה', status: 'suggested' });
    const brand = d.findings.find((f) => f.field === 'brand_color')!;
    expect(brand.value).toMatch(/^#F[0-9A-F]9[0-9A-F]3[0-9A-F]$/); // ≈ #F89E38
    // CMS credit is ignored, no designer is invented for a site without credits
    const craft = sites.find((s) => s.site.canonicalDomain === 'craft.localhost')!;
    expect((await studio.getSiteDetail(craft.site.id)).findings.some((f) => f.field === 'designer')).toBe(false);
  });

  it('becomes ready after the user confirms project names and credits', async () => {
    for (const s of studio.listSites()) {
      const d = await studio.getSiteDetail(s.site.id);
      const pn = d.findings.find((f) => f.field === 'project_name' && f.method === 'meta');
      if (pn) studio.setFindingStatus(pn.id, 'confirmed');
      if (s.site.canonicalDomain === 'zinka.localhost') {
        studio.updateSiteMeta(s.site.id, null, 'הסטודיו');
        studio.setFindingStatus(d.findings.find((f) => f.field === 'designer')!.id, 'confirmed');
      }
    }
    expect(studio.listSites().filter((s) => s.ready)).toHaveLength(5);
  });

  it('pairs with the plugin and syncs templates', async () => {
    plugin = new FakePlugin(PORT, studio.getSettings().pairingToken);
    expect((await plugin.connect()).accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const t = await studio.syncTemplates();
    expect(t.map((x) => x.name).sort()).toEqual(['tpl/single/v1', 'tpl/split/v1']);
  });

  it('proposes exactly one group of four with four distinct fonts', async () => {
    const r = await studio.proposeGroups();
    expect(r.created).toEqual(['G-2026-11-02-001']);
    expect(r.leftovers).toHaveLength(1);
    const [g] = await studio.listGroups();
    expect(g!.mockups).toHaveLength(4);
    expect(new Set(g!.mockups.map((m) => m.primaryFontId)).size).toBe(4);
  });

  it('refuses to export before approval and writes nothing', async () => {
    const [g] = await studio.listGroups();
    await expect(studio.exportGroup(g!.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect(existsSync(exportRoot)).toBe(false);
  });

  it('refuses to build when the master template changed in Figma', async () => {
    const [g] = await studio.listGroups();
    plugin.templateFingerprintOverride = 'someone-edited-the-template';
    await studio.buildGroup(g!.id);
    const [failed] = await studio.listGroups();
    for (const m of failed!.mockups) {
      expect(m.status).toBe('failed');
      expect(m.validation[0]).toMatchObject({ code: 'TEMPLATE_CHANGED', severity: 'error' });
    }
    expect(plugin.frames.size).toBe(0);
    plugin.templateFingerprintOverride = null;
  });

  it('builds in Figma, crops images to the slot size and validates', async () => {
    const [g] = await studio.listGroups();
    await studio.buildGroup(g!.id);
    const [built] = await studio.listGroups();
    for (const m of built!.mockups) {
      expect(m.status, JSON.stringify(m.validation)).toBe('validated');
      expect(m.previewDataUrl).toMatch(/^data:image\/png;base64,/);
    }
    // images sent to Figma are exactly 2× the slot size
    for (const f of plugin.frames.values()) {
      const tpl = f.req.secondaryImageBlobId ? { w: 1990, h: 1262 } : { w: 1996, h: 1270 };
      expect(f.images[0]).toEqual(tpl);
      if (f.images[1]) expect(f.images[1]).toEqual({ w: 1990, h: 526 });
    }
    const zinka = built!.mockups.find((m) => m.siteDomain === 'zinka.localhost')!;
    const frame = [...plugin.frames.values()].find((f) => f.jobId === zinka.jobId)!;
    expect(frame.req.headline.runs.map((r) => r.text).join('')).toBe('גם באתר הסטודיו "Zinka"\nמשתמשים בפונט פומפאי בלוק\nמבית פונטשוק');
    expect(frame.req.credits.runs.map((r) => r.text).join('')).toContain('עיצוב אתר: סטודיו לדוגמה');
  });

  it('revokes approval when content is edited and when the frame changes in Figma', async () => {
    const [g] = await studio.listGroups();
    const m = g!.mockups[0]!;
    studio.approveMockup(m.id);
    expect((await studio.listGroups())[0]!.mockups[0]!.approved).toBe(true);
    studio.updateMockupContent(m.id, { ...m.content, projectTitle: m.content.projectTitle + ' – אתר הבית' });
    const after = (await studio.listGroups())[0]!.mockups[0]!;
    expect(after.approved).toBe(false);
    expect(after.status).toBe('pending');
    expect(() => studio.approveMockup(m.id)).toThrow(/validated/);
    await studio.rebuildMockup(m.id);
    for (const x of (await studio.listGroups())[0]!.mockups) studio.approveMockup(x.id);
    expect((await studio.listGroups())[0]!.status).toBe('approved');

    // someone edits a frame in Figma after approval → export is refused before writing anything
    const victim = [...plugin.frames.values()][2]!;
    const original = victim.fingerprint;
    victim.fingerprint = 'edited-in-figma';
    await expect(studio.exportGroup(g!.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect(existsSync(exportRoot)).toBe(false);
    victim.fingerprint = original;
    const revoked = (await studio.listGroups())[0]!.mockups.find((x) => !x.approved)!;
    await studio.rebuildMockup(revoked.id);
    studio.approveMockup(revoked.id);
  });

  it('exports four PNGs with the required names, once', async () => {
    const [g] = await studio.listGroups();
    const r = await studio.exportGroup(g!.id);
    expect(r.written).toHaveLength(4);
    const folder = join(exportRoot, readdirSync(exportRoot)[0]!);
    expect(folder.endsWith('2026-11-02 קבוצה 001 - ' + g!.mockups.map((m) => m.content.fonts[0]).join(', '))).toBe(true);
    const files = readdirSync(folder).sort();
    expect(files).toContain('פומפאי בלוק - Zinka - סטודיו לדוגמה.png');
    expect(files.filter((f) => f.endsWith('ללא קרדיט.png')).length).toBeGreaterThan(0);
    const meta = await sharp(join(folder, files[0]!)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);

    const again = await studio.exportGroup(g!.id);
    expect(again.written).toHaveLength(0);
    expect(again.skipped).toHaveLength(4);
    expect(readdirSync(folder)).toHaveLength(4);
    expect(studio.listExports()).toHaveLength(4);
    await expect(studio.deleteGroup(g!.id)).rejects.toThrow(/history/);
  });

  it('does not offer exported sites again', async () => {
    const r = await studio.proposeGroups();
    expect(r.created).toEqual([]);
  });

  it('keeps exported mockups immutable', async () => {
    const [g] = await studio.listGroups();
    const m = g!.mockups[0]!;
    await expect(studio.rebuildMockup(m.id)).rejects.toThrow(/immutable/);
    expect(() => studio.updateMockupContent(m.id, m.content)).toThrow(/immutable/);
  });

  it('recovers interrupted jobs on restart', () => {
    const site = studio.listSites()[0]!;
    const scanId = db.createScan(site.site.id);
    db.setScanStatus(scanId, 'running');
    db.upsertJob({ id: `scan-${scanId}`, kind: 'scan', refId: scanId, state: 'running' });
    const restarted = new Studio({ db, dataDir, bridge, capturer });
    void restarted;
    expect(db.latestScan(site.site.id)).toMatchObject({ status: 'failed', error: 'interrupted – please rescan' });
  });

  it('refuses writes outside the allowed directories', async () => {
    expect(() => studio.updateSettings({ exportScale: 3 as 1 })).toThrow();
    const guardTest = new (await import('@fontshok/exporter')).FsGuard([exportRoot, dataDir]);
    expect(guardTest.isAllowed(join(root, 'elsewhere', 'x.png'))).toBe(false);
  });
});
