// Starts the installed app on Windows: makes sure the background server is
// running, then opens the interface in its own app window (Edge or Chrome
// in --app mode). Run hidden through launch.vbs, so no console appears.
//
//   launcher.mjs              start (if needed) and open the window
//   launcher.mjs --background start only (used at Windows startup)
//   launcher.mjs --stop       stop the background server

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const port = 4870;
const url = `http://127.0.0.1:${port}`;
const dataDir = path.join(process.env.APPDATA ?? here, 'ShefaUBehirut');
const args = new Set(process.argv.slice(2));

function findBrowser() {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function isUp() {
  try {
    const r = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function stop() {
  // Only when our server answers, so a stale pid never hits another process.
  if (!(await isUp())) return;
  try {
    const pid = Number(fs.readFileSync(path.join(dataDir, 'shefa.pid'), 'utf8'));
    if (pid) process.kill(pid);
  } catch {
    /* not running */
  }
}

async function startServer(browser) {
  if (await isUp()) return true;
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const log = fs.openSync(path.join(dataDir, 'logs', 'server.log'), 'a');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'app', 'server.mjs')], {
    cwd: path.join(here, 'app'),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      SHEFA_WEB_DIST: path.join(here, 'web'),
      // The bank scrapers drive a browser; use the one already on this computer.
      ...(browser && !process.env.SHEFA_CHROME_PATH ? { SHEFA_CHROME_PATH: browser } : {}),
    },
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isUp()) return true;
  }
  return false;
}

function openWindow(browser) {
  if (browser) {
    spawn(browser, [`--app=${url}`, `--user-data-dir=${path.join(process.env.LOCALAPPDATA ?? dataDir, 'ShefaUBehirut', 'window')}`, '--no-first-run'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

if (args.has('--stop')) {
  await stop();
} else {
  const browser = findBrowser();
  const ok = await startServer(browser);
  if (!args.has('--background')) {
    if (ok) openWindow(browser);
    else spawn('notepad', [path.join(dataDir, 'logs', 'server.log')], { detached: true, stdio: 'ignore' }).unref();
  }
}
