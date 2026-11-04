import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { FigmaBridge } from './index.js';
import { FakePlugin } from '../../../test/fixtures/fakePlugin.js';

let bridge: FigmaBridge | null = null;
afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

const start = async (port: number) => {
  bridge = new FigmaBridge({ port, token: '123456', appVersion: 'test', defaultTimeoutMs: 3000 });
  await bridge.start();
  return bridge;
};

describe('FigmaBridge', () => {
  it('accepts the plugin with the right token and round-trips requests and blobs', async () => {
    const b = await start(47901);
    const plugin = new FakePlugin(47901, '123456');
    expect((await plugin.connect()).accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.status().connected).toBe(true);
    expect(b.status().plugin?.fileKey).toBe('RMkG52OlYjXQ30TjFOIzmQ');
    const r = await b.request<{ templates: unknown[] }>('template.list', {});
    expect(r.templates).toHaveLength(2);
    // blob sent to plugin arrives intact
    const id = randomUUID();
    await b.request('inventory', {}, { blobs: [{ id, data: new Uint8Array([7, 8, 9]) }] });
    expect([...plugin.received.get(id)!]).toEqual([7, 8, 9]);
    plugin.close();
  });

  it('is reachable through "localhost" over IPv4 and IPv6 loopback', async () => {
    const b = await start(47905);
    const ipv6 = await new Promise<boolean>((r) => {
      const s = createServer().once('error', () => r(false)).listen(0, '::1', () => s.close(() => r(true)));
    });
    for (const host of ['localhost', '127.0.0.1', ...(ipv6 ? ['[::1]'] : [])]) {
      const plugin = new FakePlugin(47905, '123456', 'null', host);
      expect((await plugin.connect()).accepted, host).toBe(true);
      plugin.close();
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(b.status().listening).toBe(true);
  });

  it('plugin manifest only lists host names Figma accepts (no IP addresses)', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../apps/figma-plugin/manifest.json', import.meta.url), 'utf8'));
    for (const d of manifest.networkAccess.devAllowedDomains as string[]) {
      const u = new URL(d);
      expect(u.hostname).toBe('localhost');
      expect(u.port).toBe('47821');
    }
  });

  it('rejects a wrong pairing token', async () => {
    const b = await start(47902);
    const plugin = new FakePlugin(47902, '000000');
    const ack = await plugin.connect();
    expect(ack.accepted).toBe(false);
    expect(b.status().connected).toBe(false);
  });

  it('rejects connections from web pages (non-null origin)', async () => {
    await start(47903);
    const evil = new FakePlugin(47903, '123456', 'https://evil.example');
    const r = await evil.connect();
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/HTTP 40/);
  });

  it('fails pending requests when the plugin disconnects, and refuses when not connected', async () => {
    const b = await start(47904);
    await expect(b.request('ping', {})).rejects.toMatchObject({ code: 'FIGMA_DISCONNECTED' });
    const plugin = new FakePlugin(47904, '123456');
    await plugin.connect();
    await new Promise((r) => setTimeout(r, 50));
    const pending = b.request('ping', {}, { timeoutMs: 5000 }); // fake plugin answers ping with UNKNOWN_TYPE error after close…
    plugin.close();
    await expect(pending).rejects.toBeDefined();
  });
});
