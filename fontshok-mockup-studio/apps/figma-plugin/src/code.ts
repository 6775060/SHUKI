/**
 * FontShok Mockup Studio – Figma plugin (sandbox side).
 *
 * Rules enforced here:
 *  - Template frames (page "Templates", name tpl/<variant>/v<n>) are NEVER modified. They are only cloned.
 *  - Generated frames live on page "Output" and carry sharedPluginData fontshok.jobId.
 *  - Only layers named with the "@" prefix are touched on a clone; "#" layers are left untouched.
 *  - Text styles are sampled from the template; nothing typographic is hard-coded.
 */
import type {
  BuildRequest,
  BuildResult,
  DeleteRequest,
  Envelope,
  ExportRequest,
  ImageResult,
  InventoryItem,
  PreviewRequest,
  TemplateField,
  TemplateInfo,
  TemplateInspectRequest,
} from '@fontshok/shared/src/protocol';
import type { StyledText } from '@fontshok/shared/src/text';
import type { DynamicField, RGB, TemplateVariant } from '@fontshok/shared/src/types';

const PLUGIN_VERSION = '0.1.0';
const NS = 'fontshok';
const TEMPLATES_PAGE = 'Templates';
const OUTPUT_PAGE = 'Output';
const TEMPLATE_NAME = /^tpl\/(single|split|split-thin)\/v(\d+)$/;
const FIELDS: DynamicField[] = ['@headline', '@credits', '@shot.main', '@shot.secondary', '@gradient.bottom'];
const GRID_GAP = 200;

class PluginError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- messaging
type ToUi =
  | { kind: 'send'; env: Envelope }
  | { kind: 'sendBlob'; blobId: string; data: Uint8Array }
  | { kind: 'settings'; port: number; token: string }
  | { kind: 'hello'; payload: Omit<import('@fontshok/shared/src/protocol').HelloPayload, 'token'> };
type FromUi =
  | { kind: 'request'; env: Envelope }
  | { kind: 'blob'; blobId: string; data: Uint8Array }
  | { kind: 'saveSettings'; port: number; token: string }
  | { kind: 'needHello' }
  | { kind: 'close' };

const post = (m: ToUi) => figma.ui.postMessage(m);
const blobs = new Map<string, Uint8Array>();

figma.showUI(__html__, { width: 340, height: 460, themeColors: true });

figma.ui.onmessage = async (msg: FromUi) => {
  switch (msg.kind) {
    case 'blob':
      blobs.set(msg.blobId, msg.data);
      return;
    case 'saveSettings':
      await figma.clientStorage.setAsync('settings', { port: msg.port, token: msg.token });
      return;
    case 'needHello':
      post({ kind: 'hello', payload: await helloInfo() });
      return;
    case 'close':
      figma.closePlugin();
      return;
    case 'request':
      await handle(msg.env);
      return;
  }
};

(async () => {
  const s = (await figma.clientStorage.getAsync('settings')) as { port: number; token: string } | undefined;
  post({ kind: 'settings', port: s?.port ?? 47821, token: s?.token ?? '' });
})();

function reply(req: Envelope, payload: unknown) {
  post({ kind: 'send', env: { v: 1, id: req.id, type: 'result', jobId: req.jobId, payload } });
}
function replyError(req: Envelope, code: string, message: string) {
  post({ kind: 'send', env: { v: 1, id: req.id, type: 'error', jobId: req.jobId, payload: { code, message } } });
}
function progress(req: Envelope, step: string, ratio?: number) {
  post({ kind: 'send', env: { v: 1, id: req.id, type: 'progress', jobId: req.jobId, payload: { step, ratio } } });
}

async function handle(env: Envelope) {
  try {
    switch (env.type) {
      case 'ping':
        return reply(env, { pong: true, at: Date.now() });
      case 'template.list':
        return reply(env, { templates: await listTemplates() });
      case 'template.inspect':
        return reply(env, await inspectTemplate((env.payload as TemplateInspectRequest).templateNodeId));
      case 'mockup.build':
        return reply(env, await build(env, env.payload as BuildRequest));
      case 'mockup.preview':
        return reply(env, await exportFrame((env.payload as PreviewRequest).nodeId, (env.payload as PreviewRequest).scale, null));
      case 'mockup.export': {
        const p = env.payload as ExportRequest;
        return reply(env, await exportFrame(p.nodeId, p.scale, p.approvedFingerprint));
      }
      case 'mockup.delete':
        return reply(env, await deleteOutput((env.payload as DeleteRequest).nodeId));
      case 'inventory':
        return reply(env, { items: await inventory() });
      default:
        return replyError(env, 'UNKNOWN_TYPE', `unsupported request ${env.type}`);
    }
  } catch (e) {
    if (e instanceof PluginError) replyError(env, e.code, e.message);
    else replyError(env, 'FIGMA_ERROR', e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- pages & templates
async function getPage(name: string, create = false): Promise<PageNode> {
  let page = figma.root.children.find((p) => p.name === name);
  if (!page && create) {
    page = figma.createPage();
    page.name = name;
  }
  if (!page) throw new PluginError('NOT_FOUND', `page "${name}" not found`);
  await page.loadAsync();
  return page;
}

function templateFrames(page: PageNode): FrameNode[] {
  return page.children.filter((n): n is FrameNode => n.type === 'FRAME' && TEMPLATE_NAME.test(n.name));
}

function fieldNodes(frame: FrameNode): Map<DynamicField, SceneNode> {
  const map = new Map<DynamicField, SceneNode>();
  for (const child of frame.children) {
    if ((FIELDS as string[]).includes(child.name)) {
      if (map.has(child.name as DynamicField)) throw new PluginError('TEMPLATE_INVALID', `${frame.name}: duplicate field ${child.name}`);
      map.set(child.name as DynamicField, child);
    }
  }
  return map;
}

async function helloInfo() {
  const page = await getPage(TEMPLATES_PAGE).catch(() => null);
  const families = new Set<string>();
  if (page) {
    for (const f of templateFrames(page)) {
      for (const t of f.findAllWithCriteria({ types: ['TEXT'] })) {
        for (const s of t.getStyledTextSegments(['fontName'])) families.add(s.fontName.family);
      }
    }
  }
  const available = (await figma.listAvailableFontsAsync())
    .filter((f) => families.has(f.fontName.family))
    .map((f) => `${f.fontName.family}|${f.fontName.style}`);
  return { pluginVersion: PLUGIN_VERSION, fileKey: figma.fileKey ?? null, fileName: figma.root.name, availableFonts: available };
}

async function describe(frame: FrameNode): Promise<TemplateInfo> {
  const m = TEMPLATE_NAME.exec(frame.name);
  if (!m) throw new PluginError('TEMPLATE_INVALID', `not a template: ${frame.name}`);
  const nodes = fieldNodes(frame);
  for (const req of ['@headline', '@credits', '@shot.main', '@gradient.bottom'] as DynamicField[]) {
    if (!nodes.has(req)) throw new PluginError('TEMPLATE_INVALID', `${frame.name}: missing ${req}`);
  }
  const fields: TemplateField[] = [];
  for (const [field, n] of nodes) {
    const f: TemplateField = { field, nodeId: n.id, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height };
    if (n.type === 'TEXT') f.fonts = unique(n.getStyledTextSegments(['fontName']).map((s) => `${s.fontName.family}|${s.fontName.style}`));
    fields.push(f);
  }
  return {
    nodeId: frame.id,
    name: frame.name,
    variant: m[1] as TemplateVariant,
    version: Number(m[2]),
    width: frame.width,
    height: frame.height,
    fields,
    fingerprint: fingerprint(frame),
  };
}

async function listTemplates(): Promise<TemplateInfo[]> {
  const page = await getPage(TEMPLATES_PAGE);
  const out: TemplateInfo[] = [];
  for (const f of templateFrames(page)) out.push(await describe(f));
  return out;
}

async function inspectTemplate(id: string): Promise<TemplateInfo> {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.type !== 'FRAME') throw new PluginError('NOT_FOUND', `template ${id} not found`);
  return describe(node);
}

// ---------------------------------------------------------------- fingerprint
/** Deterministic hash of everything that affects rendering. Names are included so renames are detected too. */
function fingerprint(node: SceneNode): string {
  const parts: string[] = [];
  const r = (v: number) => Math.round(v * 100) / 100;
  const paints = (p: ReadonlyArray<Paint> | typeof figma.mixed) =>
    p === figma.mixed
      ? 'mixed'
      : p
          .map((x) => {
            if (x.type === 'SOLID') return `S${r(x.color.r)},${r(x.color.g)},${r(x.color.b)},${r(x.opacity ?? 1)},${x.visible !== false}`;
            if (x.type === 'IMAGE') return `I${x.imageHash},${x.scaleMode},${r(x.opacity ?? 1)}`;
            if (x.type.startsWith('GRADIENT')) {
              const g = x as GradientPaint;
              return `G${g.type}:${g.gradientStops.map((s) => `${r(s.position)}/${r(s.color.r)},${r(s.color.g)},${r(s.color.b)},${r(s.color.a)}`).join(';')}:${g.gradientTransform.flat().map(r).join(',')}`;
            }
            return x.type;
          })
          .join('|');
  const walk = (n: SceneNode, depth: number) => {
    const p: (string | number | boolean)[] = [depth, n.type, n.name, r(n.x), r(n.y), r(n.width), r(n.height), n.visible];
    if ('rotation' in n) p.push(r(n.rotation));
    if ('opacity' in n) p.push(r(n.opacity));
    if ('blendMode' in n) p.push(n.blendMode);
    if ('fills' in n) p.push(paints(n.fills as ReadonlyArray<Paint> | typeof figma.mixed));
    if ('strokes' in n) p.push(paints(n.strokes));
    if ('effects' in n) p.push(n.effects.map((e) => `${e.type}${e.visible}`).join(','));
    if ('cornerRadius' in n) p.push(n.cornerRadius === figma.mixed ? 'mixed' : r(Number(n.cornerRadius ?? 0)));
    if (n.type === 'TEXT') {
      p.push(n.characters);
      p.push(n.getStyledTextSegments(['fontName', 'fontSize']).map((s) => `${s.start}:${s.fontName.family}/${s.fontName.style}/${String(s.fontSize)}`).join(','));
    }
    parts.push(p.join('~'));
    if ('children' in n) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return hash(parts.join('\n'));
}

/** Two independent 32-bit FNV-1a passes → 16 hex chars. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- text
interface RunStyle {
  fontName: FontName;
  fontSize: number;
  fills: Paint[];
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
}

function styleAt(t: TextNode, index: number): RunStyle {
  const i = Math.max(0, Math.min(index, t.characters.length - 1));
  return {
    fontName: t.getRangeFontName(i, i + 1) as FontName,
    fontSize: t.getRangeFontSize(i, i + 1) as number,
    fills: t.getRangeFills(i, i + 1) as Paint[],
    lineHeight: t.getRangeLineHeight(i, i + 1) as LineHeight,
    letterSpacing: t.getRangeLetterSpacing(i, i + 1) as LetterSpacing,
  };
}

/** Headline: style of the first character of each line in the template. */
function headlineStyles(t: TextNode): Record<string, RunStyle> {
  const lines = t.characters.split('\n');
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const at = (k: number) => styleAt(t, starts[Math.min(k, starts.length - 1)] ?? 0);
  return { line1: at(0), line2: at(1), line3: at(2) };
}

/** Credits: label style = first character; value style = first segment whose font differs from the label. */
function creditStyles(t: TextNode): Record<string, RunStyle> {
  const label = styleAt(t, 0);
  const segs = t.getStyledTextSegments(['fontName']);
  const valueSeg = segs.find((s) => s.fontName.style !== label.fontName.style || s.fontName.family !== label.fontName.family);
  return { label, value: valueSeg ? styleAt(t, valueSeg.start) : label };
}

async function loadFonts(styles: RunStyle[]) {
  for (const s of styles) {
    try {
      await figma.loadFontAsync(s.fontName);
    } catch {
      throw new PluginError('FONT_MISSING', `font "${s.fontName.family} ${s.fontName.style}" is not installed on this computer`);
    }
  }
}

async function applyStyledText<R extends string>(t: TextNode, text: StyledText<R>, styles: Record<string, RunStyle>) {
  const all = Object.values(styles);
  // current fonts must be loaded before characters can change
  const current = unique(t.getStyledTextSegments(['fontName']).map((s) => JSON.stringify(s.fontName))).map((s) => JSON.parse(s) as FontName);
  for (const f of current) await figma.loadFontAsync(f).catch(() => undefined);
  await loadFonts(all);

  const origX = t.x;
  const origW = t.width;
  const align = t.textAlignHorizontal;
  const auto = t.textAutoResize;

  const full = text.runs.map((r) => r.text).join('');
  t.characters = full;
  let pos = 0;
  for (const run of text.runs) {
    const st = styles[run.role] ?? all[0]!;
    const end = pos + run.text.length;
    if (end > pos) {
      t.setRangeFontName(pos, end, st.fontName);
      t.setRangeFontSize(pos, end, st.fontSize);
      t.setRangeFills(pos, end, st.fills);
      t.setRangeLineHeight(pos, end, st.lineHeight);
      t.setRangeLetterSpacing(pos, end, st.letterSpacing);
    }
    pos = end;
  }
  // keep the visual anchor of auto-width text boxes
  if (auto === 'WIDTH_AND_HEIGHT') {
    if (align === 'CENTER') t.x = origX + (origW - t.width) / 2;
    else if (align === 'RIGHT') t.x = origX + origW - t.width;
  }
}

// ---------------------------------------------------------------- build
function setImage(node: SceneNode, blobId: string) {
  const bytes = blobs.get(blobId);
  if (!bytes) throw new PluginError('BLOB_MISSING', `image ${blobId} was not received`);
  blobs.delete(blobId);
  if (!('fills' in node)) throw new PluginError('TEMPLATE_INVALID', `${node.name} cannot hold an image`);
  const image = figma.createImage(bytes);
  const fills = (node.fills as ReadonlyArray<Paint>).slice();
  const idx = fills.findIndex((f) => f.type === 'IMAGE');
  const base: ImagePaint = idx >= 0 ? (fills[idx] as ImagePaint) : { type: 'IMAGE', scaleMode: 'FILL', imageHash: null };
  // Images are prepared at the slot's exact aspect ratio, so FILL reproduces the slot exactly.
  const next: ImagePaint = { type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL', opacity: base.opacity ?? 1, visible: base.visible ?? true, blendMode: base.blendMode ?? 'NORMAL', ...(base.filters ? { filters: base.filters } : {}) };
  if (idx >= 0) fills[idx] = next;
  else fills.push(next);
  (node as GeometryMixin).fills = fills;
}

function setGradient(node: SceneNode, color: RGB) {
  if (!('fills' in node)) throw new PluginError('TEMPLATE_INVALID', '@gradient.bottom has no fills');
  const fills = (node.fills as ReadonlyArray<Paint>).slice();
  const idx = fills.findIndex((f) => f.type.startsWith('GRADIENT'));
  if (idx < 0) throw new PluginError('TEMPLATE_INVALID', '@gradient.bottom has no gradient');
  const g = fills[idx] as GradientPaint;
  // replace only the opaque (brand) stop(s); positions, transparent stops and transform are untouched
  const maxA = Math.max(...g.gradientStops.map((s) => s.color.a));
  const stops = g.gradientStops.map((s) => (s.color.a === maxA ? { ...s, color: { r: color.r, g: color.g, b: color.b, a: s.color.a } } : s));
  fills[idx] = { ...g, gradientStops: stops };
  (node as GeometryMixin).fills = fills;
}

async function findByJobId(page: PageNode, jobId: string): Promise<FrameNode | null> {
  for (const n of page.children) {
    if (n.type === 'FRAME' && n.getSharedPluginData(NS, 'jobId') === jobId) return n;
  }
  return null;
}

async function build(env: Envelope, req: BuildRequest): Promise<BuildResult> {
  const jobId = env.jobId;
  if (!jobId) throw new PluginError('INVALID_INPUT', 'jobId is required');
  const tpl = await figma.getNodeByIdAsync(req.templateNodeId);
  if (!tpl || tpl.type !== 'FRAME' || !TEMPLATE_NAME.test(tpl.name)) throw new PluginError('NOT_FOUND', 'template not found');
  if (tpl.parent?.type !== 'PAGE' || tpl.parent.name !== TEMPLATES_PAGE) throw new PluginError('TEMPLATE_INVALID', 'template must live on the Templates page');
  const before = fingerprint(tpl);
  if (before !== req.expectedTemplateFingerprint) throw new PluginError('TEMPLATE_CHANGED', `template ${tpl.name} changed since it was registered`);

  const out = await getPage(OUTPUT_PAGE, true);
  // idempotent: one frame per job – a rebuild replaces the previous frame
  const previous = await findByJobId(out, jobId);
  if (previous) previous.remove();

  progress(env, 'clone');
  const frame = tpl.clone();
  out.appendChild(frame);
  frame.name = req.frameName;
  frame.x = req.position.column * (tpl.width + GRID_GAP);
  frame.y = req.position.row * (tpl.height + GRID_GAP);
  frame.locked = false;
  frame.setSharedPluginData(NS, 'jobId', jobId);
  frame.setSharedPluginData(NS, 'template', tpl.name);
  frame.setSharedPluginData(NS, 'templateFingerprint', before);

  const warnings: string[] = [];
  try {
    const nodes = fieldNodes(frame);
    const tplNodes = fieldNodes(tpl);
    const headline = nodes.get('@headline') as TextNode;
    const credits = nodes.get('@credits') as TextNode;

    progress(env, 'text');
    await applyStyledText(headline, req.headline, headlineStyles(tplNodes.get('@headline') as TextNode));
    await applyStyledText(credits, req.credits, creditStyles(tplNodes.get('@credits') as TextNode));

    progress(env, 'images');
    setImage(nodes.get('@shot.main')!, req.mainImageBlobId);
    const secondary = nodes.get('@shot.secondary');
    if (secondary) {
      if (req.secondaryImageBlobId) setImage(secondary, req.secondaryImageBlobId);
      else secondary.visible = false;
    } else if (req.secondaryImageBlobId) {
      warnings.push('template has no @shot.secondary – secondary screenshot ignored');
      blobs.delete(req.secondaryImageBlobId);
    }

    progress(env, 'gradient');
    setGradient(nodes.get('@gradient.bottom')!, req.gradientColor);
  } catch (e) {
    frame.remove();
    throw e;
  }

  // source protection: the template must be byte-for-byte what it was
  if (fingerprint(tpl) !== before) throw new PluginError('TEMPLATE_CHANGED', 'template was modified during build – aborting');

  const m = (n: SceneNode) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
  const nodes = fieldNodes(frame);
  return {
    nodeId: frame.id,
    fingerprint: fingerprint(frame),
    warnings,
    measurements: { '@headline': m(nodes.get('@headline')!), '@credits': m(nodes.get('@credits')!) },
  };
}

// ---------------------------------------------------------------- export / delete / inventory
async function outputFrame(nodeId: string): Promise<FrameNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== 'FRAME') throw new PluginError('NOT_FOUND', `frame ${nodeId} not found`);
  if (node.parent?.type !== 'PAGE' || node.parent.name !== OUTPUT_PAGE || !node.getSharedPluginData(NS, 'jobId')) {
    throw new PluginError('FORBIDDEN', 'only generated frames on the Output page can be exported or deleted');
  }
  return node;
}

async function exportFrame(nodeId: string, scale: number, approvedFingerprint: string | null): Promise<ImageResult> {
  const frame = await outputFrame(nodeId);
  const fp = fingerprint(frame);
  if (approvedFingerprint !== null && fp !== approvedFingerprint) {
    throw new PluginError('CHANGED_SINCE_APPROVAL', 'the frame was edited after approval – review and approve it again');
  }
  const bytes = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true });
  const blobId = uuid();
  post({ kind: 'sendBlob', blobId, data: bytes });
  return { blobId, fingerprint: fp, width: Math.round(frame.width * scale), height: Math.round(frame.height * scale) };
}

async function deleteOutput(nodeId: string) {
  const frame = await outputFrame(nodeId);
  frame.remove();
  return { deleted: true };
}

async function inventory(): Promise<InventoryItem[]> {
  const out = await getPage(OUTPUT_PAGE, true);
  return out.children
    .filter((n): n is FrameNode => n.type === 'FRAME')
    .map((n) => ({ nodeId: n.id, name: n.name, jobId: n.getSharedPluginData(NS, 'jobId') || null }));
}

// ---------------------------------------------------------------- utils
function unique<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}
function uuid(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}
