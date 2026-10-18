import { STACK_HEIGHT_CAP } from "./felt";
import type { Point, Size } from "./geom";
import { CHIP_RADIUS, CHIP_SQUASH, rpx, SLOT_ROW_HEIGHT, STACK_LIFT } from "./world";

/**
 * The felt's canvas layout: the single authority for the inset/fade contract
 * that gestures, rendering, and DOM chrome all read. Every field derives from
 * the world scale alone; viewport-dependent quantities are the functions below.
 */

/** Inclusive y band [start, end] in px. */
export type FadeBand = readonly [number, number];

/** Canvas-to-felt insets in CSS px. */
export type Insets = { readonly top: number; readonly x: number; readonly bottom: number };

/** The felt's canvas layout, resolved from the world scale. */
export type Stage = {
  /** Felt surface top-left within the canvas, in CSS px. */
  readonly origin: Point;
  readonly inset: Insets;
  /** Canvas y of the top lattice row's slot centers. */
  readonly topRowY: number;
  /** Felt surface dissolve band, in canvas px; the felt fades first and widest. */
  readonly feltFade: FadeBand;
  /** Scene item dissolve band, in canvas px, nested inside feltFade. */
  readonly sceneFade: FadeBand;
};

/**
 * Derives the canvas layout from the world scale.
 * @returns a stage with every cross-layer layout constant resolved in one place
 */
export function createStage(): Stage {
  // Headroom above a capped top-row stack's top chip, as a fraction of the
  // chip radius. The top inset derives from it, so the whole felt scale
  // follows the world's chip diameter from one knob.
  const STACK_TOP_Y = rpx(0.46);

  // Canvas-to-felt insets in CSS px: the offset of the placeable felt surface
  // within the canvas viewport. The top inset is stack headroom (a
  // STACK_HEIGHT_CAP stack on the top row tops out at STACK_TOP_Y) and the
  // top region doubles as the fade zone: the felt surface and the chips fade
  // in GL with their own zones (the felt dissolves first), so stacks rise off
  // the felt without a hard cut.
  const inset: Insets = {
    top: Math.round((STACK_HEIGHT_CAP - 1) * STACK_LIFT + CHIP_RADIUS * CHIP_SQUASH + STACK_TOP_Y - SLOT_ROW_HEIGHT),
    x: Math.round(CHIP_RADIUS * 0.72),
    bottom: Math.round(CHIP_RADIUS * 0.72),
  };

  // Canvas px of the top lattice row; the fade bands live in the headroom
  // above it, so stacks resting in the top slots stay fully solid.
  const topRowY = SLOT_ROW_HEIGHT + inset.top;

  // Fade bands in canvas px as [startY, endY], both confined to the upper
  // headroom: stacks stay fully solid until they cross the threshold (45% of
  // the headroom above the top slots), then dissolve aggressively over a
  // short ramp. Faded chips sample the backdrop by height (page background
  // high up, felt color through the felt's own ramp), so the overlapping
  // bands stay coherent: a fully faded chip always matches what is behind it.
  return {
    origin: { x: inset.x, y: inset.top },
    inset,
    topRowY,
    sceneFade: [Math.round(topRowY * 0.15), Math.round(topRowY * 0.45)],
    feltFade: [Math.round(topRowY * 0.1), Math.round(topRowY * 0.85)],
  };
}

/** The stage the production felt renders with; derived once at module load. */
export const stage: Stage = createStage();

/**
 * Placeable felt size for a viewport; the `setFelt` input.
 * @param s - the stage providing the insets
 * @param viewport - canvas size in CSS px
 */
export function feltSize(s: Stage, viewport: Size): Size {
  return {
    w: Math.max(0, viewport.w - s.inset.x * 2),
    h: Math.max(0, viewport.h - s.inset.top - s.inset.bottom),
  };
}

/**
 * The felt wash quad in felt-local px: the full viewport relative to the felt
 * origin, so the gradient wash covers the headroom too.
 * @param s - the stage providing the origin
 * @param viewport - canvas size in CSS px
 */
export function washRect(s: Stage, viewport: Size): { x: number; y: number; w: number; h: number } {
  return { x: -s.origin.x, y: -s.origin.y, w: viewport.w, h: viewport.h };
}

/**
 * Converts a canvas-px point to felt-local px.
 * @param s - the stage providing the origin
 * @param p - the point in canvas px
 */
export function feltPoint(s: Stage, p: Point): Point {
  return { x: p.x - s.origin.x, y: p.y - s.origin.y };
}
