import { CHIP_RADIUS, CHIP_SQUASH, STACK_LIFT } from './world';
import { allSlots, slotPosition, type Slot } from './lattice';
import { stackSize, type Felt, type Stack, type StackId } from './felt';
import type { Point } from './geom';

/** Pointer semantics against the resting felt, as pure geometry. */

/** Hover preview lift for the upper half, in px. */
export const PREVIEW_LIFT = 10;

/** Combine band height above a stack's top chip, in px. */
export const COMBINE_BAND = 16;

/** Combine band horizontal half-tolerance, in px. */
export const COMBINE_HALF_WIDTH = 20;

/**
 * Top chip's offset above the stack's base, in px.
 * @param stack - The stack to measure.
 */
export function stackTopOffset(stack: Stack): number {
  return (stackSize(stack) - 1) * STACK_LIFT;
}

/** A pointer hit: stack, chip depth, and whether it's the top chip. */
export type Pick = { stackId: StackId; depth: number; isTop: boolean };

/** The hand being dragged: which pointer holds it and the grab offset. */
export type Drag = { pointerId: number; grabX: number; grabY: number };

/** The cut-preview animation: which stack, at what depth, lifted how far. */
export type Lift = { stackId: number; depth: number; value: number };

/**
 * Topmost chip containing the point, so previews can't shift the target under the cursor.
 * @param felt - The felt to hit-test against.
 * @param point - The pointer position in felt pixels.
 */
export function pickAt(felt: Felt, point: Point): Pick | null {
  for (const stack of felt.stacks) {
    const { x: sx, y: sy } = slotPosition(stack.slot);
    if (Math.abs(sx - point.x) > CHIP_RADIUS) continue;

    const size = stackSize(stack);
    const topOffset = stackTopOffset(stack);
    if (point.y < sy - topOffset - CHIP_RADIUS * CHIP_SQUASH) continue;
    if (point.y > sy + CHIP_RADIUS * CHIP_SQUASH + STACK_LIFT) continue;

    for (let depth = size - 1; depth >= 0; depth--) {
      const chipY = sy - depth * STACK_LIFT;
      const dx = sx - point.x;
      const dy = point.y - chipY;
      if (faceContains(dx, dy) || wallContains(dx, dy)) {
        return { stackId: stack.id, depth, isTop: depth === size - 1 };
      }
    }
  }
  return null;
}

/** Whether an offset from a chip's center lands inside its face ellipse. */
function faceContains(dx: number, dy: number): boolean {
  const ey = dy / CHIP_SQUASH;
  return dx * dx + ey * ey <= CHIP_RADIUS * CHIP_RADIUS;
}

/** Whether an offset from a chip's center lands in the wall band below its face. */
function wallContains(dx: number, dy: number): boolean {
  const halfHeight = Math.sqrt(Math.max(0, CHIP_RADIUS * CHIP_RADIUS - dx * dx)) * CHIP_SQUASH;
  return dy > halfHeight && dy <= halfHeight + STACK_LIFT;
}

/** The outcome of releasing the hand at a point. */
export type Landing =
  | { type: 'combine'; stackId: StackId; slot: Slot; ring: Point }
  | { type: 'place'; slot: Slot; ring: Point }
  | { type: 'none' };

/**
 * Single authority for the landing preview and the commit; occupied slots never combine implicitly.
 * @param felt - The felt holding the hand and resting stacks.
 * @param point - The pointer position in felt pixels.
 */
export function landingFor(felt: Felt, point: Point): Landing {
  const hand = felt.hand;
  if (!hand || hand.chips.length === 0) return { type: 'none' };

  const target = combineTargetAt(felt, point);
  if (target) {
    const { x, y } = slotPosition(target.slot);
    return {
      type: 'combine',
      stackId: target.id,
      slot: target.slot,
      ring: { x, y: y - stackSize(target) * STACK_LIFT },
    };
  }

  const slot = nearestFreeSlot(felt, point.x, point.y);
  if (slot) return { type: 'place', slot, ring: slotPosition(slot) };
  return { type: 'none' };
}

/**
 * Nearest stack whose top chip is within the combine band, or null.
 * @param felt - The felt whose stacks are searched.
 * @param point - The pointer position in felt pixels.
 */
function combineTargetAt(felt: Felt, point: Point): Stack | null {
  let target: Stack | null = null;
  let bestDistance = Infinity;
  for (const stack of felt.stacks) {
    const { x: sx, y: sy } = slotPosition(stack.slot);
    const topY = sy - stackTopOffset(stack);
    if (point.y < topY - COMBINE_BAND || point.y > topY + 4) continue;

    const dx = Math.abs(sx - point.x);
    if (dx > COMBINE_HALF_WIDTH) continue;

    const distance = dx + Math.abs(topY - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = stack;
    }
  }
  return target;
}

/**
 * Nearest unoccupied slot, or null when the felt is full.
 * @param felt - The felt whose stacks and surface define occupancy.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 */
export function nearestFreeSlot(felt: Felt, x: number, y: number): Slot | null {
  const occupied = new Set(felt.stacks.map((s) => `${s.slot.col},${s.slot.row}`));
  return nearestSlotWhere(felt, x, y, (slot) => !occupied.has(`${slot.col},${slot.row}`));
}

/**
 * Nearest slot regardless of occupancy — the felt-full fallback.
 * @param felt - The felt whose surface defines the slot set.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 */
export function nearestSlotAny(felt: Felt, x: number, y: number): Slot | null {
  return nearestSlotWhere(felt, x, y, () => true);
}

/**
 * Nearest slot passing the filter, or null.
 * @param felt - The felt whose surface defines the slot set.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 * @param isCandidate - Decides whether a slot may be returned.
 */
function nearestSlotWhere(
  felt: Felt,
  x: number,
  y: number,
  isCandidate: (slot: Slot) => boolean,
): Slot | null {
  let best: Slot | null = null;
  let bestDistance = Infinity;
  for (const slot of allSlots(felt.felt)) {
    if (!isCandidate(slot)) continue;
    const { x: sx, y: sy } = slotPosition(slot);
    const distance = (sx - x) ** 2 + (sy - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
}
