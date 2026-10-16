import type { Point, Size } from "./geom";
import { CHIP_RADIUS, SLOT_ROW_HEIGHT, SLOT_SPACING } from "./world";

/** Staggered slot lattice; odd rows offset half a spacing so slots align on diagonals. */

/** Address of one slot in the lattice. */
export type Slot = { col: number; row: number };

/** Count of lattice slots along each axis that fit inside the felt. */
export type GridExtents = { cols: number; rows: number };

/**
 * Pixel position of a slot's center.
 * @param slot - The slot to convert.
 */
export function slotPosition(slot: Slot): Point {
  const rowOffset = slot.row % 2 === 1 ? SLOT_SPACING / 2 : 0;
  return {
    x: slot.col * SLOT_SPACING + rowOffset,
    y: slot.row * SLOT_ROW_HEIGHT,
  };
}

/**
 * Whether a slot's chip fits fully inside the felt.
 * @param slot - The slot to check.
 * @param felt - The felt size in pixels.
 */
export function isInBounds(slot: Slot, felt: Size): boolean {
  const { x, y } = slotPosition(slot);
  return x >= CHIP_RADIUS && x <= felt.w - CHIP_RADIUS && y >= CHIP_RADIUS && y <= felt.h - CHIP_RADIUS;
}

/**
 * Count of lattice slots along each axis that fit inside the felt.
 * @param felt - The felt size in pixels.
 */
export function gridExtents(felt: Size): GridExtents {
  return {
    cols: Math.max(0, Math.floor((felt.w - CHIP_RADIUS) / SLOT_SPACING) + 1),
    rows: Math.max(0, Math.floor((felt.h - CHIP_RADIUS) / SLOT_ROW_HEIGHT) + 1),
  };
}

/**
 * Every slot whose chip fits fully inside the felt.
 * @param felt - The felt size in pixels.
 */
export function allSlots(felt: Size): Slot[] {
  const slots: Slot[] = [];
  for (let row = 0; row * SLOT_ROW_HEIGHT <= felt.h; row++) {
    for (let col = 0; col * SLOT_SPACING <= felt.w + SLOT_SPACING / 2; col++) {
      const slot = { col, row };
      if (isInBounds(slot, felt)) {
        slots.push(slot);
      }
    }
  }
  return slots;
}
