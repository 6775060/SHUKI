/**
 * Chooses the most typographic window of a full-page screenshot for each image slot.
 * Pure function: works on text boxes (CSS px) collected by the scanner.
 */
import type { CropRect } from '@fontshok/shared';

export interface ScoredBox {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  chars: number;
  /** true when the box is rendered with a FontShok family (detected for this site). */
  isTarget: boolean;
}

export interface SlotSpec {
  /** Slot size in Figma px (e.g. 995×631). */
  width: number;
  height: number;
  /** Fraction of the slot height that is actually visible (secondary strip may cover the bottom). */
  visibleFraction?: number;
}

export interface CropChoice {
  /** In device px of the full screenshot. */
  rect: CropRect;
  score: number;
}

export interface CropPlanInput {
  boxes: ScoredBox[];
  /** CSS px */
  pageWidth: number;
  pageHeight: number;
  deviceScaleFactor: number;
  main: SlotSpec;
  secondary: SlotSpec | null;
  stepCss?: number;
}

const boxWeight = (b: ScoredBox) => Math.sqrt(Math.max(1, b.chars)) * Math.pow(Math.max(8, b.fontSize) / 16, 1.5) * (b.isTarget ? 4 : 1);

/** Score of a horizontal band [top, top+height) in CSS px. Boxes cut by an edge are penalised. */
export function scoreBand(boxes: ScoredBox[], top: number, height: number): number {
  const bottom = top + height;
  let score = 0;
  for (const b of boxes) {
    const bTop = b.y;
    const bBottom = b.y + b.h;
    if (bBottom <= top || bTop >= bottom) continue;
    const w = boxWeight(b);
    if (bTop >= top && bBottom <= bottom) score += w;
    else score -= 0.6 * w; // text sliced by the crop edge looks bad
  }
  return score;
}

function bestBand(boxes: ScoredBox[], pageHeight: number, bandHeight: number, step: number, exclude: [number, number] | null, topBonus: number) {
  let best: { top: number; score: number } | null = null;
  const maxTop = Math.max(0, pageHeight - bandHeight);
  for (let top = 0; top <= maxTop; top += step) {
    if (exclude && top < exclude[1] && top + bandHeight > exclude[0]) continue;
    let score = scoreBand(boxes, top, bandHeight);
    if (top === 0) score *= 1 + topBonus;
    if (!best || score > best.score) best = { top, score };
  }
  return best;
}

export function planCrops(input: CropPlanInput): { main: CropChoice; secondary: CropChoice | null } {
  const step = input.stepCss ?? 20;
  const dpr = input.deviceScaleFactor;
  const mainH = Math.round((input.pageWidth * input.main.height) / input.main.width);
  const mainVisible = Math.round(mainH * (input.main.visibleFraction ?? 1));
  // The hero is usually the strongest typographic statement: small bonus for the top of the page.
  const main = bestBand(input.boxes, input.pageHeight, mainVisible, step, null, 0.25) ?? { top: 0, score: 0 };
  const toRect = (top: number, h: number): CropRect => ({
    left: 0,
    top: Math.round(top * dpr),
    width: Math.round(input.pageWidth * dpr),
    height: Math.round(Math.min(h, input.pageHeight - top) * dpr),
  });
  let secondary: CropChoice | null = null;
  if (input.secondary) {
    const secH = Math.round((input.pageWidth * input.secondary.height) / input.secondary.width);
    const s = bestBand(input.boxes, input.pageHeight, secH, step, [main.top, main.top + mainVisible], 0);
    if (s && s.score > 0) secondary = { rect: toRect(s.top, secH), score: s.score };
  }
  return { main: { rect: toRect(main.top, mainH), score: main.score }, secondary };
}
