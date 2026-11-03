/**
 * Desktop app <-> Figma plugin protocol (v1).
 *
 * Transport: WebSocket on 127.0.0.1. The plugin UI iframe is the client; the desktop app is the server.
 * - Text frames carry JSON `Envelope`s.
 * - Binary frames carry image bytes: [36 ASCII bytes blobId (UUID)] + [payload bytes].
 *   A blob is always sent BEFORE the JSON message that references it.
 *
 * Every request gets exactly one `result` or `error` with the same `id`.
 * The plugin may send `progress` messages in between.
 */
import { z } from 'zod';
import type { CreditRole, HeadlineRole, StyledText } from './text.js';
import type { DynamicField, RGB, TemplateVariant } from './types.js';

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_WS_PORT = 47821;
export const BLOB_ID_LENGTH = 36;

export type RequestType =
  | 'template.list'
  | 'template.inspect'
  | 'mockup.build'
  | 'mockup.preview'
  | 'mockup.export'
  | 'mockup.delete'
  | 'inventory'
  | 'ping';

export type PluginEventType = 'hello' | 'result' | 'error' | 'progress' | 'pong';

export interface Envelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  id: string;
  type: RequestType | PluginEventType | 'hello.ack';
  jobId?: string;
  payload: T;
}

// ---------- payloads ----------

export interface HelloPayload {
  pluginVersion: string;
  fileKey: string | null;
  fileName: string;
  token: string;
  /** "Family|Style" strings available to Figma on this machine (used to block builds with missing fonts). */
  availableFonts: string[];
}

export interface HelloAckPayload {
  accepted: boolean;
  appVersion: string;
  reason?: string;
}

export interface TemplateField {
  field: DynamicField;
  nodeId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fonts used inside the field, "Family|Style". */
  fonts?: string[];
}

export interface TemplateInfo {
  nodeId: string;
  name: string; // tpl/<variant>/v<version>
  variant: TemplateVariant;
  version: number;
  width: number;
  height: number;
  fields: TemplateField[];
  fingerprint: string;
}

export interface TemplateInspectRequest {
  templateNodeId: string;
}

export interface BuildRequest {
  templateNodeId: string;
  /** Fingerprint recorded in the DB; the plugin refuses to build if the template changed. */
  expectedTemplateFingerprint: string;
  frameName: string;
  headline: StyledText<HeadlineRole>;
  credits: StyledText<CreditRole>;
  gradientColor: RGB;
  mainImageBlobId: string;
  /** null => the secondary layer is hidden. */
  secondaryImageBlobId: string | null;
  /** Position in the Output page grid. */
  position: { column: number; row: number };
}

export interface BuildResult {
  nodeId: string;
  fingerprint: string;
  warnings: string[];
  /** Measured text boxes after replacement, for overflow validation on the app side. */
  measurements: Record<'@headline' | '@credits', { width: number; height: number; x: number; y: number }>;
}

export interface PreviewRequest {
  nodeId: string;
  scale: number;
}

export interface ExportRequest {
  nodeId: string;
  scale: number;
  /** Fingerprint of the frame at approval time. Export is refused if the frame changed since. */
  approvedFingerprint: string;
}

export interface ImageResult {
  blobId: string;
  fingerprint: string;
  width: number;
  height: number;
}

export interface DeleteRequest {
  nodeId: string;
}

export interface InventoryItem {
  nodeId: string;
  name: string;
  jobId: string | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ProgressPayload {
  step: string;
  ratio?: number;
}

// ---------- runtime validation (app side) ----------

export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: z.string(),
  jobId: z.string().optional(),
  payload: z.unknown(),
});

export const helloSchema = z.object({
  pluginVersion: z.string(),
  fileKey: z.string().nullable(),
  fileName: z.string(),
  token: z.string(),
  availableFonts: z.array(z.string()),
});

export const errorPayloadSchema = z.object({ code: z.string(), message: z.string() });

export function encodeBlob(blobId: string, data: Uint8Array): Uint8Array {
  if (blobId.length !== BLOB_ID_LENGTH) throw new Error('blobId must be a 36 char UUID');
  const out = new Uint8Array(BLOB_ID_LENGTH + data.length);
  for (let i = 0; i < BLOB_ID_LENGTH; i++) out[i] = blobId.charCodeAt(i);
  out.set(data, BLOB_ID_LENGTH);
  return out;
}

export function decodeBlob(frame: Uint8Array): { blobId: string; data: Uint8Array } {
  if (frame.length < BLOB_ID_LENGTH) throw new Error('binary frame too short');
  let blobId = '';
  for (let i = 0; i < BLOB_ID_LENGTH; i++) blobId += String.fromCharCode(frame[i]!);
  return { blobId, data: frame.subarray(BLOB_ID_LENGTH) };
}
