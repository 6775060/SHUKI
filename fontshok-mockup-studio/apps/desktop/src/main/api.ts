/**
 * The typed surface the renderer can call (through preload → ipcMain).
 * Only methods listed in STUDIO_METHODS are reachable from the UI.
 */
import type {
  ExportRecord,
  Finding,
  FindingField,
  FindingStatus,
  FontFamily,
  MockupContent,
  MockupRecord,
  ScreenshotRecord,
  Site,
  TemplateRecord,
} from '@fontshok/shared';
import type { BridgeStatus } from '@fontshok/figma-bridge';
import type { BookmarkFolder } from './core/bookmarks.js';
export type { BookmarkFolder };
import type { StudioSettings } from './core/settings.js';

export interface SiteSummary {
  site: Site;
  scan: { id: number; status: string; error: string | null; finishedAt: string | null } | null;
  confirmedFonts: string[];
  ready: boolean;
  missing: string[];
  inGroup: string | null;
  exported: boolean;
}

export interface SiteDetail {
  site: Site;
  scanId: number | null;
  findings: Finding[];
  screenshots: (ScreenshotRecord & { dataUrl: string | null })[];
  fullScreenshotDataUrl: string | null;
}

export interface MockupView extends MockupRecord {
  siteDomain: string;
  templateName: string;
  primaryFontName: string;
  previewDataUrl: string | null;
  approved: boolean;
  exportedPath: string | null;
}

export interface GroupView {
  id: number;
  code: string;
  status: string;
  createdAt: string;
  mockups: MockupView[];
}

export interface SiteImportReport {
  fontsOnSite: number;
  added: string[];
  updated: string[];
  aliasesAdded: number;
  /** aliases that already belong to another font in the catalogue */
  conflicts: string[];
  /** technical names found on a font page that could not be attributed with certainty */
  unassigned: { font: string; name: string }[];
  /** fonts in the catalogue that are no longer in the site's fonts menu (not deactivated automatically) */
  missingFromSite: string[];
  errors: string[];
}

export interface StudioApi {
  getSettings(): StudioSettings;
  updateSettings(patch: Partial<StudioSettings>): StudioSettings;
  regeneratePairingToken(): StudioSettings;
  figmaStatus(): BridgeStatus;

  listFonts(): FontFamily[];
  addFont(nameHe: string, nameEn: string | null, aliases: string[]): FontFamily[];
  addAlias(familyId: number, alias: string): { ok: boolean; conflict: boolean };
  removeAlias(aliasId: number): void;
  setFontActive(familyId: number, active: boolean): void;
  importCatalogCsv(text: string): { added: number; aliasesAdded: number; conflicts: string[]; errors: string[] };
  /** Reads the fonts menu of fontshok.co.il and every font page, and updates the catalogue. */
  importFontsFromSite(): Promise<SiteImportReport>;

  addSites(urls: string[]): { added: Site[]; duplicates: string[]; invalid: string[] };
  listBookmarkFolders(): BookmarkFolder[];
  importBookmarkFolder(folderId: string, includeSubfolders: boolean): { found: number; added: Site[]; duplicates: string[]; invalid: string[] };
  listSites(): SiteSummary[];
  scanSites(siteIds: number[]): void;
  getSiteDetail(siteId: number): Promise<SiteDetail>;
  setFindingStatus(findingId: number, status: FindingStatus): void;
  addManualFinding(siteId: number, field: FindingField, value: string, fontFamilyId?: number | null): void;
  updateSiteMeta(siteId: number, projectName: string | null, siteType: string | null): void;

  syncTemplates(): Promise<TemplateRecord[]>;
  listTemplates(): TemplateRecord[];

  proposeGroups(): Promise<{ created: string[]; leftovers: { domain: string; reason: string }[] }>;
  listGroups(): Promise<GroupView[]>;
  buildGroup(groupId: number): Promise<void>;
  rebuildMockup(mockupId: number): Promise<void>;
  updateMockupContent(mockupId: number, content: MockupContent): void;
  setMockupTemplate(mockupId: number, templateId: number): void;
  approveMockup(mockupId: number, note?: string | null): void;
  rejectMockup(mockupId: number): void;
  exportGroup(groupId: number): Promise<{ written: string[]; skipped: string[] }>;
  deleteGroup(groupId: number): Promise<void>;

  listExports(): (ExportRecord & { groupCode: string })[];
  listAudit(): { at: string; actor: string; action: string; data: unknown }[];
}

export const STUDIO_METHODS = [
  'getSettings', 'updateSettings', 'regeneratePairingToken', 'figmaStatus',
  'listFonts', 'addFont', 'addAlias', 'removeAlias', 'setFontActive', 'importCatalogCsv', 'importFontsFromSite',
  'addSites', 'listBookmarkFolders', 'importBookmarkFolder', 'listSites', 'scanSites', 'getSiteDetail', 'setFindingStatus', 'addManualFinding', 'updateSiteMeta',
  'syncTemplates', 'listTemplates',
  'proposeGroups', 'listGroups', 'buildGroup', 'rebuildMockup', 'updateMockupContent', 'setMockupTemplate',
  'approveMockup', 'rejectMockup', 'exportGroup', 'deleteGroup',
  'listExports', 'listAudit',
] as const satisfies readonly (keyof StudioApi)[];

export type StudioMethod = (typeof STUDIO_METHODS)[number];

export type StudioEvent =
  | { type: 'figma'; status: BridgeStatus }
  | { type: 'sites-changed' }
  | { type: 'groups-changed' }
  | { type: 'progress'; scope: string; message: string }
  | { type: 'error'; scope: string; message: string };
