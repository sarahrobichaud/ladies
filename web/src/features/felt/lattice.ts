import type { Point, Size } from "./geom";
import { CHIP_RADIUS, MAP_COLS, MAP_ROWS, MAP_SIZE, SLOT_ROW_HEIGHT, SLOT_SPACING } from "./world";

/** The fixed slot map: a dev-controlled staggered lattice; odd rows offset half a spacing so slots align on diagonals. */

/** Address of one slot in the lattice. */
export type Slot = { col: number; row: number };

/** Count of lattice slots along each axis in the fixed map. */
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
 * Extent zone rect ranges resolve against: the closed enumeration ranges of
 * `allSlots` (0..MAP_COLS, 0..MAP_ROWS inclusive), so negative indices count
 * from the last enumerated slot and rects can cover the whole felt.
 */
export function gridExtents(): GridExtents {
  return { cols: MAP_COLS + 1, rows: MAP_ROWS + 1 };
}

/**
 * Every slot of the fixed map whose chip fits fully inside the map felt.
 */
export function allSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let row = 0; row <= MAP_ROWS; row++) {
    for (let col = 0; col <= MAP_COLS; col++) {
      const slot = { col, row };
      if (isInBounds(slot, MAP_SIZE)) {
        slots.push(slot);
      }
    }
  }
  return slots;
}
