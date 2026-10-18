import { allSlots, gridExtents, type Slot } from "./lattice";

/**
 * Marked subsets of the lattice: each slot may belong to a zone that states
 * what the slot region is for. The full grid stays universal; zones narrow
 * where placements are accepted and what renders at a slot.
 */

/** What a slot region is for. */
export type ZonePurpose = "stack" | "bet" | "button" | "card";

/** Inclusive slot-index range along one axis; negative values count from the end. */
export type SlotRange = { from: number; to: number };

/** Declarative zone definition, resolved against the felt size. */
export type ZoneSpec = {
  id: string;
  purpose: ZonePurpose;
  /** Every lattice slot, or a rect of slot indices as [cols, rows] ranges. */
  slots: "all" | { cols: SlotRange; rows: SlotRange };
  /** Button-only: text drawn on the button face. */
  label?: string;
  /** Button-only: id of the zone this button commits. */
  commits?: string;
};

/** A resolved zone: the concrete slots it marks. */
export type Zone = {
  id: string;
  purpose: ZonePurpose;
  slots: Slot[];
  /** Button-only: text drawn on the button face. */
  label?: string;
  /** Button-only: id of the zone this button commits. */
  commits?: string;
};

/** Default layout: one stack zone covering the whole lattice. */
export const FREE_LAYOUT: readonly ZoneSpec[] = [{ id: "free", purpose: "stack", slots: "all" }];

/**
 * Table layout: three zones across the wide lattice.
 * Left: player chip stacks. Center: bet zone in the top half, open play below.
 * Right: player card slots (placeholders for now).
 */
export const TABLE_LAYOUT: readonly ZoneSpec[] = [
  { id: "stacks", purpose: "stack", slots: { cols: { from: 0, to: 6 }, rows: { from: 0, to: -1 } } },
  { id: "bet", purpose: "bet", slots: { cols: { from: 8, to: 15 }, rows: { from: 0, to: 2 } } },
  { id: "play", purpose: "stack", slots: { cols: { from: 8, to: 15 }, rows: { from: 3, to: -1 } } },
  { id: "cards", purpose: "card", slots: { cols: { from: 17, to: -1 }, rows: { from: 0, to: -1 } } },
];

/**
 * Whether a slot resolved to this purpose accepts resting chips.
 * @param purpose - the zone purpose to check
 */
export function isPlaceable(purpose: ZonePurpose): boolean {
  return purpose === "stack" || purpose === "bet";
}

/**
 * Resolves each spec against the fixed slot map, in order.
 * @param specs - the declarative layout to resolve
 */
export function resolveZones(specs: readonly ZoneSpec[]): Zone[] {
  return specs.map((spec) => ({
    ...spec,
    slots: spec.slots === "all" ? allSlots() : planarSlots(spec.slots),
  }));
}

/**
 * Finds the zone governing a slot; later specs override earlier ones.
 * @param zones - resolved zones, in layout order
 * @param slot - the slot to look up
 */
export function zoneAt(zones: readonly Zone[], slot: Slot): Zone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    if (zone.slots.some((s) => s.row === slot.row && s.col === slot.col)) {
      return zone;
    }
  }
  return null;
}

/**
 * Finds a resolved zone by id.
 * @param zones - resolved zones, in layout order
 * @param id - the zone id to find
 */
export function zoneById(zones: readonly Zone[], id: string): Zone | null {
  return zones.find((zone) => zone.id === id) ?? null;
}

/**
 * Every slot of a rect spec in felt grid units.
 * @param rects - the cols/rows slot-index ranges
 */
function planarSlots(rects: { cols: SlotRange; rows: SlotRange }): Slot[] {
  const { cols, rows } = gridExtents();
  const slots: Slot[] = [];
  for (let row = boundedFrom(rects.rows, rows); row <= boundedTo(rects.rows, rows); row++) {
    for (let col = boundedFrom(rects.cols, cols); col <= boundedTo(rects.cols, cols); col++) {
      slots.push({ col, row });
    }
  }
  return slots;
}

/**
 * First slot index of a range, clamped into the grid axis.
 * @param range - the range to resolve
 * @param count - slots along the axis the range addresses
 */
function boundedFrom(range: SlotRange, count: number): number {
  return Math.max(0, range.from < 0 ? count + range.from : range.from);
}

/**
 * Last slot index of a range, clamped into the grid axis.
 * @param range - the range to resolve
 * @param count - slots along the axis the range addresses
 */
function boundedTo(range: SlotRange, count: number): number {
  return Math.min(count - 1, range.to < 0 ? count + range.to : range.to);
}
