import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getMeta, setMeta, type DB } from './db.js';

// Phone access through Tailscale Serve: Tailscale gives the computer a private
// HTTPS address that only the user's own devices can reach, and forwards it to
// this server on localhost. Nothing listens on the home network.

export interface RemoteStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  url: string | null;
  error?: string;
}

function tailscaleBin(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe'), path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe')]
      : ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function run(bin: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
  });
}

async function selfName(bin: string): Promise<{ running: boolean; dnsName: string | null }> {
  const r = await run(bin, ['status', '--json']);
  if (!r.ok) return { running: false, dnsName: null };
  try {
    const s = JSON.parse(r.out.slice(r.out.indexOf('{'))) as { BackendState?: string; Self?: { DNSName?: string } };
    return { running: s.BackendState === 'Running', dnsName: s.Self?.DNSName?.replace(/\.$/, '').toLowerCase() || null };
  } catch {
    return { running: false, dnsName: null };
  }
}

export function remoteHost(db: DB): string | null {
  return getMeta(db, 'remote_host') ?? null;
}

export async function remoteStatus(db: DB): Promise<RemoteStatus> {
  const host = remoteHost(db);
  const bin = tailscaleBin();
  if (!bin) return { installed: false, running: false, enabled: !!host, url: host ? `https://${host}` : null };
  const self = await selfName(bin);
  return { installed: true, running: self.running, enabled: !!host, url: host ? `https://${host}` : null };
}

export async function enableRemote(db: DB, port: number): Promise<RemoteStatus> {
  const bin = tailscaleBin();
  if (!bin) return { installed: false, running: false, enabled: false, url: null, error: 'NOT_INSTALLED' };
  const self = await selfName(bin);
  if (!self.running || !self.dnsName) return { installed: true, running: false, enabled: false, url: null, error: 'NOT_RUNNING' };
  // The host goes on the allow-list before the tunnel opens, so the first request works.
  setMeta(db, 'remote_host', self.dnsName);
  const r = await run(bin, ['serve', '--bg', String(port)]);
  if (!r.ok) {
    db.prepare("DELETE FROM meta WHERE key = 'remote_host'").run();
    // First use asks to turn on HTTPS for the tailnet; the CLI prints the link.
    return { installed: true, running: true, enabled: false, url: null, error: r.out.slice(0, 600) || 'SERVE_FAILED' };
  }
  return { installed: true, running: true, enabled: true, url: `https://${self.dnsName}` };
}

export async function disableRemote(db: DB): Promise<RemoteStatus> {
  const bin = tailscaleBin();
  if (bin) await run(bin, ['serve', '--https=443', 'off']);
  db.prepare("DELETE FROM meta WHERE key = 'remote_host'").run();
  return remoteStatus(db);
}
