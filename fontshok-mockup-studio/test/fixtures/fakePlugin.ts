/**
 * A fake Figma plugin that speaks the real WebSocket protocol, used to test the desktop side
 * end-to-end without Figma. It mimics the plugin's guarantees (template fingerprint check,
 * approved-fingerprint check on export, one frame per jobId).
 */
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import WebSocket from 'ws';
import { decodeBlob, encodeBlob, plainText, type BuildRequest, type Envelope, type TemplateInfo } from '@fontshok/shared';

export const FAKE_TEMPLATES: TemplateInfo[] = [
  {
    nodeId: '2004:4', name: 'tpl/single/v1', variant: 'single', version: 1, width: 1080, height: 1350, fingerprint: 'tpl-single-fp',
    fields: [
      { field: '@gradient.bottom', nodeId: '2004:6', type: 'RECTANGLE', x: 0, y: 1028, width: 1080, height: 322 },
      { field: '@headline', nodeId: '2004:7', type: 'TEXT', x: 206, y: 67, width: 669, height: 174 },
      { field: '@credits', nodeId: '2004:8', type: 'TEXT', x: 618, y: 1119, width: 381, height: 156 },
      { field: '@shot.main', nodeId: '2004:11', type: 'RECTANGLE', x: 41, y: 305, width: 998, height: 635 },
    ],
  },
  {
    nodeId: '2004:12', name: 'tpl/split/v1', variant: 'split', version: 1, width: 1080, height: 1350, fingerprint: 'tpl-split-fp',
    fields: [
      { field: '@headline', nodeId: '2004:14', type: 'TEXT', x: 227, y: 67, width: 626, height: 174 },
      { field: '@shot.main', nodeId: '2004:15', type: 'RECTANGLE', x: 43, y: 307, width: 995, height: 631 },
      { field: '@credits', nodeId: '2004:16', type: 'TEXT', x: 731, y: 1119, width: 257, height: 156 },
      { field: '@gradient.bottom', nodeId: '2004:17', type: 'RECTANGLE', x: 0, y: 1028, width: 1080, height: 322 },
      { field: '@shot.secondary', nodeId: '2004:20', type: 'RECTANGLE', x: 43, y: 675, width: 995, height: 263 },
    ],
  },
];

export class FakePlugin {
  ws!: WebSocket;
  readonly frames = new Map<string, { jobId: string; fingerprint: string; req: BuildRequest; images: { w: number; h: number }[] }>();
  readonly received = new Map<string, Uint8Array>();
  templateFingerprintOverride: string | null = null;
  private nextNode = 100;
  log: string[] = [];

  constructor(private readonly port: number, private readonly token: string, private readonly origin = 'null', private readonly host = '127.0.0.1') {}

  connect(): Promise<{ accepted: boolean; reason?: string }> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${this.host}:${this.port}`, { origin: this.origin });
      this.ws.on('error', reject);
      this.ws.on('unexpected-response', (_req, res) => resolve({ accepted: false, reason: `HTTP ${res.statusCode}` }));
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ v: 1, id: 'hello-1', type: 'hello', payload: { pluginVersion: 'test', fileKey: 'RMkG52OlYjXQ30TjFOIzmQ', fileName: 'Test file', token: this.token, availableFonts: ['Sprinter_FS|Regular'] } }));
      });
      this.ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const { blobId, data: bytes } = decodeBlob(new Uint8Array(data as Buffer));
          this.received.set(blobId, bytes);
          return;
        }
        const env = JSON.parse(String(data)) as Envelope;
        if (env.type === 'hello.ack') return resolve(env.payload as { accepted: boolean; reason?: string });
        void this.handle(env);
      });
    });
  }

  close() {
    this.ws.close();
  }

  private send(env: Envelope) {
    this.ws.send(JSON.stringify(env));
  }

  private async png(w: number, h: number, label: string): Promise<Uint8Array> {
    const hue = parseInt(createHash('md5').update(label).digest('hex').slice(0, 6), 16);
    return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: hue & 255, g: (hue >> 8) & 255, b: (hue >> 16) & 255 } } }).png().toBuffer());
  }

  private async handle(env: Envelope) {
    this.log.push(env.type);
    const reply = (payload: unknown) => this.send({ v: 1, id: env.id, type: 'result', jobId: env.jobId, payload });
    const error = (code: string, message: string) => this.send({ v: 1, id: env.id, type: 'error', jobId: env.jobId, payload: { code, message } });
    const tpl = (id: string) => {
      const t = FAKE_TEMPLATES.find((x) => x.nodeId === id)!;
      return { ...t, fingerprint: this.templateFingerprintOverride ?? t.fingerprint };
    };
    switch (env.type) {
      case 'template.list':
        return reply({ templates: FAKE_TEMPLATES.map((t) => tpl(t.nodeId)) });
      case 'template.inspect':
        return reply(tpl((env.payload as { templateNodeId: string }).templateNodeId));
      case 'inventory':
        return reply({ items: [...this.frames.entries()].map(([nodeId, f]) => ({ nodeId, name: f.req.frameName, jobId: f.jobId })) });
      case 'mockup.build': {
        const req = env.payload as BuildRequest;
        const t = tpl(req.templateNodeId);
        if (t.fingerprint !== req.expectedTemplateFingerprint) return error('TEMPLATE_CHANGED', 'template changed');
        const main = this.received.get(req.mainImageBlobId);
        if (!main) return error('BLOB_MISSING', 'main image missing');
        const images = [await sharp(Buffer.from(main)).metadata()].map((m) => ({ w: m.width!, h: m.height! }));
        if (req.secondaryImageBlobId) {
          const s = this.received.get(req.secondaryImageBlobId);
          if (!s) return error('BLOB_MISSING', 'secondary image missing');
          const m = await sharp(Buffer.from(s)).metadata();
          images.push({ w: m.width!, h: m.height! });
        }
        for (const [id, f] of this.frames) if (f.jobId === env.jobId) this.frames.delete(id);
        const nodeId = `9:${this.nextNode++}`;
        const fp = createHash('sha1').update(JSON.stringify(req.headline) + JSON.stringify(req.credits) + JSON.stringify(req.gradientColor)).digest('hex').slice(0, 16);
        this.frames.set(nodeId, { jobId: env.jobId!, fingerprint: fp, req, images });
        const f = (name: string) => t.fields.find((x) => x.field === name)!;
        const lines = plainText(req.headline).split('\n').length;
        return reply({
          nodeId, fingerprint: fp, warnings: [],
          measurements: {
            '@headline': { x: f('@headline').x, y: f('@headline').y, width: f('@headline').width, height: (f('@headline').height / 3) * lines },
            '@credits': { x: f('@credits').x, y: f('@credits').y, width: f('@credits').width, height: f('@credits').height },
          },
        });
      }
      case 'mockup.preview':
      case 'mockup.export': {
        const p = env.payload as { nodeId: string; scale: number; approvedFingerprint?: string };
        const frame = this.frames.get(p.nodeId);
        if (!frame) return error('NOT_FOUND', 'frame not found');
        if (env.type === 'mockup.export' && p.approvedFingerprint !== frame.fingerprint) return error('CHANGED_SINCE_APPROVAL', 'changed');
        const blobId = randomUUID();
        const bytes = await this.png(Math.round(1080 * p.scale), Math.round(1350 * p.scale), frame.req.frameName);
        this.ws.send(encodeBlob(blobId, bytes));
        return reply({ blobId, fingerprint: frame.fingerprint, width: 1080 * p.scale, height: 1350 * p.scale });
      }
      case 'mockup.delete':
        this.frames.delete((env.payload as { nodeId: string }).nodeId);
        return reply({ deleted: true });
      default:
        return error('UNKNOWN_TYPE', env.type);
    }
  }
}
