import { coalesce, materialize, runsFromChips, runsSize, runsValue, splitRuns } from "../chips/runs";
import type { Catalog, Chip, KindId, Run } from "../chips/types";
import type { Size } from "./geom";
import type { Slot } from "./lattice";

/**
 * Felt state and pure Felt → Felt ops that keep the invariants
 * (one hand, one stack per slot, canonical runs, non-empty stacks);
 * rejected moves return the felt unchanged.
 */

/** Wheel-sizing cap for a uniform hand; part of the sizeHand precondition. */
export const STACK_CAPACITY = 10;

/** Unique identifier for a stack resting on the felt. */
export type StackId = number;

/** A compressed pile of chips resting at one slot, ordered bottom → top. */
export type Stack = { id: StackId; slot: Slot; runs: Run[] };

/** The chips currently being dragged, plus the stack they came from (null for tray spawns). */
export type Hand = { chips: Chip[]; origin: StackId | null };

/** The whole felt state: felt size, resting stacks, and the optional hand. */
export type Felt = {
  catalog: Catalog;
  felt: Size;
  stacks: Stack[];
  hand: Hand | null;
  nextChipId: number;
  nextStackId: number;
};

/**
 * Number of chips in a stack.
 * @param stack - The stack to measure.
 */
export function stackSize(stack: Stack): number {
  return runsSize(stack.runs);
}

/**
 * An empty felt of the given size.
 * @param catalog - The chip catalog for value lookups.
 * @param felt - The felt size in pixels.
 */
export function createBoard(catalog: Catalog, felt: Size): Felt {
  return { catalog, felt, stacks: [], hand: null, nextChipId: 1, nextStackId: 1 };
}

/**
 * Resizes the felt surface, keeping stacks and hand.
 * @param felt - The felt to update.
 * @param size - The new felt size in pixels.
 */
export function setFelt(felt: Felt, size: Size): Felt {
  return { ...felt, felt: size };
}

/**
 * Removes all stacks and the hand.
 * @param felt - The felt to clear.
 */
export function clearBoard(felt: Felt): Felt {
  return { ...felt, stacks: [], hand: null };
}

/**
 * Whether two slots are the same lattice address.
 * @param a - First slot.
 * @param b - Second slot.
 */
function sameSlot(a: Slot, b: Slot): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * Finds a stack by id.
 * @param felt - The felt to search.
 * @param id - The stack id to find.
 */
function findStack(felt: Felt, id: StackId): Stack | undefined {
  return felt.stacks.find((s) => s.id === id);
}

/**
 * Places runs at a slot, merging into the occupant when there is one.
 * @param felt - The felt to update.
 * @param runs - The runs to place.
 * @param slot - The slot to place them at.
 */
export function placeRuns(felt: Felt, runs: Run[], slot: Slot): Felt {
  const canonical = coalesce(runs);
  if (canonical.length === 0) {
    return felt;
  }
  const occupant = felt.stacks.find((s) => sameSlot(s.slot, slot));
  if (occupant) {
    return {
      ...felt,
      stacks: felt.stacks.map((s) => (s.id === occupant.id ? { ...s, runs: coalesce([...s.runs, ...canonical]) } : s)),
    };
  }
  return {
    ...felt,
    stacks: [...felt.stacks, { id: felt.nextStackId, slot, runs: canonical }],
    nextStackId: felt.nextStackId + 1,
  };
}

/**
 * Tray / notation entry point — same semantics as commit placement.
 * @param felt - The felt to update.
 * @param runs - The runs to spawn.
 * @param slot - The slot to spawn them at.
 */
export function spawnStack(felt: Felt, runs: Run[], slot: Slot): Felt {
  return placeRuns(felt, runs, slot);
}

/**
 * Splits a stack at the cut, sending the upper chips to the hand.
 * @param felt - The felt to update.
 * @param stackId - The stack to pick from.
 * @param depth - Chips staying below the cut; 0 takes the whole stack.
 */
function pick(felt: Felt, stackId: StackId, depth: number): Felt {
  const stack = findStack(felt, stackId);
  if (!stack || felt.hand) {
    return felt;
  }
  const size = runsSize(stack.runs);
  const cut = Math.max(0, Math.min(depth, size));
  if (cut <= 0) {
    return pickStack(felt, stackId);
  }
  if (cut >= size) {
    return felt;
  }
  const [lower, upper] = splitRuns(stack.runs, cut);
  const { chips, nextId } = materialize(upper, felt.nextChipId);
  const stacks =
    runsSize(lower) === 0
      ? felt.stacks.filter((s) => s.id !== stackId)
      : felt.stacks.map((s) => (s.id === stackId ? { ...s, runs: lower } : s));
  return { ...felt, stacks, hand: { chips, origin: stackId }, nextChipId: nextId };
}

/**
 * Takes a stack's top chip into the hand.
 * @param felt - The felt to update.
 * @param stackId - The stack to pick from.
 */
export function pickTop(felt: Felt, stackId: StackId): Felt {
  const stack = findStack(felt, stackId);
  if (!stack) {
    return felt;
  }
  return pick(felt, stackId, runsSize(stack.runs) - 1);
}

/**
 * Takes the upper half at the cut (depth chips stay) into the hand; depth 0 takes all.
 * @param felt - The felt to update.
 * @param stackId - The stack to pick from.
 * @param depth - Chips staying below the cut.
 */
export function pickFrom(felt: Felt, stackId: StackId, depth: number): Felt {
  return pick(felt, stackId, depth);
}

/**
 * Takes a whole stack into the hand.
 * @param felt - The felt to update.
 * @param stackId - The stack to pick up.
 */
export function pickStack(felt: Felt, stackId: StackId): Felt {
  const stack = findStack(felt, stackId);
  if (!stack || felt.hand) {
    return felt;
  }
  const { chips, nextId } = materialize(stack.runs, felt.nextChipId);
  return {
    ...felt,
    stacks: felt.stacks.filter((s) => s.id !== stackId),
    hand: { chips, origin: stackId },
    nextChipId: nextId,
  };
}

/**
 * Takes one chip from the tray into the hand.
 * @param felt - The felt to update.
 * @param kind - The chip kind to take.
 */
export function takeFromTray(felt: Felt, kind: KindId): Felt {
  if (felt.hand) {
    return felt;
  }
  return {
    ...felt,
    hand: { chips: [{ id: felt.nextChipId, kind }], origin: null },
    nextChipId: felt.nextChipId + 1,
  };
}

/**
 * Grows or shrinks a uniform hand within the stack capacity.
 * @param felt - The felt to update.
 * @param delta - Grow or shrink by one chip.
 */
export function sizeHand(felt: Felt, delta: 1 | -1): Felt {
  const hand = felt.hand;
  if (!hand || hand.chips.length === 0) {
    return felt;
  }
  const kind = hand.chips[0].kind;
  if (!hand.chips.every((c) => c.kind === kind)) {
    return felt;
  }
  if (delta === 1) {
    if (hand.chips.length >= STACK_CAPACITY) {
      return felt;
    }
    return {
      ...felt,
      hand: { ...hand, chips: [...hand.chips, { id: felt.nextChipId, kind }] },
      nextChipId: felt.nextChipId + 1,
    };
  }
  if (hand.chips.length <= 1) {
    return felt;
  }
  return { ...felt, hand: { ...hand, chips: hand.chips.slice(0, -1) } };
}

/**
 * Releases the hand at a slot, merging into the occupant or founding a new stack.
 * @param felt - The felt to update.
 * @param slot - The slot to commit at.
 */
export function commitHand(felt: Felt, slot: Slot): Felt {
  const hand = felt.hand;
  if (!hand || hand.chips.length === 0) {
    return felt;
  }
  return { ...placeRuns(felt, runsFromChips(hand.chips), slot), hand: null };
}

/**
 * Drops the hand without placing.
 * @param felt - The felt to update.
 */
export function discardHand(felt: Felt): Felt {
  return { ...felt, hand: null };
}

/**
 * Total value of all resting chips plus the hand.
 * @param felt - The felt to sum.
 */
export function totalValue(felt: Felt): bigint {
  const stacks = felt.stacks.reduce((sum, s) => sum + runsValue(s.runs, felt.catalog), 0n);
  const hand = felt.hand ? felt.hand.chips.reduce((sum, c) => sum + felt.catalog[c.kind].value, 0n) : 0n;
  return stacks + hand;
}
