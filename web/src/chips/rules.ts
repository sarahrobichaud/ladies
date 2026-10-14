import { CHIP_SQUASH } from '../engine/primitives';
import { allSlots, CHIP_RADIUS, slotPosition } from './lattice';
import type { Board, Point, Slot, Stack, StackId } from './types';

// Interaction constants — the feel knobs.
export const STACK_CAPACITY = 10; // wheel-sizing cap for a uniform hand
export const STACK_LIFT = 4; // chip thickness: vertical px between chips in a stack
export const PREVIEW_LIFT = 10; // hover preview: how far the upper half rises
export const COMBINE_BAND = 16; // vertical combine band above a stack's top chip
export const COMBINE_HALF_WIDTH = 20; // horizontal tolerance for the band

export function stackSize(stack: Stack): number {
  return stack.runs.reduce((n, r) => n + r.count, 0);
}

// The stack's top chip offset above its base, in px.
export function stackTopOffset(stack: Stack): number {
  return (stackSize(stack) - 1) * STACK_LIFT;
}

export type Pick = { stackId: StackId; depth: number; isTop: boolean };

// Hit-test against resting geometry. A chip is a squashed face ellipse
// plus its wall band below; the topmost chip whose face or wall contains
// the point wins, so preview animation can never shift the target under
// the cursor.
export function pickAt(board: Board, point: Point): Pick | null {
  for (const stack of board.stacks) {
    const { x: sx, y: sy } = slotPosition(stack.slot);
    if (Math.abs(sx - point.x) > CHIP_RADIUS) continue;
    const size = stackSize(stack);
    if (point.y < sy - stackTopOffset(stack) - CHIP_RADIUS * CHIP_SQUASH) continue;
    if (point.y > sy + CHIP_RADIUS * CHIP_SQUASH + STACK_LIFT) continue;
    for (let depth = size - 1; depth >= 0; depth--) {
      const cy = sy - depth * STACK_LIFT;
      const dx = sx - point.x;
      const dy = point.y - cy;
      // Face ellipse.
      const ey = dy / CHIP_SQUASH;
      if (dx * dx + ey * ey <= CHIP_RADIUS * CHIP_RADIUS) {
        return { stackId: stack.id, depth, isTop: depth === size - 1 };
      }
      // Wall band below the face belongs to this chip.
      const h = Math.sqrt(Math.max(0, CHIP_RADIUS * CHIP_RADIUS - dx * dx)) * CHIP_SQUASH;
      if (dy > h && dy <= h + STACK_LIFT) {
        return { stackId: stack.id, depth, isTop: depth === size - 1 };
      }
    }
  }
  return null;
}

export type Landing =
  | { type: 'combine'; stackId: StackId; slot: Slot; ring: Point }
  | { type: 'place'; slot: Slot; ring: Point }
  | { type: 'none' };

// What would happen if the hand were released at this point. The single
// authority for the landing preview and the commit — they cannot diverge.
//
// Combine: a stack whose top chip meets the hand's bottom chip — a thin
// band at the top of the existing stack, never its body. Otherwise the
// nearest FREE slot: an occupied slot never combines implicitly.
export function landingFor(board: Board, point: Point): Landing {
  const hand = board.hand;
  if (!hand || hand.chips.length === 0) return { type: 'none' };

  let target: Stack | null = null;
  let bestD = Infinity;
  for (const stack of board.stacks) {
    const { x: sx, y: sy } = slotPosition(stack.slot);
    const topY = sy - stackTopOffset(stack);
    if (point.y < topY - COMBINE_BAND || point.y > topY + 4) continue;
    const dx = Math.abs(sx - point.x);
    if (dx > COMBINE_HALF_WIDTH) continue;
    const d = dx + Math.abs(topY - point.y);
    if (d < bestD) {
      bestD = d;
      target = stack;
    }
  }
  if (target) {
    const { x, y } = slotPosition(target.slot);
    return {
      type: 'combine',
      stackId: target.id,
      slot: target.slot,
      ring: { x, y: y - stackSize(target) * STACK_LIFT },
    };
  }

  const slot = nearestFreeSlot(board, point.x, point.y);
  if (slot) return { type: 'place', slot, ring: slotPosition(slot) };
  return { type: 'none' };
}

// Nearest lattice slot with no stack on it. Null when the felt is full.
export function nearestFreeSlot(board: Board, x: number, y: number): Slot | null {
  const occupied = new Set(board.stacks.map((s) => `${s.slot.col},${s.slot.row}`));
  let best: Slot | null = null;
  let bestD = Infinity;
  for (const slot of allSlots(board.felt)) {
    if (occupied.has(`${slot.col},${slot.row}`)) continue;
    const { x: sx, y: sy } = slotPosition(slot);
    const d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return best;
}

// Nearest slot regardless of occupancy — the felt-full commit fallback.
export function nearestSlotAny(board: Board, x: number, y: number): Slot | null {
  let best: Slot | null = null;
  let bestD = Infinity;
  for (const slot of allSlots(board.felt)) {
    const { x: sx, y: sy } = slotPosition(slot);
    const d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return best;
}

// Wheel-sizing preconditions: a uniform hand, within the stack capacity.
export function canSize(board: Board, delta: 1 | -1): boolean {
  const hand = board.hand;
  if (!hand || hand.chips.length === 0) return false;
  const kind = hand.chips[0].kind;
  if (!hand.chips.every((c) => c.kind === kind)) return false;
  return delta === 1 ? hand.chips.length < STACK_CAPACITY : hand.chips.length > 1;
}