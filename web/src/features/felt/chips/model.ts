import { STACK_CAPACITY } from './rules';
import type { Board, Catalog, Chip, ChipId, KindId, Run, Size, Slot, Stack, StackId } from './types';

// Pure board ops: every function is a total Board → Board transition that
// keeps the invariants — one hand, one stack per slot, canonical runs,
// non-empty stacks. Rejected moves return the board unchanged (callers
// can compare references).

// --- run utilities ----------------------------------------------------------

// Canonical form: no zero counts, no adjacent runs of the same kind.
export function coalesce(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.count <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.kind === run.kind) last.count += run.count;
    else out.push({ ...run });
  }
  return out;
}

export function runsSize(runs: Run[]): number {
  return runs.reduce((n, r) => n + r.count, 0);
}

export function runsValue(runs: Run[], catalog: Catalog): bigint {
  return runs.reduce((sum, r) => sum + catalog[r.kind].value * BigInt(r.count), 0n);
}

// Split at a depth: the first `depth` chips stay, the rest go up. May cut
// a run in half.
export function splitRuns(runs: Run[], depth: number): [Run[], Run[]] {
  const lower: Run[] = [];
  const upper: Run[] = [];
  let seen = 0;
  for (const run of runs) {
    const start = seen;
    seen += run.count;
    if (start >= depth) upper.push({ ...run });
    else if (seen <= depth) lower.push({ ...run });
    else {
      const take = depth - start;
      if (take > 0) lower.push({ kind: run.kind, count: take });
      if (run.count - take > 0) upper.push({ kind: run.kind, count: run.count - take });
    }
  }
  return [coalesce(lower), coalesce(upper)];
}

function runsFromChips(chips: Chip[]): Run[] {
  const runs: Run[] = [];
  for (const chip of chips) {
    const last = runs[runs.length - 1];
    if (last && last.kind === chip.kind) last.count += 1;
    else runs.push({ kind: chip.kind, count: 1 });
  }
  return runs;
}

// Materialize runs into individual chips — the compression seam between
// Stack and Hand. Ids are minted here and discarded at commit.
function materialize(runs: Run[], firstId: ChipId): { chips: Chip[]; nextId: ChipId } {
  const chips: Chip[] = [];
  let id = firstId;
  for (const run of runs) {
    for (let i = 0; i < run.count; i++) chips.push({ id: id++, kind: run.kind });
  }
  return { chips, nextId: id };
}

// --- board ops ----------------------------------------------------------------

export function createBoard(catalog: Catalog, felt: Size): Board {
  return { catalog, felt, stacks: [], hand: null, nextChipId: 1, nextStackId: 1 };
}

export function setFelt(board: Board, felt: Size): Board {
  return { ...board, felt };
}

export function clearBoard(board: Board): Board {
  return { ...board, stacks: [], hand: null };
}

function sameSlot(a: Slot, b: Slot): boolean {
  return a.col === b.col && a.row === b.row;
}

function findStack(board: Board, id: StackId): Stack | undefined {
  return board.stacks.find((s) => s.id === id);
}

// Place runs at a slot: merges into the occupant when there is one.
export function placeRuns(board: Board, runs: Run[], slot: Slot): Board {
  const canonical = coalesce(runs);
  if (canonical.length === 0) return board;
  const occupant = board.stacks.find((s) => sameSlot(s.slot, slot));
  if (occupant) {
    return {
      ...board,
      stacks: board.stacks.map((s) =>
        s.id === occupant.id ? { ...s, runs: coalesce([...s.runs, ...canonical]) } : s,
      ),
    };
  }
  return {
    ...board,
    stacks: [...board.stacks, { id: board.nextStackId, slot, runs: canonical }],
    nextStackId: board.nextStackId + 1,
  };
}

// Tray / notation entry point — same semantics as commit placement.
export function spawnStack(board: Board, runs: Run[], slot: Slot): Board {
  return placeRuns(board, runs, slot);
}

function pick(board: Board, stackId: StackId, depth: number): Board {
  const stack = findStack(board, stackId);
  if (!stack || board.hand) return board;
  const size = runsSize(stack.runs);
  const cut = Math.max(0, Math.min(depth, size));
  if (cut <= 0) return pickStack(board, stackId);
  if (cut >= size) return board;
  const [lower, upper] = splitRuns(stack.runs, cut);
  const { chips, nextId } = materialize(upper, board.nextChipId);
  const stacks =
    runsSize(lower) === 0
      ? board.stacks.filter((s) => s.id !== stackId)
      : board.stacks.map((s) => (s.id === stackId ? { ...s, runs: lower } : s));
  return { ...board, stacks, hand: { chips, origin: stackId }, nextChipId: nextId };
}

// Top chip → hand.
export function pickTop(board: Board, stackId: StackId): Board {
  const stack = findStack(board, stackId);
  if (!stack) return board;
  return pick(board, stackId, runsSize(stack.runs) - 1);
}

// Upper half at the cut (depth chips stay) → hand. depth 0 takes all.
export function pickFrom(board: Board, stackId: StackId, depth: number): Board {
  return pick(board, stackId, depth);
}

// Whole stack → hand.
export function pickStack(board: Board, stackId: StackId): Board {
  const stack = findStack(board, stackId);
  if (!stack || board.hand) return board;
  const { chips, nextId } = materialize(stack.runs, board.nextChipId);
  return {
    ...board,
    stacks: board.stacks.filter((s) => s.id !== stackId),
    hand: { chips, origin: stackId },
    nextChipId: nextId,
  };
}

// Tray → hand (a one-chip hand; commit places it).
export function takeFromTray(board: Board, kind: KindId): Board {
  if (board.hand) return board;
  return {
    ...board,
    hand: { chips: [{ id: board.nextChipId, kind }], origin: null },
    nextChipId: board.nextChipId + 1,
  };
}

// Wheel: grow/shrink the hand within its kind and the stack capacity.
export function sizeHand(board: Board, delta: 1 | -1): Board {
  const hand = board.hand;
  if (!hand || hand.chips.length === 0) return board;
  const kind = hand.chips[0].kind;
  if (!hand.chips.every((c) => c.kind === kind)) return board;
  if (delta === 1) {
    if (hand.chips.length >= STACK_CAPACITY) return board;
    return {
      ...board,
      hand: { ...hand, chips: [...hand.chips, { id: board.nextChipId, kind }] },
      nextChipId: board.nextChipId + 1,
    };
  }
  if (hand.chips.length <= 1) return board;
  return { ...board, hand: { ...hand, chips: hand.chips.slice(0, -1) } };
}

// Release the hand at a slot: merges into the occupant when there is one,
// otherwise founds a new stack. Individual chips compress back to runs.
export function commitHand(board: Board, slot: Slot): Board {
  const hand = board.hand;
  if (!hand || hand.chips.length === 0) return board;
  return { ...placeRuns(board, runsFromChips(hand.chips), slot), hand: null };
}

export function discardHand(board: Board): Board {
  return { ...board, hand: null };
}

export function totalValue(board: Board): bigint {
  const stacks = board.stacks.reduce(
    (sum, s) => sum + runsValue(s.runs, board.catalog),
    0n,
  );
  const hand = board.hand
    ? board.hand.chips.reduce((sum, c) => sum + board.catalog[c.kind].value, 0n)
    : 0n;
  return stacks + hand;
}