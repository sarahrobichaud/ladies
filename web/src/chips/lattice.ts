import type { Point, Size, Slot } from './types';

// Staggered circle-slot lattice: every other row offset half a spacing so
// slots align along diagonals. Row height is spacing·√3/2, making every
// slot equidistant from its six neighbours — a circle packing.
export const SLOT_SPACING = 52;
export const SLOT_ROW_HEIGHT = 45;
export const CHIP_RADIUS = 22; // matches the 44px chips

export function slotPosition(slot: Slot): Point {
  return {
    x: slot.col * SLOT_SPACING + (slot.row % 2 === 1 ? SLOT_SPACING / 2 : 0),
    y: slot.row * SLOT_ROW_HEIGHT,
  };
}

export function isInBounds(slot: Slot, felt: Size): boolean {
  const { x, y } = slotPosition(slot);
  return (
    x >= CHIP_RADIUS &&
    x <= felt.w - CHIP_RADIUS &&
    y >= CHIP_RADIUS &&
    y <= felt.h - CHIP_RADIUS
  );
}

// Every lattice slot that fits the felt, keeping centers a chip radius
// from the edges so chips never land half-clipped.
export function allSlots(felt: Size): Slot[] {
  const slots: Slot[] = [];
  for (let row = 0; row * SLOT_ROW_HEIGHT <= felt.h; row++) {
    for (let col = 0; col * SLOT_SPACING <= felt.w + SLOT_SPACING / 2; col++) {
      const slot = { col, row };
      if (isInBounds(slot, felt)) slots.push(slot);
    }
  }
  return slots;
}