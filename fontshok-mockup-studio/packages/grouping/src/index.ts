/**
 * Builds groups of exactly four websites with four distinct font families.
 * A site may use several FontShok families; any one of its confirmed families can be its "primary".
 */
export const GROUP_SIZE = 4;

export interface Candidate {
  siteId: number;
  /** Confirmed FontShok families on the site, best evidence first. */
  fontIds: number[];
  /** Lower = more urgent (e.g. older scan first). */
  priority: number;
}

export interface Assignment {
  siteId: number;
  primaryFontId: number;
}

export interface GroupingResult {
  groups: Assignment[][];
  leftovers: { siteId: number; reason: string }[];
}

export interface GroupingOptions {
  /** How many times each family was already exported; rarely used families are preferred. */
  fontExportCounts?: Map<number, number>;
  /** Sites already exported in the past are skipped (duplicate prevention). */
  alreadyExportedSiteIds?: Set<number>;
  maxGroups?: number;
}

export function buildGroups(candidates: Candidate[], opts: GroupingOptions = {}): GroupingResult {
  const leftovers: GroupingResult['leftovers'] = [];
  const counts = opts.fontExportCounts ?? new Map<number, number>();
  const pool: Candidate[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    if (seen.has(c.siteId)) {
      leftovers.push({ siteId: c.siteId, reason: 'duplicate site in input' });
      continue;
    }
    seen.add(c.siteId);
    if (opts.alreadyExportedSiteIds?.has(c.siteId)) leftovers.push({ siteId: c.siteId, reason: 'already exported in a previous group' });
    else if (c.fontIds.length === 0) leftovers.push({ siteId: c.siteId, reason: 'no confirmed FontShok font' });
    else pool.push(c);
  }
  pool.sort((a, b) => a.priority - b.priority);

  const groups: Assignment[][] = [];
  const used = new Set<number>();
  const fontOrder = (ids: number[]) => [...ids].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

  const search = (start: number, chosen: Assignment[], fonts: Set<number>): Assignment[] | null => {
    if (chosen.length === GROUP_SIZE) return chosen;
    for (let i = start; i < pool.length; i++) {
      const c = pool[i]!;
      if (used.has(c.siteId)) continue;
      for (const f of fontOrder(c.fontIds)) {
        if (fonts.has(f)) continue;
        fonts.add(f);
        chosen.push({ siteId: c.siteId, primaryFontId: f });
        const r = search(i + 1, chosen, fonts);
        if (r) return r;
        chosen.pop();
        fonts.delete(f);
      }
    }
    return null;
  };

  while (opts.maxGroups === undefined || groups.length < opts.maxGroups) {
    const g = search(0, [], new Set());
    if (!g) break;
    const group = g.map((a) => ({ ...a }));
    group.forEach((a) => used.add(a.siteId));
    groups.push(group);
  }
  for (const c of pool) {
    if (!used.has(c.siteId)) leftovers.push({ siteId: c.siteId, reason: 'not enough sites with other distinct fonts to complete a group of 4' });
  }
  return { groups, leftovers };
}
