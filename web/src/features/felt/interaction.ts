import { type Felt, STACK_HEIGHT_CAP, type Stack, type StackId, stackSize } from "./felt";
import type { Point } from "./geom";
import { allSlots, type Slot, slotPosition } from "./lattice";
import { BUTTON_HALF_HEIGHT, BUTTON_HALF_WIDTH, CHIP_RADIUS, CHIP_SQUASH, rpx, STACK_LIFT } from "./world";
import { isPlaceable, resolveZones, type Zone, zoneAt } from "./zones";

/** Pointer semantics against the resting felt, as pure geometry. */

/** Hover preview lift for the upper half, as a fraction of the chip radius. */
export const PREVIEW_LIFT = rpx(0.29);

/** Combine band height above a stack's top chip, as a fraction of the chip radius. */
export const COMBINE_BAND = rpx(0.46);

/** Combine band horizontal half-tolerance, as a fraction of the chip radius. */
export const COMBINE_HALF_WIDTH = rpx(0.57);

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
    if (Math.abs(sx - point.x) > CHIP_RADIUS) {
      continue;
    }

    const size = stackSize(stack);
    const topOffset = stackTopOffset(stack);
    if (point.y < sy - topOffset - CHIP_RADIUS * CHIP_SQUASH) {
      continue;
    }
    if (point.y > sy + CHIP_RADIUS * CHIP_SQUASH + STACK_LIFT) {
      continue;
    }

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
  | { type: "combine"; stackId: StackId; slot: Slot; ring: Point }
  | { type: "place"; slot: Slot; ring: Point }
  | { type: "discard" }
  | { type: "none" };

/**
 * Single authority for the landing preview and the commit; occupied slots
 * never combine implicitly, and drops off the felt discard unless they land
 * on a stack, whose column may reach above the felt top.
 * @param felt - The felt holding the hand and resting stacks.
 * @param point - The pointer position in felt pixels.
 */
export function landingFor(felt: Felt, point: Point): Landing {
  const hand = felt.hand;
  if (!hand || hand.chips.length === 0) {
    return { type: "none" };
  }

  const target = combineTargetAt(felt, point);
  // A combine that would breach the stack height cap is not offered.
  if (target && stackSize(target) + hand.chips.length <= STACK_HEIGHT_CAP) {
    const { x, y } = slotPosition(target.slot);
    return {
      type: "combine",
      stackId: target.id,
      slot: target.slot,
      ring: { x, y: y - stackSize(target) * STACK_LIFT },
    };
  }

  // Off the felt: nowhere to land except the stack top handled above.
  if (point.x < 0 || point.x > felt.felt.w || point.y < 0 || point.y > felt.felt.h) {
    return { type: "discard" };
  }

  const slot = nearestFreeSlot(felt, point.x, point.y);
  if (slot) {
    return { type: "place", slot, ring: slotPosition(slot) };
  }
  return { type: "none" };
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
    // The whole stack column combines: tall stacks reach above the felt top,
    // so a drop on any of their chips must merge rather than discard.
    if (point.y < topY - COMBINE_BAND || point.y > sy + CHIP_RADIUS * CHIP_SQUASH + STACK_LIFT) {
      continue;
    }

    const dx = Math.abs(sx - point.x);
    if (dx > COMBINE_HALF_WIDTH) {
      continue;
    }

    const distance = dx + Math.abs(topY - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = stack;
    }
  }
  return target;
}

/**
 * Nearest unoccupied slot in a zone that accepts chips, or null when every placeable slot is taken.
 * @param felt - The felt whose zones, stacks, and surface define the candidates.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 */
export function nearestFreeSlot(felt: Felt, x: number, y: number): Slot | null {
  const occupied = new Set(felt.stacks.map((s) => `${s.slot.col},${s.slot.row}`));
  return nearestPlaceableWhere(felt, x, y, (slot) => !occupied.has(`${slot.col},${slot.row}`));
}

/**
 * Nearest slot in a zone that accepts chips, regardless of occupancy — the zones-full fallback.
 * @param felt - The felt whose zones and surface define the candidates.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 */
export function nearestPlaceableSlot(felt: Felt, x: number, y: number): Slot | null {
  return nearestPlaceableWhere(felt, x, y, () => true);
}

/**
 * Zone whose slot's button face contains the point, or null.
 * @param felt - The felt whose button zones are hit-tested.
 * @param point - The pointer position in felt pixels.
 */
export function buttonZoneAt(felt: Felt, point: Point): Zone | null {
  const zones = resolveZones(felt.layout, felt.felt);
  for (const zone of zones) {
    if (zone.purpose !== "button") {
      continue;
    }
    for (const slot of zone.slots) {
      const { x, y } = slotPosition(slot);
      const halfH = BUTTON_HALF_HEIGHT * CHIP_SQUASH;
      if (Math.abs(point.x - x) <= BUTTON_HALF_WIDTH && Math.abs(point.y - y) <= halfH) {
        return zone;
      }
    }
  }
  return null;
}

/**
 * Nearest placeable slot passing the filter, or null.
 * @param felt - The felt whose zones and surface define the candidates.
 * @param x - The pointer x in felt pixels.
 * @param y - The pointer y in felt pixels.
 * @param isCandidate - Decides whether a placeable slot may be returned.
 */
function nearestPlaceableWhere(felt: Felt, x: number, y: number, isCandidate: (slot: Slot) => boolean): Slot | null {
  const zones = resolveZones(felt.layout, felt.felt);
  let best: Slot | null = null;
  let bestDistance = Infinity;
  for (const slot of allSlots(felt.felt)) {
    const zone = zoneAt(zones, slot);
    if (!zone || !isPlaceable(zone.purpose) || !isCandidate(slot)) {
      continue;
    }
    const { x: sx, y: sy } = slotPosition(slot);
    const distance = (sx - x) ** 2 + (sy - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return best;
}
