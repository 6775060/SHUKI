/** Domain types shared by every module. */

export interface RGB {
  r: number; // 0..1
  g: number;
  b: number;
}

export interface FontFamily {
  id: number;
  nameHe: string;
  nameEn: string | null;
  slug: string;
  active: boolean;
  aliases: FontAlias[];
}

export type AliasKind = 'css-family' | 'file-name' | 'he' | 'en' | 'typo' | 'former-name';

export interface FontAlias {
  id: number;
  familyId: number;
  alias: string;
  kind: AliasKind;
}

export type FindingField = 'font' | 'project_name' | 'designer' | 'developer' | 'source_url' | 'site_type' | 'brand_color';

export type FindingMethod =
  | 'font-face'
  | 'computed-style'
  | 'footer-text'
  | 'link'
  | 'meta'
  | 'title'
  | 'pixel-sampling'
  | 'manual';

export type FindingStatus = 'suggested' | 'confirmed' | 'rejected';

/** Everything extracted from a website must carry evidence. Nothing is invented. */
export interface Evidence {
  /** Short human-readable description of where the value came from. */
  source: string;
  /** Raw text/snippet exactly as found. */
  snippet?: string;
  selector?: string;
  url?: string;
  /** Path to an evidence screenshot crop, if any. */
  imagePath?: string;
  extra?: Record<string, unknown>;
}

export interface FindingDraft {
  field: FindingField;
  value: string;
  fontFamilyId?: number | null;
  method: FindingMethod;
  /** 0..1 */
  confidence: number;
  evidence: Evidence;
}

export interface Finding extends FindingDraft {
  id: number;
  scanId: number;
  status: FindingStatus;
  createdAt: string;
}

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Site {
  id: number;
  url: string;
  canonicalDomain: string;
  projectName: string | null;
  siteType: string | null;
  createdAt: string;
}

export type ScreenshotKind = 'full' | 'main' | 'secondary';

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenshotRecord {
  id: number;
  scanId: number;
  kind: ScreenshotKind;
  path: string;
  width: number;
  height: number;
  crop: CropRect | null;
  score: number | null;
  sha256: string;
}

export type TemplateVariant = 'single' | 'split' | 'split-thin';

export interface TemplateRecord {
  id: number;
  figmaFileKey: string;
  nodeId: string;
  variant: TemplateVariant;
  version: number;
  name: string;
  fingerprint: string;
  fields: TemplateFieldInfo[];
  active: boolean;
}

export interface TemplateFieldInfo {
  field: DynamicField;
  nodeId: string;
  /** Position relative to the template frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DynamicField = '@headline' | '@credits' | '@shot.main' | '@shot.secondary' | '@gradient.bottom';

export const DYNAMIC_FIELDS: readonly DynamicField[] = [
  '@headline',
  '@credits',
  '@shot.main',
  '@shot.secondary',
  '@gradient.bottom',
] as const;

export type GroupStatus = 'draft' | 'review' | 'approved' | 'exported';

export type MockupStatus = 'pending' | 'built' | 'validated' | 'approved' | 'rejected' | 'exported' | 'failed';

/** The final, user-confirmed content of one mockup. */
export interface MockupContent {
  siteType: string | null;
  projectName: string;
  projectTitle: string;
  fonts: string[]; // Hebrew display names, primary first
  designer: string | null; // null => credit line omitted, filename uses "ללא קרדיט"
  developer: string | null;
  displayUrl: string;
  brandColor: RGB;
}

export interface MockupRecord {
  id: number;
  groupId: number;
  slot: 1 | 2 | 3 | 4;
  siteId: number;
  primaryFontId: number;
  templateId: number;
  jobId: string;
  figmaNodeId: string | null;
  content: MockupContent;
  status: MockupStatus;
  validation: ValidationIssue[];
  previewSha256: string | null;
  figmaFingerprint: string | null;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
}

export interface ExportRecord {
  id: number;
  mockupId: number;
  path: string;
  sha256: string;
  dedupeKey: string;
  exportedAt: string;
}
