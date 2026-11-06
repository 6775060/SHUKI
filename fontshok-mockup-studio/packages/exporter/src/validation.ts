/**
 * Pre-approval validation. Errors block approval; warnings are shown to the reviewer.
 */
import { contrastRatio, type MockupContent, type ValidationIssue } from '@fontshok/shared';
import type { BuildResult, TemplateInfo } from '@fontshok/shared';

export interface ValidationInput {
  content: MockupContent;
  confirmed: { fonts: boolean; projectName: boolean; designer: boolean | 'unknown' };
  template: TemplateInfo;
  build: Pick<BuildResult, 'measurements' | 'warnings'> | null;
  mainImageWidth: number;
  templateFingerprintNow: string | null;
  templateFingerprintExpected: string;
  alreadyExported: boolean;
  siteDomain: string;
  group: { primaryFontIds: number[]; size: number };
  primaryFontId: number;
}

export function validateMockup(v: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string) => issues.push({ code, severity: 'error', message });
  const warn = (code: string, message: string) => issues.push({ code, severity: 'warning', message });

  if (!v.content.projectName.trim()) error('PROJECT_MISSING', 'חסר שם פרויקט');
  if (!v.content.projectTitle.trim()) error('PROJECT_TITLE_MISSING', 'חסרה שורת "פרויקט"');
  if (v.content.fonts.length === 0) error('FONTS_MISSING', 'לא נבחר פונט');
  if (!v.confirmed.fonts) error('FONTS_UNCONFIRMED', 'זיהוי הפונט לא אושר ידנית');
  if (!v.confirmed.projectName) error('PROJECT_UNCONFIRMED', 'שם הפרויקט לא אושר');
  if (v.content.designer && v.confirmed.designer !== true) error('DESIGNER_UNCONFIRMED', 'קרדיט המעצב לא אושר – יש לאשר או למחוק');
  if (!v.content.designer) warn('DESIGNER_UNKNOWN', 'אין קרדיט מעצב – השורה תושמט והקובץ יסומן "ללא קרדיט"');

  if (v.templateFingerprintNow !== v.templateFingerprintExpected) error('TEMPLATE_CHANGED', 'תבנית המאסטר השתנתה מאז שנרשמה – יש לרענן תבניות');
  if (v.alreadyExported) error('ALREADY_EXPORTED', 'שילוב אתר+פונט+תבנית זה כבר יוצא בעבר');

  const domainInUrl = v.content.displayUrl.toLowerCase().replace(/^www\./, '');
  if (domainInUrl !== v.siteDomain.toLowerCase()) warn('URL_MISMATCH', `הכתובת המוצגת (${v.content.displayUrl}) שונה מהדומיין שנסרק (${v.siteDomain})`);

  const main = v.template.fields.find((f) => f.field === '@shot.main');
  if (main && v.mainImageWidth < main.width * 2) warn('LOW_RES', `צילום ראשי ברזולוציה נמוכה (${v.mainImageWidth}px, מומלץ ${main.width * 2}px)`);

  if (v.build) {
    for (const w of v.build.warnings) warn('FIGMA_WARNING', w);
    for (const key of ['@headline', '@credits'] as const) {
      const m = v.build.measurements[key];
      const orig = v.template.fields.find((f) => f.field === key);
      if (!m || !orig) continue;
      if (m.x < 24 || m.x + m.width > v.template.width - 24) error('TEXT_OUT_OF_FRAME', `${key}: הטקסט חורג מגבולות הפריים`);
      if (m.height > orig.height + 2) error('TEXT_OVERFLOW', `${key}: הטקסט גבוה מהתיבה המקורית (${Math.round(m.height)} > ${Math.round(orig.height)})`);
    }
    const headline = v.build.measurements['@headline'];
    const shot = v.template.fields.find((f) => f.field === '@shot.main');
    if (headline && shot && headline.y + headline.height > shot.y - 8) error('HEADLINE_OVERLAPS_SHOT', 'הכותרת עולה על צילום המסך');
  } else {
    error('NOT_BUILT', 'המוקאפ עוד לא נבנה ב־Figma');
  }

  // Credits are black text over the bottom gradient: the gradient's darkest stop sits at the bottom-left,
  // away from the right-aligned credits, but very dark brand colours still need a warning.
  const black = { r: 0, g: 0, b: 0 };
  if (contrastRatio(black, v.content.brandColor) < 2) warn('GRADIENT_DARK', 'צבע הגרדיאנט כהה מאוד – לבדוק קריאות הקרדיטים');

  const distinct = new Set(v.group.primaryFontIds);
  if (v.group.size !== 4) error('GROUP_SIZE', `בקבוצה ${v.group.size} מוקאפים במקום 4`);
  if (distinct.size !== v.group.primaryFontIds.length) error('GROUP_FONTS_NOT_DISTINCT', 'בקבוצה יש פונט ראשי שחוזר על עצמו');
  if (!v.group.primaryFontIds.includes(v.primaryFontId)) error('GROUP_MISMATCH', 'הפונט הראשי לא שייך לקבוצה');
  return issues;
}
