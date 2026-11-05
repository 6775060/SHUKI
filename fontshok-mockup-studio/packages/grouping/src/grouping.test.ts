import { describe, expect, it } from 'vitest';
import { buildGroups } from './index.js';

describe('buildGroups', () => {
  it('builds groups of exactly four with four distinct fonts', () => {
    const r = buildGroups([
      { siteId: 1, fontIds: [10], priority: 1 },
      { siteId: 2, fontIds: [10], priority: 2 },
      { siteId: 3, fontIds: [11], priority: 3 },
      { siteId: 4, fontIds: [12], priority: 4 },
      { siteId: 5, fontIds: [13], priority: 5 },
    ]);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g).toHaveLength(4);
    expect(new Set(g.map((a) => a.primaryFontId)).size).toBe(4);
    expect(r.leftovers.map((l) => l.siteId)).toEqual([2]);
  });

  it('backtracks to use a secondary font of a multi-font site', () => {
    const r = buildGroups([
      { siteId: 1, fontIds: [10, 14], priority: 1 },
      { siteId: 2, fontIds: [10], priority: 2 },
      { siteId: 3, fontIds: [11], priority: 3 },
      { siteId: 4, fontIds: [12], priority: 4 },
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.find((a) => a.siteId === 1)!.primaryFontId).toBe(14);
  });

  it('skips already exported sites and prefers rarely exported fonts', () => {
    const r = buildGroups(
      [
        { siteId: 1, fontIds: [10, 20], priority: 1 },
        { siteId: 2, fontIds: [11], priority: 2 },
        { siteId: 3, fontIds: [12], priority: 3 },
        { siteId: 4, fontIds: [13], priority: 4 },
        { siteId: 9, fontIds: [15], priority: 0 },
      ],
      { alreadyExportedSiteIds: new Set([9]), fontExportCounts: new Map([[10, 5]]) },
    );
    expect(r.groups[0]!.find((a) => a.siteId === 1)!.primaryFontId).toBe(20);
    expect(r.leftovers).toContainEqual({ siteId: 9, reason: 'already exported in a previous group' });
  });

  it('returns no group when fewer than four distinct fonts exist', () => {
    const r = buildGroups([1, 2, 3, 4].map((i) => ({ siteId: i, fontIds: [i % 3], priority: i })));
    expect(r.groups).toHaveLength(0);
    expect(r.leftovers).toHaveLength(4);
  });
});
