import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontMatcher } from '@fontshok/fonts';
import { SiteCapturer } from './capture.js';
import { extractCredits, extractProjectName } from './credits.js';
import { fontFindings } from './fonts.js';
import { startFixtureServer } from '../../../test/fixtures/sites.js';

let server: Awaited<ReturnType<typeof startFixtureServer>>;
const capturer = new SiteCapturer();
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await capturer.close();
  await server.close();
});

describe('SiteCapturer (real Chromium)', () => {
  it('captures a full page at 2x and observes fonts, text boxes and footer credits', async () => {
    const out = mkdtempSync(join(tmpdir(), 'cap-'));
    const r = await capturer.capture(server.url('zinka.localhost'), { outDir: out });
    expect(existsSync(r.fullScreenshotPath)).toBe(true);
    expect(r.width).toBe(2880);
    expect(r.height).toBeGreaterThan(2000 * 2);
    expect(r.fonts.loadedFaces.map((f) => f.family)).toContain('pompei-block-fs');
    expect(r.fonts.usage.find((u) => u.family === 'pompei-block-fs')!.maxFontSize).toBe(72);
    expect(r.textBoxes.some((b) => b.tag === 'h1' && b.family === 'pompei-block-fs')).toBe(true);

    const matcher = new FontMatcher([{ id: 2, nameHe: 'פומפאי בלוק', nameEn: 'Pompei Block', slug: 'pompei-block', active: true, aliases: [] }]);
    const fonts = fontFindings(r.fonts, matcher);
    expect(fonts[0]).toMatchObject({ value: 'פומפאי בלוק', method: 'computed-style' });
    expect(fonts[0]!.confidence).toBeGreaterThanOrEqual(0.9);

    const credits = extractCredits({ footerText: r.footerText, links: r.links, pageUrl: r.finalUrl });
    expect(credits.find((c) => c.field === 'designer')).toMatchObject({ value: 'סטודיו לדוגמה', method: 'link' });
    expect(extractProjectName({ ogSiteName: r.meta.ogSiteName, title: r.title, applicationName: null })[0]!.value).toBe('Zinka');
  });

  it('reports HTTP errors instead of capturing an error page', async () => {
    const out = mkdtempSync(join(tmpdir(), 'cap-'));
    await expect(capturer.capture(server.url('missing.localhost'), { outDir: out })).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
