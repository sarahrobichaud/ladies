import { CHIP_SIZE } from "../chips/chip";

/** Chip face radius in CSS px — the single world-scale knob, derived from the DOM chip's size. */
export const CHIP_RADIUS = CHIP_SIZE / 2;

/** Vertical squash of the oblique camera: sin(elevation), so 0.75 ≈ looking down from ~48.6°. */
export const CHIP_SQUASH = 0.75;

/** Chip face diameter in CSS px. */
export const CHIP_DIAMETER = 2 * CHIP_RADIUS;

/** Stylized chip thickness as a fraction of the radius; real chips would project to ~0.11 R. */
export const CHIP_THICKNESS_RATIO = 0.27;

/** Screen px between consecutive chip centers in a stack, snapped to the pixel grid. */
export const STACK_LIFT = Math.round(CHIP_THICKNESS_RATIO * CHIP_RADIUS);

// Face paint, injected into the chip/wall shaders as uniforms at program init.

/** Angular half-width of the edge spots and wall stripes, in radians. */
export const SPOT_HALF_WIDTH = 0.08;

/** Inner radius of the face spots, in px. */
export const SPOT_INNER_RADIUS = 0.72 * CHIP_RADIUS;

/** Radius of the dashed inner ring, in px. */
export const INNER_RING_RADIUS = 0.568 * CHIP_RADIUS;

/** Inner-ring dash pattern: [arc period, arc on] in px. */
export const INNER_DASH: readonly [number, number] = [7, 4];

/** Breathing gap between neighboring slot centers, in px. */
export const SLOT_GAP = 7;

/** Distance between slot centers within a row, in px. */
export const SLOT_SPACING = CHIP_DIAMETER + SLOT_GAP;

/** Row height of the staggered lattice: spacing × √3/2, snapped to the pixel grid. */
export const SLOT_ROW_HEIGHT = Math.round(SLOT_SPACING * (Math.sqrt(3) / 2));

/** Button slot half-width in px; buttons live on lattice slots but needn't be chip-shaped. */
export const BUTTON_HALF_WIDTH = 26;

/** Button slot half-height in px before the oblique squash. */
export const BUTTON_HALF_HEIGHT = 15;
