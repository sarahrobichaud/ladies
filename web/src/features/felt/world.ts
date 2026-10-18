import type { Size } from "./geom";

/** Chip face diameter in px — the single world-scale knob; the DOM chip derives its size from this. */
export const CHIP_DIAMETER = 70;

/** Chip face radius in px. */
export const CHIP_RADIUS = CHIP_DIAMETER / 2;

/** World px from a fraction of the chip radius, snapped to the pixel grid. */
export const rpx = (fraction: number) => Math.round(CHIP_RADIUS * fraction);

/** Vertical squash of the oblique camera: sin(elevation), so 0.75 ≈ looking down from ~48.6°. */
export const CHIP_SQUASH = 0.75;

/** Stylized chip thickness as a fraction of the radius; real chips would project to ~0.11 R. */
export const CHIP_THICKNESS_RATIO = 0.27;

/** Screen px between consecutive chip centers in a stack, snapped to the pixel grid. */
export const STACK_LIFT = rpx(CHIP_THICKNESS_RATIO);

// Face paint, injected into the chip/wall shaders as uniforms at program init.

/** Angular half-width of the edge spots and wall stripes, in radians. */
export const SPOT_HALF_WIDTH = 0.08;

/** Inner radius of the face spots, in px. */
export const SPOT_INNER_RADIUS = 0.72 * CHIP_RADIUS;

/** Radius of the dashed inner ring, in px. */
export const INNER_RING_RADIUS = 0.568 * CHIP_RADIUS;

/** Inner-ring dash pattern: [arc period, arc on] as fractions of the chip radius. */
export const INNER_DASH: readonly [number, number] = [rpx(0.2), rpx(0.115)];

/** Breathing gap between neighboring slot centers, as a fraction of the chip radius. */
export const SLOT_GAP = rpx(0.2);

/** Distance between slot centers within a row, in px. */
export const SLOT_SPACING = CHIP_DIAMETER + SLOT_GAP;

/** Row height of the staggered lattice: spacing × √3/2, snapped to the pixel grid. */
export const SLOT_ROW_HEIGHT = Math.round(SLOT_SPACING * (Math.sqrt(3) / 2));

// The slot map: dev-controlled lattice extents the felt always shows, sized
// for three areas (player stack left, bet zone center front, cards right).

/** Lattice columns of the fixed slot map. */
export const MAP_COLS = 12;

/** Lattice rows of the fixed slot map; the camera always shows all of them. */
export const MAP_ROWS = 6;

/**
 * Felt surface size in world px that fits the fixed slot map; the half-slot
 * margins land the enumeration on exactly MAP_ROWS rows and MAP_COLS columns
 * per row (odd rows gain the staggered edge column).
 */
export const MAP_SIZE: Size = {
  w: Math.round((MAP_COLS + 0.5) * SLOT_SPACING + CHIP_RADIUS),
  h: Math.round((MAP_ROWS + 0.5) * SLOT_ROW_HEIGHT + CHIP_RADIUS),
};

/** Button slot half-width in px; buttons live on lattice slots but needn't be chip-shaped. */
export const BUTTON_HALF_WIDTH = rpx(1.18);

/** Button slot half-height in px before the oblique squash. */
export const BUTTON_HALF_HEIGHT = rpx(0.68);
