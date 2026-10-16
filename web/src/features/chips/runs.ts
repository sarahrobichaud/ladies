import type { Catalog, Chip, ChipId, Run } from "./types";

/**
 * Merge adjacent same-kind runs and drop empty ones, returning the
 * canonical form of a run list.
 * @param runs - run list in any order; not mutated
 */
export function coalesce(runs: Run[]): Run[] {
  const canonical: Run[] = [];

  for (const run of runs) {
    const isEmpty = run.count <= 0;
    if (isEmpty) continue;

    const previous = canonical[canonical.length - 1];
    const mergesWithPrevious = previous !== undefined && previous.kind === run.kind;

    if (mergesWithPrevious) {
      previous.count += run.count;
    } else {
      canonical.push({ ...run });
    }
  }

  return canonical;
}

/**
 * Total number of chips across all runs.
 * @param runs - run list in canonical form (order irrelevant for the sum)
 */
export function runsSize(runs: Run[]): number {
  let total = 0;

  for (const run of runs) {
    total += run.count;
  }

  return total;
}

/**
 * Total monetary value of all chips, resolved through the catalog.
 * @param runs - run list whose kinds index the catalog
 * @param catalog - denomination lookup; every run kind must be a valid index
 */
export function runsValue(runs: Run[], catalog: Catalog): bigint {
  let total = 0n;

  for (const run of runs) {
    const kind = catalog[run.kind];
    const runValue = kind.value * BigInt(run.count);
    total += runValue;
  }

  return total;
}

/**
 * Split a run list at a chip depth: the first `depth` chips form the
 * lower half, the rest form the upper half. A run straddling the depth
 * is cut in two.
 * @param runs - run list in canonical form, ordered bottom → top
 * @param depth - chip index to split at; clamped implicitly (0 or below
 *   sends everything up, at or past the end sends everything down)
 */
export function splitRuns(runs: Run[], depth: number): [Run[], Run[]] {
  const lower: Run[] = [];
  const upper: Run[] = [];

  let chipsSeen = 0;

  for (const run of runs) {
    const runStart = chipsSeen;
    const runEnd = chipsSeen + run.count;
    chipsSeen = runEnd;

    const entirelyBelow = runEnd <= depth;
    const entirelyAbove = runStart >= depth;
    const straddles = !entirelyBelow && !entirelyAbove;

    if (entirelyBelow) {
      lower.push({ ...run });
    } else if (entirelyAbove) {
      upper.push({ ...run });
    } else if (straddles) {
      const lowerCount = depth - runStart;
      const upperCount = run.count - lowerCount;
      lower.push({ kind: run.kind, count: lowerCount });
      upper.push({ kind: run.kind, count: upperCount });
    }
  }

  return [coalesce(lower), coalesce(upper)];
}

/**
 * Compress a sequence of individual chips into canonical runs.
 * @param chips - chips in stacking order, bottom → top
 */
export function runsFromChips(chips: Chip[]): Run[] {
  const runs: Run[] = [];

  for (const chip of chips) {
    const previous = runs[runs.length - 1];
    const extendsPrevious = previous !== undefined && previous.kind === chip.kind;

    if (extendsPrevious) {
      previous.count += 1;
    } else {
      runs.push({ kind: chip.kind, count: 1 });
    }
  }

  return runs;
}

/**
 * Expand runs into individual chips, minting sequential ids starting at
 * `firstId`. Returns the chips and the next unused id.
 * @param runs - run list in canonical form, ordered bottom → top
 * @param firstId - id for the first minted chip; subsequent chips increment
 */
export function materialize(runs: Run[], firstId: ChipId): { chips: Chip[]; nextId: ChipId } {
  const chips: Chip[] = [];

  let nextId = firstId;

  for (const run of runs) {
    for (let added = 0; added < run.count; added++) {
      chips.push({ id: nextId, kind: run.kind });
      nextId++;
    }
  }

  return { chips, nextId };
}
