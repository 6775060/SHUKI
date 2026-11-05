/** Turns raw font observations from the page into catalogue findings. */
import type { FindingDraft } from '@fontshok/shared';
import type { FontMatch } from '@fontshok/fonts';

export interface FontUsage {
  family: string;
  /** Sum of visible characters rendered with this family (first family in the stack that is loaded). */
  chars: number;
  /** Characters weighted by font size (headline text weighs more). */
  weightedChars: number;
  maxFontSize: number;
  sampleText: string;
  sampleSelector: string;
}

export interface FontObservations {
  /** FontFace objects with status "loaded". */
  loadedFaces: { family: string; weight: string; style: string }[];
  /** Font files fetched by the page (from the Resource Timing API). */
  fontFiles: string[];
  usage: FontUsage[];
}

export interface FontMatcherLike {
  match(input: string): FontMatch | null;
}

/**
 * Evidence ladder (highest first):
 *   computed-style on visible text  + loaded FontFace  -> 0.95
 *   computed-style only (face not confirmed loaded)    -> 0.8
 *   font file downloaded but not used on visible text  -> 0.55
 * Fuzzy name matches are capped at 0.6 regardless.
 */
export function fontFindings(obs: FontObservations, matcher: FontMatcherLike): FindingDraft[] {
  const byFamily = new Map<number, FindingDraft & { _score: number }>();
  const loaded = new Set(obs.loadedFaces.map((f) => f.family.toLowerCase()));

  const consider = (draft: FindingDraft, score: number) => {
    const id = draft.fontFamilyId!;
    const prev = byFamily.get(id);
    if (!prev || prev.confidence < draft.confidence || (prev.confidence === draft.confidence && prev._score < score)) {
      byFamily.set(id, { ...draft, _score: score });
    }
  };

  for (const u of obs.usage) {
    const m = matcher.match(u.family);
    if (!m) continue;
    const base = loaded.has(u.family.toLowerCase()) ? 0.95 : 0.8;
    const confidence = m.kind === 'fuzzy' ? Math.min(0.6, base) : base;
    consider(
      {
        field: 'font',
        value: m.family.nameHe,
        fontFamilyId: m.family.id,
        method: 'computed-style',
        confidence,
        evidence: {
          source: 'computed font-family of visible text',
          snippet: u.sampleText.slice(0, 120),
          selector: u.sampleSelector,
          extra: { cssFamily: u.family, matchedKey: m.matchedKey, matchKind: m.kind, chars: u.chars, maxFontSize: u.maxFontSize },
        },
      },
      u.weightedChars,
    );
  }

  for (const file of obs.fontFiles) {
    const m = matcher.match(file);
    if (!m || byFamily.has(m.family.id)) continue;
    consider(
      {
        field: 'font',
        value: m.family.nameHe,
        fontFamilyId: m.family.id,
        method: 'font-face',
        confidence: m.kind === 'fuzzy' ? 0.45 : 0.55,
        evidence: { source: 'font file downloaded by the page (not seen on visible text)', url: file, extra: { matchedKey: m.matchedKey, matchKind: m.kind } },
      },
      0,
    );
  }

  return [...byFamily.values()]
    .sort((a, b) => b.confidence - a.confidence || b._score - a._score)
    .map(({ _score, ...d }) => {
      void _score;
      return d;
    });
}
