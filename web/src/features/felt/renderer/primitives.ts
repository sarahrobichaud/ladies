// Primitive vocabulary of the renderer, drawn in painter's order.

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

/** Dashed or solid ellipse ring; dash [0, 0] means solid, fill null means outline-only. */
export type RingItem = {
  kind: "ring";
  x: number;
  y: number;
  rx: number;
  ry: number;
  width: number;
  dash: readonly [number, number];
  stroke: RGBA;
  fill: RGBA | null;
  soft: number;
};

/** Chip face: a squashed SDF disc with edge spots, inner ring, rim, and optional highlight. */
export type ChipItem = {
  kind: "chip";
  x: number;
  y: number;
  face: RGB;
  spot: RGB;
  dim: number;
  highlight: RGBA | null;
  angle: number; // radians — rotates spots/inner-ring relative to chip body
};

/** Chip wall: the cylinder side under a face, with stripes, shading, and a base groove. */
export type WallItem = {
  kind: "wall";
  x: number;
  y: number;
  face: RGB;
  spot: RGB;
  dim: number;
  thickness: number;
  angle: number; // radians — rotates stripes to match chip face rotation
};

/** Rounded-rect panel, used for the hover value badge. */
export type PanelItem = {
  kind: "panel";
  x: number;
  y: number;
  hw: number;
  hh: number;
  radius: number;
  fill: RGBA;
  stroke: RGBA;
};

/** One glyph quad sampled from the text atlas. */
export type GlyphItem = {
  kind: "glyph";
  x: number;
  y: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  color: RGB;
};

export type SceneItem = RingItem | ChipItem | WallItem | PanelItem | GlyphItem;
export type Scene = SceneItem[];
