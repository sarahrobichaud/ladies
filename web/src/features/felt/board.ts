import {
  coalesce,
  materialize,
  runsFromChips,
  runsSize,
  runsValue,
  splitRuns,
} from '../chips/runs';
import type { Catalog, Chip, KindId, Run } from '../chips/types';
import type { Slot } from './lattice';
import type { Size } from './geom';

// The felt board: stacks resting on lattice slots, plus the hand of chips
// being dragged. Pure data transitions — every op is a total
// Board → Board function that keeps the invariants (one hand, one stack
// per slot, canonical runs, non-empty stacks). Rejected moves return the
// board unchanged (callers can compare references).

// Wheel-sizing cap for a uniform hand. Part of the sizeHand precondition.
export const STACK_CAPACITY = 10;

// Unique identifier for a stack resting on the board.
export type StackId = number;

// A compressed pile of chips resting at one slot, ordered bottom → top.
export type Stack = { id: StackId; slot: Slot; runs: Run[] };

// The chips currently being dragged, plus the stack they came from (null for tray spawns).
export type Hand = { chips: Chip[]; origin: StackId | null };

// The whole felt state: felt size, resting stacks, and the optional hand.
export type Board = {
  catalog: Catalog;
  felt: Size;
  stacks: Stack[];
  hand: Hand | null;
  nextChipId: number;
  nextStackId: number;
};

export function stackSize(stack: Stack): number {
  return runsSize(stack.runs);
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
