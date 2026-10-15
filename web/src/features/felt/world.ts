// The felt's world model. Every geometric constant of the felt world
// derives from two primitives — chip radius and camera elevation — so
// proportions stay coherent and re-proportioning the world is a one-line
// edit. The numbers were never arbitrary, but the couplings were implicit
// (spacing = 2R + gap, row = spacing·√3/2, lift ∝ R); here they are
// explicit and enforced by derivation.
//
// The scale knob itself is the DOM chip's size (chips/chip.tsx): the chip
// component defines how big a chip is, and this file builds the world
// around it. That keeps the dependency arrow felt → chips, so the chips
// feature stays pixel-free.
//
// Constant domains across the codebase — only the first lives here:
//
//   1. World (this file): chip size/proportions, projection, lattice, and
//      the circle-space face paint. Everything scales with CHIP_RADIUS.
//   2. Screen-space rendering: AA margins, hairline widths, font px.
//      Pixel-domain on purpose, so edges stay crisp at any world scale.
//      (baked into renderer/shaders.ts and the pack() extents)
//   3. Interaction feel: drag thresholds, combine band, preview lift.
//      Hand-tuned px in interaction.ts — coupled to chip size but not
//      derived, because feel doesn't scale linearly.
//
// Physical reference: a casino chip is 40mm across and 3.3mm thick. The
// felt stylizes thickness ~2.4× so stacks read at a glance.

import { CHIP_SIZE } from '../chips/chip';

// --- the two primitives ------------------------------------------------------

// Chip face radius in CSS px — the single world-scale knob. Derived from
// the DOM chip's canonical size so tray chips and felt chips can't desync.
export const CHIP_RADIUS = CHIP_SIZE / 2;

// Oblique "camera": a table-plane circle of radius r projects to an
// ellipse with vertical radius r × SQUASH. SQUASH = sin(elevation), so
// 0.75 ≈ looking down from ~48.6° — high enough that faces read as
// circles, low enough that stack walls stay visible.
export const CHIP_SQUASH = 0.75;

// --- derived: chip body ------------------------------------------------------

export const CHIP_DIAMETER = 2 * CHIP_RADIUS;

// Projected thickness: screen px between consecutive chip centers in a
// stack, and the wall band height drawn under each face. Real proportions
// would give ~2.4px (3.3/40 of the diameter × cos 48.6°) — too thin to
// read — so thickness is stylized to ≈ 0.27 R, snapped to the pixel grid.
export const CHIP_THICKNESS_RATIO = 0.27;
export const STACK_LIFT = Math.round(CHIP_THICKNESS_RATIO * CHIP_RADIUS);

// --- derived: chip paint (circle space) ----------------------------------------

// Face paint proportions, injected into the chip/wall shaders as uniforms
// at program init (renderer.initWorldUniforms). Angular and ×R values
// scale freely with CHIP_RADIUS; the inner-ring dash is px and coupled to
// the 22px world (see the shaders.ts note on screen-domain values).
export const SPOT_HALF_WIDTH = 0.08; // rad — angular half-width of edge spots / wall stripes
export const SPOT_INNER_RADIUS = 0.72 * CHIP_RADIUS;
export const INNER_RING_RADIUS = 0.568 * CHIP_RADIUS;
export const INNER_DASH: readonly [number, number] = [7, 4]; // arc period / on, px

// --- derived: slot lattice ---------------------------------------------------

// Staggered circle packing: one chip diameter plus a breathing gap
// between centers; row height spacing × √3/2 so every slot is equidistant
// from its six neighbours. Snapped to the pixel grid.
export const SLOT_GAP = 8;
export const SLOT_SPACING = CHIP_DIAMETER + SLOT_GAP;
export const SLOT_ROW_HEIGHT = Math.round(SLOT_SPACING * (Math.sqrt(3) / 2));
