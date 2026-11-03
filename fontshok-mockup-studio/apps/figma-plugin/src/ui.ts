/**
 * Plugin UI iframe: owns the WebSocket to the desktop app and relays messages to the sandbox.
 * Reconnects automatically with exponential backoff while "connected" mode is on.
 */
import type { Envelope, HelloPayload } from '@fontshok/shared/src/protocol';

const BLOB_ID_LENGTH = 36;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tokenEl = $<HTMLInputElement>('token');
const portEl = $<HTMLInputElement>('port');
const stateEl = $('state');
const dotEl = $('dot');
const logEl = $('log');

let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let retryTimer: number | undefined;
let pendingHello: ((p: Omit<HelloPayload, 'token'>) => void) | null = null;

const log = (s: string) => {
  const line = `${new Date().toLocaleTimeString()} ${s}\n`;
  logEl.textContent = (line + (logEl.textContent ?? '')).slice(0, 6000);
};
const setState = (text: string, on: boolean) => {
  stateEl.textContent = text;
  dotEl.classList.toggle('on', on);
};
const toMain = (m: unknown) => parent.postMessage({ pluginMessage: m }, '*');

function hosts(port: string) {
  return [`ws://127.0.0.1:${port}`, `ws://localhost:${port}`];
}

function connect(hostIndex = 0) {
  const token = tokenEl.value.trim();
  const port = portEl.value.trim() || '47821';
  if (!token) return setState('יש להזין קוד חיבור', false);
  toMain({ kind: 'saveSettings', port: Number(port), token });
  const url = hosts(port)[hostIndex % 2]!;
  setState('מתחבר…', false);
  const sock = new WebSocket(url);
  sock.binaryType = 'arraybuffer';
  ws = sock;
  sock.onopen = async () => {
    retry = 0;
    const info = await new Promise<Omit<HelloPayload, 'token'>>((resolve) => {
      pendingHello = resolve;
      toMain({ kind: 'needHello' });
    });
    const env: Envelope<HelloPayload> = { v: 1, id: `hello-${Date.now()}`, type: 'hello', payload: { ...info, token } };
    sock.send(JSON.stringify(env));
  };
  sock.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(ev.data);
      let blobId = '';
      for (let i = 0; i < BLOB_ID_LENGTH; i++) blobId += String.fromCharCode(bytes[i]!);
      toMain({ kind: 'blob', blobId, data: bytes.slice(BLOB_ID_LENGTH) });
      return;
    }
    const env = JSON.parse(String(ev.data)) as Envelope;
    if (env.type === 'hello.ack') {
      const p = env.payload as { accepted: boolean; reason?: string; appVersion: string };
      if (p.accepted) {
        setState(`מחובר לאפליקציה (v${p.appVersion})`, true);
        log('connected');
      } else {
        wanted = false;
        setState(`החיבור נדחה: ${p.reason ?? ''}`, false);
      }
      return;
    }
    log(`← ${env.type}`);
    toMain({ kind: 'request', env });
  };
  sock.onclose = (ev) => {
    if (ws === sock) ws = null;
    setState(`מנותק${ev.reason ? ` (${ev.reason})` : ''}`, false);
    if (wanted && ev.code !== 4004) {
      const delay = Math.min(15000, 1000 * 2 ** retry++);
      retryTimer = window.setTimeout(() => connect(hostIndex + 1), delay);
    }
  };
  sock.onerror = () => log(`error connecting to ${url}`);
}

window.onmessage = (ev: MessageEvent) => {
  const m = ev.data?.pluginMessage;
  if (!m) return;
  switch (m.kind) {
    case 'settings':
      portEl.value = String(m.port);
      tokenEl.value = m.token;
      if (m.token) {
        wanted = true;
        connect();
      }
      break;
    case 'hello':
      pendingHello?.(m.payload);
      pendingHello = null;
      break;
    case 'send':
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(m.env));
        if (m.env.type !== 'progress') log(`→ ${m.env.type}`);
      }
      break;
    case 'sendBlob': {
      if (ws?.readyState !== WebSocket.OPEN) break;
      const data = m.data as Uint8Array;
      const frame = new Uint8Array(BLOB_ID_LENGTH + data.length);
      for (let i = 0; i < BLOB_ID_LENGTH; i++) frame[i] = (m.blobId as string).charCodeAt(i);
      frame.set(data, BLOB_ID_LENGTH);
      ws.send(frame);
      break;
    }
  }
};

$('connect').onclick = () => {
  wanted = true;
  retry = 0;
  window.clearTimeout(retryTimer);
  ws?.close();
  connect();
};
$('disconnect').onclick = () => {
  wanted = false;
  window.clearTimeout(retryTimer);
  ws?.close();
};
