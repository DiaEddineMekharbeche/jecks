import { describe, expect, it } from 'vitest';
import { planPlacementPage } from './catalog.service.js';

/**
 * Merchandised paging — PRD F-AD-13.
 *
 * A pinned product leads the collection grid and a demoted one closes it, which turns
 * one ordered list into three. The failure this guards against is silent: an off-by-one
 * here shows a product on two pages, or drops one between them, and nobody notices until
 * a customer asks where an item went.
 */

const LEAD = ['p1', 'p2', 'p3'];
const TAIL = ['t1', 't2'];

/** Rebuilds the full sequence a client would see by walking every page. */
function walk(lead: string[], middle: string[], tail: string[], take: number): string[] {
  const seen: string[] = [];
  const total = lead.length + middle.length + tail.length;

  for (let skip = 0; skip < total; skip += take) {
    const plan = planPlacementPage(lead, middle.length, tail, skip, take);
    seen.push(
      ...plan.leadIds,
      ...middle.slice(plan.middleSkip, plan.middleSkip + plan.middleTake),
      ...plan.tailIds,
    );
  }
  return seen;
}

describe('planPlacementPage', () => {
  it('fills the first page from the lead, then the middle', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 0, 5);
    expect(plan.leadIds).toEqual(['p1', 'p2', 'p3']);
    expect(plan.middleSkip).toBe(0);
    expect(plan.middleTake).toBe(2);
    expect(plan.tailIds).toEqual([]);
  });

  it('offsets the middle by the lead already consumed', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 5, 5);
    expect(plan.leadIds).toEqual([]);
    expect(plan.middleSkip).toBe(2);
    expect(plan.middleTake).toBe(5);
  });

  it('reaches the tail only once the middle is exhausted', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 10, 5);
    expect(plan.middleSkip).toBe(7);
    expect(plan.middleTake).toBe(3);
    expect(plan.tailIds).toEqual(['t1', 't2']);
  });

  it('offsets the tail past the whole middle', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 14, 5);
    expect(plan.leadIds).toEqual([]);
    expect(plan.middleTake).toBe(0);
    expect(plan.tailIds).toEqual(['t2']);
  });

  it('returns nothing past the end', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 30, 5);
    expect(plan.leadIds).toEqual([]);
    expect(plan.middleTake).toBe(0);
    expect(plan.tailIds).toEqual([]);
  });

  it('never repeats or drops a product, whatever the page size', () => {
    const middle = Array.from({ length: 17 }, (_, index) => `m${index + 1}`);
    const expected = [...LEAD, ...middle, ...TAIL];

    for (const take of [1, 2, 3, 4, 5, 6, 12, 24, 60]) {
      expect(walk(LEAD, middle, TAIL, take)).toEqual(expected);
    }
  });

  it('degrades to a plain page when nothing is merchandised', () => {
    const plan = planPlacementPage([], 40, [], 24, 24);
    expect(plan.leadIds).toEqual([]);
    expect(plan.middleSkip).toBe(24);
    expect(plan.middleTake).toBe(16);
    expect(plan.tailIds).toEqual([]);
  });

  it('handles a collection made entirely of pinned products', () => {
    expect(walk(['a', 'b', 'c'], [], [], 2)).toEqual(['a', 'b', 'c']);
  });

  it('handles a page smaller than the lead', () => {
    const plan = planPlacementPage(LEAD, 10, TAIL, 0, 2);
    expect(plan.leadIds).toEqual(['p1', 'p2']);
    expect(plan.middleTake).toBe(0);
  });
});
