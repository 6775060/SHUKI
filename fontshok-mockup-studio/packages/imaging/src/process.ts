import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CropRect, FindingDraft, RGB } from '@fontshok/shared';
import { rgbToHex, rgbToHsl } from '@fontshok/shared';

/** Figma rejects images larger than 4096 px per side. */
export const FIGMA_MAX_IMAGE_SIDE = 4096;

export interface PreparedImage {
  path: string;
  width: number;
  height: number;
  sha256: string;
  crop: CropRect;
}

/**
 * Crops a region of the full screenshot and resizes it to exactly `scale` × slot size
 * (aspect ratio of the slot, cover fit from the top), capped at 4096 px.
 */
export async function prepareSlotImage(
  fullPath: string,
  crop: CropRect,
  slot: { width: number; height: number },
  outDir: string,
  name: string,
  scale = 2,
): Promise<PreparedImage> {
  const meta = await sharp(fullPath).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const rect: CropRect = {
    left: Math.max(0, Math.min(crop.left, W - 1)),
    top: Math.max(0, Math.min(crop.top, H - 1)),
    width: 0,
    height: 0,
  };
  rect.width = Math.max(1, Math.min(crop.width, W - rect.left));
  rect.height = Math.max(1, Math.min(crop.height, H - rect.top));
  let outW = Math.round(slot.width * scale);
  let outH = Math.round(slot.height * scale);
  const k = Math.min(1, FIGMA_MAX_IMAGE_SIDE / Math.max(outW, outH));
  outW = Math.round(outW * k);
  outH = Math.round(outH * k);
  const buf = await sharp(fullPath)
    .extract(rect)
    .resize(outW, outH, { fit: 'cover', position: 'top', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await mkdir(outDir, { recursive: true });
  const sha = createHash('sha256').update(buf).digest('hex');
  const path = join(outDir, `${name}-${sha.slice(0, 10)}.png`);
  await writeFile(path, buf);
  return { path, width: outW, height: outH, sha256: sha, crop: rect };
}

/**
 * Brand colour for the bottom gradient: the most frequent *saturated* colour of the main crop.
 * White, black and greys are ignored. Returns a finding with the pixel statistics as evidence.
 */
export async function sampleBrandColor(imagePath: string): Promise<{ color: RGB; finding: FindingDraft }> {
  const { data, info } = await sharp(imagePath).resize(160, 160, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  let saturated = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
    total++;
    const { s, l } = rgbToHsl({ r, g, b });
    if (s < 0.28 || l < 0.12 || l > 0.9) continue;
    saturated++;
    const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bk.n++; bk.r += r; bk.g += g; bk.b += b;
    buckets.set(key, bk);
  }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || saturated / total < 0.005) {
    // No brand colour visible: neutral dark grey, low confidence → user must pick.
    const color = { r: 0.2, g: 0.2, b: 0.2 };
    return {
      color,
      finding: {
        field: 'brand_color', value: rgbToHex(color), method: 'pixel-sampling', confidence: 0.2,
        evidence: { source: 'no saturated colour found in the main screenshot', imagePath, extra: { saturatedRatio: saturated / total } },
      },
    };
  }
  const color = { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
  const share = best.n / saturated;
  return {
    color,
    finding: {
      field: 'brand_color', value: rgbToHex(color), method: 'pixel-sampling',
      confidence: Math.min(0.85, 0.4 + share),
      evidence: { source: 'most frequent saturated colour in the main screenshot', imagePath, extra: { share, saturatedRatio: saturated / total } },
    },
  };
}

/** Small JPEG preview as a data: URL for the review UI (never used for export). */
export async function thumbnailDataUrl(path: string, width = 720, maxHeight = 2400): Promise<string> {
  const buf = await sharp(path)
    .resize({ width, height: maxHeight, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
