import type { FontFamily } from '@fontshok/shared';
import { isGenericFamily, levenshtein, normalizeFontKey } from './normalize.js';

export type MatchKind = 'exact-alias' | 'exact-name' | 'fuzzy';

export interface FontMatch {
  family: FontFamily;
  kind: MatchKind;
  matchedKey: string;
  input: string;
  /** 0..1. Fuzzy matches are always below the auto-confirm threshold. */
  confidence: number;
}

export const AUTO_CONFIRM_THRESHOLD = 0.9;

/**
 * Deterministic matcher of observed font names (CSS family, @font-face URL file name) against
 * the FontShok catalogue. Never guesses: if nothing matches, returns null.
 */
export class FontMatcher {
  private readonly index = new Map<string, { family: FontFamily; kind: MatchKind }>();
  /** Keys claimed by more than one family: never matched automatically. */
  private readonly ambiguous = new Set<string>();

  /** Keys that are claimed by more than one family (shown in the catalogue screen as conflicts). */
  conflicts(): string[] {
    return [...this.ambiguous];
  }

  constructor(families: FontFamily[]) {
    for (const f of families) {
      if (!f.active) continue;
      for (const name of [f.nameEn, f.nameHe, f.slug]) {
        if (name) this.add(normalizeFontKey(name), f, 'exact-name');
      }
      for (const a of f.aliases) this.add(normalizeFontKey(a.alias), f, 'exact-alias');
    }
  }

  private add(key: string, family: FontFamily, kind: MatchKind) {
    if (!key) return;
    const existing = this.index.get(key);
    if (existing && existing.family.id !== family.id) {
      this.ambiguous.add(key);
      return;
    }
    if (!existing) this.index.set(key, { family, kind });
  }

  match(input: string): FontMatch | null {
    if (isGenericFamily(input)) return null;
    const key = normalizeFontKey(input);
    if (!key) return null;
    if (this.ambiguous.has(key)) return null;
    const hit = this.index.get(key);
    if (hit) {
      return { family: hit.family, kind: hit.kind, matchedKey: key, input, confidence: hit.kind === 'exact-alias' ? 0.95 : 0.93 };
    }
    // Fuzzy: single-edit typos on reasonably long keys only.
    if (key.length < 5) return null;
    let best: { family: FontFamily; key: string; d: number } | null = null;
    for (const [k, v] of this.index) {
      if (this.ambiguous.has(k)) continue;
      if (Math.abs(k.length - key.length) > 1) continue;
      const d = levenshtein(k, key);
      if (d <= 1 && (!best || d < best.d)) best = { family: v.family, key: k, d };
    }
    if (!best) return null;
    return { family: best.family, kind: 'fuzzy', matchedKey: best.key, input, confidence: 0.6 };
  }
}
