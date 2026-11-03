/**
 * Local WebSocket server for the Figma plugin (see shared/protocol.ts).
 * Security:
 *  - binds to the loopback interface only (127.0.0.1 and ::1)
 *  - only accepts the Figma plugin iframe origin ("null") – random web pages cannot connect
 *  - the plugin must present the pairing token in `hello`
 *  - one plugin connection at a time
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  AppError,
  PROTOCOL_VERSION,
  decodeBlob,
  encodeBlob,
  envelopeSchema,
  errorPayloadSchema,
  helloSchema,
  type Envelope,
  type HelloPayload,
  type ProgressPayload,
  type RequestType,
} from '@fontshok/shared';

export interface BridgeOptions {
  port: number;
  /** Pairing token, or a getter so the token can change without restarting the server. */
  token: string | (() => string);
  appVersion: string;
  host?: string;
  defaultTimeoutMs?: number;
  /** Extra origins to accept (tests). The Figma plugin iframe uses "null". */
  allowedOrigins?: string[];
}

export interface BridgeStatus {
  listening: boolean;
  connected: boolean;
  plugin: Omit<HelloPayload, 'token'> | null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  type: RequestType;
}

export class FigmaBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private plugin: HelloPayload | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly blobs = new Map<string, Uint8Array>();

  constructor(private readonly opts: BridgeOptions) {
    super();
  }

  status(): BridgeStatus {
    const p = this.plugin;
    return {
      listening: !!this.wss,
      connected: !!this.socket && !!p,
      plugin: p ? { pluginVersion: p.pluginVersion, fileKey: p.fileKey, fileName: p.fileName, availableFonts: p.availableFonts } : null,
    };
  }

  /** IPv6 loopback listener: on Windows "localhost" may resolve to ::1 first. */
  private wss6: WebSocketServer | null = null;

  start(): Promise<void> {
    const allowed = new Set(['null', ...(this.opts.allowedOrigins ?? [])]);
    const listen = (host: string) =>
      new Promise<WebSocketServer>((resolve, reject) => {
        const wss = new WebSocketServer({
          host,
          port: this.opts.port,
          maxPayload: 64 * 1024 * 1024,
          verifyClient: (info: { origin: string }) => allowed.has(info.origin ?? 'null'),
        });
        wss.once('listening', () => resolve(wss));
        wss.once('error', reject);
        wss.on('connection', (ws) => this.onConnection(ws));
      });
    return (async () => {
      this.wss = await listen(this.opts.host ?? '127.0.0.1');
      if (!this.opts.host) {
        // best effort: IPv6 may be disabled on this computer
        this.wss6 = await listen('::1').catch(() => null);
      }
    })();
  }

  async stop(): Promise<void> {
    this.failAll(new AppError('FIGMA_DISCONNECTED', 'bridge stopped'));
    this.socket?.close();
    for (const w of [this.wss, this.wss6]) await new Promise<void>((r) => (w ? w.close(() => r()) : r()));
    this.wss = null;
    this.wss6 = null;
  }

  private onConnection(ws: WebSocket) {
    let authed = false;
    const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), 10000);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (!authed) return;
        const buf = data instanceof Buffer ? data : Buffer.concat(data as Buffer[]);
        const { blobId, data: bytes } = decodeBlob(new Uint8Array(buf));
        this.blobs.set(blobId, bytes);
        return;
      }
      let env: Envelope;
      try {
        env = envelopeSchema.parse(JSON.parse(data.toString())) as Envelope;
      } catch {
        ws.close(4002, 'bad message');
        return;
      }
      if (!authed) {
        if (env.type !== 'hello') return void ws.close(4003, 'hello expected');
        const hello = helloSchema.safeParse(env.payload);
        const expected = typeof this.opts.token === 'function' ? this.opts.token() : this.opts.token;
        if (!hello.success || !expected || hello.data.token !== expected) {
          this.sendTo(ws, { v: PROTOCOL_VERSION, id: env.id, type: 'hello.ack', payload: { accepted: false, appVersion: this.opts.appVersion, reason: 'invalid pairing token' } });
          return void ws.close(4004, 'unauthorised');
        }
        clearTimeout(helloTimer);
        authed = true;
        if (this.socket && this.socket !== ws) this.socket.close(4005, 'replaced by a newer plugin connection');
        this.socket = ws;
        this.plugin = hello.data;
        this.sendTo(ws, { v: PROTOCOL_VERSION, id: env.id, type: 'hello.ack', payload: { accepted: true, appVersion: this.opts.appVersion } });
        this.emit('connected', this.status());
        return;
      }
      this.onEnvelope(env);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (this.socket === ws) {
        this.socket = null;
        this.plugin = null;
        this.failAll(new AppError('FIGMA_DISCONNECTED', 'Figma plugin disconnected'));
        this.emit('disconnected');
      }
    });
    ws.on('error', () => undefined);
  }

  private onEnvelope(env: Envelope) {
    if (env.type === 'progress') {
      this.emit('progress', { id: env.id, jobId: env.jobId, ...(env.payload as ProgressPayload) });
      return;
    }
    const p = this.pending.get(env.id);
    if (!p) return;
    this.pending.delete(env.id);
    clearTimeout(p.timer);
    if (env.type === 'error') {
      const e = errorPayloadSchema.safeParse(env.payload);
      p.reject(new AppError(e.success && e.data.code === 'TEMPLATE_CHANGED' ? 'TEMPLATE_CHANGED' : e.success && e.data.code === 'FONT_MISSING' ? 'FONT_MISSING' : 'FIGMA_ERROR', e.success ? e.data.message : 'unknown plugin error', env.payload));
    } else p.resolve(env.payload);
  }

  private failAll(e: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
      this.pending.delete(id);
    }
  }

  private sendTo(ws: WebSocket, env: Envelope) {
    ws.send(JSON.stringify(env));
  }

  /** Takes (and forgets) a blob the plugin sent, e.g. an exported PNG. */
  takeBlob(blobId: string): Uint8Array {
    const b = this.blobs.get(blobId);
    if (!b) throw new AppError('FIGMA_ERROR', `blob ${blobId} not received`);
    this.blobs.delete(blobId);
    return b;
  }

  async request<TRes>(type: RequestType, payload: unknown, opts: { jobId?: string; blobs?: { id: string; data: Uint8Array }[]; timeoutMs?: number } = {}): Promise<TRes> {
    const ws = this.socket;
    if (!ws || !this.plugin) throw new AppError('FIGMA_DISCONNECTED', 'Figma plugin is not connected. Open Figma Desktop and run the FontShok plugin.');
    for (const b of opts.blobs ?? []) ws.send(encodeBlob(b.id, b.data));
    const id = randomUUID();
    const timeoutMs = opts.timeoutMs ?? this.opts.defaultTimeoutMs ?? 30000;
    const result = new Promise<TRes>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError('TIMEOUT', `${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, type });
    });
    const env: Envelope = { v: PROTOCOL_VERSION, id, type, payload, ...(opts.jobId ? { jobId: opts.jobId } : {}) };
    ws.send(JSON.stringify(env));
    return result;
  }

  /** Request with retries for idempotent operations only (never used for export). */
  async requestWithRetry<TRes>(type: RequestType, payload: unknown, opts: Parameters<FigmaBridge['request']>[2] & { retries?: number } = {}): Promise<TRes> {
    const retries = opts.retries ?? 2;
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.request<TRes>(type, payload, opts);
      } catch (e) {
        last = e;
        if (!(e instanceof AppError) || !['TIMEOUT', 'FIGMA_DISCONNECTED'].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw last;
  }
}

export function newBlobId(): string {
  return randomUUID();
}
