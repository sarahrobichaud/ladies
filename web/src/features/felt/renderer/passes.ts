// Per-kind pass specs — the single place where each primitive's shader
// pair, instance layout, and pack routine live together. Adding a
// primitive means adding one spec here; stride is derived from the
// attributes, so the old four-table sync hazard is gone.

import { CHIP_RADIUS, CHIP_SQUASH } from "../world";
import type { InstanceAttr } from "./gl";
import type { ChipItem, FeltItem, GlyphItem, PanelItem, RingItem, SceneItem, WallItem } from "./primitives";
import {
  CHIP_FS,
  CHIP_VS,
  FELT_FS,
  FELT_VS,
  PANEL_FS,
  PANEL_VS,
  RING_FS,
  RING_VS,
  TEXT_FS,
  TEXT_VS,
  WALL_FS,
  WALL_VS,
} from "./shaders";

/** The primitive kinds a scene can contain. */
export type Kind = SceneItem["kind"];

/** Total instance floats for an attribute layout. */
function attrStride(attrs: InstanceAttr[]): number {
  return attrs.reduce((n, a) => n + a.size, 0);
}

/** Everything the renderer needs to draw one primitive kind. */
export type PassSpec = {
  vs: string;
  fs: string;
  attrs: InstanceAttr[];
  /** Instance floats per item, derived from `attrs`. */
  stride: number;
  /** Pack one item into `out` at float offset `o`, returning the next offset. */
  pack: (item: SceneItem, out: Float32Array, o: number) => number;
};

// Quad half-extents carry an AA margin beyond the outermost SDF feature.
const RING_AA_MARGIN = 1;
const CHIP_AA_MARGIN = 4;
const WALL_AA_MARGIN = 1.5;
const PANEL_AA_MARGIN = 1.5;

const CHIP_EX = CHIP_RADIUS + CHIP_AA_MARGIN;
const CHIP_EY = (CHIP_RADIUS + CHIP_AA_MARGIN) * CHIP_SQUASH + 1.5;

// --- ring ----------------------------------------------------------------------

const RING_ATTRS: InstanceAttr[] = [
  { name: "iCenter", size: 2 },
  { name: "iExtent", size: 2 },
  { name: "iRadii", size: 2 },
  { name: "iHalfWidth", size: 1 },
  { name: "iDash", size: 2 },
  { name: "iSoft", size: 1 },
  { name: "iStroke", size: 4 },
  { name: "iFill", size: 4 },
];
const RING_STRIDE = attrStride(RING_ATTRS);

function packRing(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as RingItem;
  const extent = Math.max(it.rx, it.ry) + it.width / 2 + it.soft + RING_AA_MARGIN;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = extent;
  out[o + 3] = extent;
  out[o + 4] = it.rx;
  out[o + 5] = it.ry;
  out[o + 6] = it.width / 2;
  out[o + 7] = it.dash[0];
  out[o + 8] = it.dash[1];
  out[o + 9] = it.soft;
  out.set(it.stroke, o + 10);
  out.set(it.fill ?? [0, 0, 0, 0], o + 14);

  return o + RING_STRIDE;
}

// --- chip ----------------------------------------------------------------------

const CHIP_ATTRS: InstanceAttr[] = [
  { name: "iCenter", size: 2 },
  { name: "iExtent", size: 2 },
  { name: "iFace", size: 3 },
  { name: "iSpot", size: 3 },
  { name: "iDim", size: 1 },
  { name: "iHighlight", size: 4 },
  { name: "iAngle", size: 1 },
];
const CHIP_STRIDE = attrStride(CHIP_ATTRS);

function packChip(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as ChipItem;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = CHIP_EX;
  out[o + 3] = CHIP_EY;
  out.set(it.face, o + 4);
  out.set(it.spot, o + 7);
  out[o + 10] = it.dim;
  out.set(it.highlight ?? [0, 0, 0, 0], o + 11);
  out[o + 15] = it.angle;

  return o + CHIP_STRIDE;
}

// --- wall ----------------------------------------------------------------------

const WALL_ATTRS: InstanceAttr[] = [
  { name: "iCenter", size: 2 },
  { name: "iExtent", size: 2 },
  { name: "iFace", size: 3 },
  { name: "iSpot", size: 3 },
  { name: "iDim", size: 1 },
  { name: "iThick", size: 1 },
  { name: "iAngle", size: 1 },
];
const WALL_STRIDE = attrStride(WALL_ATTRS);

function packWall(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as WallItem;
  const extentX = CHIP_RADIUS + WALL_AA_MARGIN;
  const extentY = CHIP_RADIUS * CHIP_SQUASH + it.thickness + WALL_AA_MARGIN;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = extentX;
  out[o + 3] = extentY;
  out.set(it.face, o + 4);
  out.set(it.spot, o + 7);
  out[o + 10] = it.dim;
  out[o + 11] = it.thickness;
  out[o + 12] = it.angle;

  return o + WALL_STRIDE;
}

// --- panel ----------------------------------------------------------------------

const PANEL_ATTRS: InstanceAttr[] = [
  { name: "iCenter", size: 2 },
  { name: "iExtent", size: 2 },
  { name: "iHalfSize", size: 2 },
  { name: "iRadius", size: 1 },
  { name: "iFill", size: 4 },
  { name: "iStroke", size: 4 },
];
const PANEL_STRIDE = attrStride(PANEL_ATTRS);

function packPanel(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as PanelItem;
  const extent = Math.max(it.hw, it.hh) + PANEL_AA_MARGIN;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = extent;
  out[o + 3] = extent;
  out[o + 4] = it.hw;
  out[o + 5] = it.hh;
  out[o + 6] = it.radius;
  out.set(it.fill, o + 7);
  out.set(it.stroke, o + 11);

  return o + PANEL_STRIDE;
}

// --- glyph ----------------------------------------------------------------------

const TEXT_ATTRS: InstanceAttr[] = [
  { name: "iPos", size: 2 },
  { name: "iSize", size: 2 },
  { name: "iUV", size: 4 },
  { name: "iColor", size: 3 },
];
const TEXT_STRIDE = attrStride(TEXT_ATTRS);

function packGlyph(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as GlyphItem;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = it.w;
  out[o + 3] = it.h;
  out[o + 4] = it.u0;
  out[o + 5] = it.v0;
  out[o + 6] = it.u1;
  out[o + 7] = it.v1;
  out.set(it.color, o + 8);

  return o + TEXT_STRIDE;
}

// --- felt surface ----------------------------------------------------------------

const FELT_ATTRS: InstanceAttr[] = [
  { name: "iCenter", size: 2 },
  { name: "iExtent", size: 2 },
  { name: "iHalfSize", size: 2 },
  { name: "iRadius", size: 1 },
  { name: "iFelt", size: 3 },
  { name: "iFeltDeep", size: 3 },
];
const FELT_STRIDE = attrStride(FELT_ATTRS);

function packFelt(item: SceneItem, out: Float32Array, o: number): number {
  const it = item as FeltItem;
  const extent = Math.max(it.hw, it.hh) + PANEL_AA_MARGIN;

  out[o] = it.x;
  out[o + 1] = it.y;
  out[o + 2] = extent;
  out[o + 3] = extent;
  out[o + 4] = it.hw;
  out[o + 5] = it.hh;
  out[o + 6] = it.radius;
  out.set(it.felt, o + 7);
  out.set(it.feltDeep, o + 10);

  return o + FELT_STRIDE;
}

// --- the registry ----------------------------------------------------------------

/** One spec per primitive kind; the renderer builds a GL pass from each. */
export const PASS_SPECS: Record<Kind, PassSpec> = {
  felt: { vs: FELT_VS, fs: FELT_FS, attrs: FELT_ATTRS, stride: FELT_STRIDE, pack: packFelt },
  ring: { vs: RING_VS, fs: RING_FS, attrs: RING_ATTRS, stride: RING_STRIDE, pack: packRing },
  chip: { vs: CHIP_VS, fs: CHIP_FS, attrs: CHIP_ATTRS, stride: CHIP_STRIDE, pack: packChip },
  wall: { vs: WALL_VS, fs: WALL_FS, attrs: WALL_ATTRS, stride: WALL_STRIDE, pack: packWall },
  panel: { vs: PANEL_VS, fs: PANEL_FS, attrs: PANEL_ATTRS, stride: PANEL_STRIDE, pack: packPanel },
  glyph: { vs: TEXT_VS, fs: TEXT_FS, attrs: TEXT_ATTRS, stride: TEXT_STRIDE, pack: packGlyph },
};
