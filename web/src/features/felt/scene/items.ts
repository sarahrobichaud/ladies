import { CHIP_RADIUS, CHIP_SQUASH } from "../world";
import type { FontFace } from "./font";
import type { RGB, RGBA, RingItem, SceneItem } from "./primitives";

// Constructors for scene draw items — the vocabulary helpers buildScene composes.

/** Max rotation of a non-top chip, in radians (~10°). */
const MAX_CHIP_ROTATION = 0.5;

// Hash primes: Knuth's multiplicative hash and xxHash's finalizer.
const HASH_SEED_PRIME = 2654435761;
const HASH_DEPTH_PRIME = 2246822519;
const HASH_FINALIZER = 0x45d9f3b;

/**
 * Build a dashed or solid ellipse ring item.
 * @param x - center x in px
 * @param y - center y in px
 * @param rx - horizontal radius in px
 * @param ry - vertical radius in px
 * @param width - stroke width in px
 * @param dash - [on, off] arc lengths in px; [0, 0] means solid
 * @param stroke - stroke color, premultiplied at draw time
 * @param fill - fill color, or null for outline-only
 * @param soft - px over which the fill edge fades (contact shadows)
 */
export function ring(
  x: number,
  y: number,
  rx: number,
  ry: number,
  width: number,
  dash: readonly [number, number],
  stroke: RGBA,
  fill: RGBA | null,
  soft = 0,
): RingItem {
  return { kind: "ring", x, y, rx, ry, width, dash, stroke, fill, soft };
}

/**
 * Build a soft contact-shadow ellipse under a chip resting on the felt.
 * @param x - shadow center x in px
 * @param y - shadow center y in px
 * @param spread - px added to the chip radius on all sides
 * @param alpha - shadow opacity
 * @param soft - px over which the shadow edge fades
 */
export function shadow(x: number, y: number, spread: number, alpha: number, soft: number): RingItem {
  return {
    kind: "ring",
    x,
    y,
    rx: CHIP_RADIUS + spread,
    ry: (CHIP_RADIUS + spread) * CHIP_SQUASH,
    width: 0,
    dash: [0, 0],
    stroke: [0, 0, 0, 0],
    fill: [0, 0, 0, alpha],
    soft,
  };
}

/**
 * Build a darkened ellipse pressed into the felt, like a bet spot.
 * @param x - center x in px
 * @param y - center y in px
 * @param rx - horizontal radius in px
 * @param alpha - fill opacity
 * @param soft - px over which the fill edge fades
 */
export function spot(x: number, y: number, rx: number, alpha: number, soft: number): RingItem {
  return {
    kind: "ring",
    x,
    y,
    rx,
    ry: rx * CHIP_SQUASH,
    width: 0,
    dash: [0, 0],
    stroke: [0, 0, 0, 0],
    fill: [0, 0, 0, alpha],
    soft,
  };
}

/**
 * Build an engraved spot with a rim stroke, so a button reads pressable.
 * @param x - center x in px
 * @param y - center y in px
 * @param rx - horizontal radius in px
 * @param stroke - rim stroke color
 * @param fillAlpha - fill opacity of the pressed-in spot
 * @param soft - px over which the fill edge fades
 */
export function engraved(x: number, y: number, rx: number, stroke: RGBA, fillAlpha: number, soft: number): RingItem {
  return {
    kind: "ring",
    x,
    y,
    rx,
    ry: rx * CHIP_SQUASH,
    width: 1,
    dash: [0, 0],
    stroke,
    fill: [0, 0, 0, fillAlpha],
    soft,
  };
}

/**
 * Append centered text glyphs to the scene, optionally squashed flat onto the felt plane.
 * @param items - scene list to append to
 * @param font - font face to lay the text out with
 * @param text - text to render
 * @param cx - center x in px
 * @param cy - middle-baseline y in px
 * @param color - text color
 * @param squash - vertical squash around the baseline; 1 keeps screen-space text upright
 */
export function pushLabel(
  items: SceneItem[],
  font: FontFace,
  text: string,
  cx: number,
  cy: number,
  color: RGB,
  squash = 1,
) {
  const width = font.width(text);
  const left = cx - width / 2;
  for (const glyph of font.glyphs(text, left, cy, color)) {
    items.push({
      ...glyph,
      y: cy + (glyph.y - cy) * squash,
      h: glyph.h * squash,
    });
  }
}

/**
 * Attach an alpha channel to an RGB color.
 * @param color - RGB components in 0..1
 * @param alpha - opacity in 0..1
 */
export function rgba(color: RGB, alpha: number): RGBA {
  return [color[0], color[1], color[2], alpha];
}

/**
 * Scale an RGB color toward black.
 * @param color - RGB components in 0..1
 * @param factor - multiplier; 1 keeps the color, 0 makes it black
 */
export function shade(color: RGB, factor: number): RGB {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/**
 * Stable pseudo-random rotation for a chip at a given stack position,
 * in [-MAX_CHIP_ROTATION, +MAX_CHIP_ROTATION] radians.
 *
 * Deterministic so per-frame scene rebuilds can't make chips shiver;
 * hashed so neighboring chips don't tilt in lockstep.
 *
 * @param seed - any stable per-chip value (e.g. stack id or chip id)
 * @param depth - chip position within its stack
 */
export function chipAngle(seed: number, depth: number): number {
  let hash = (seed * HASH_SEED_PRIME) ^ (depth * HASH_DEPTH_PRIME);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, HASH_FINALIZER);
  hash ^= hash >>> 16;

  const unit = (hash & 0xffff) / 0xffff; // 0..1
  const centered = unit * 2 - 1; // -1..1
  return centered * MAX_CHIP_ROTATION;
}
