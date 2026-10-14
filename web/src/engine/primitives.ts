// Primitive vocabulary of the mini engine. A frame is an ordered list of
// these items; the renderer batches consecutive same-kind runs into
// instanced draws, preserving painter's order exactly.

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

// Chip geometry shared by the shaders, the scene, and hit-testing. The
// radius matches the 44px chips of the DOM palette; the squash is the
// oblique "camera" elevation (1 = top-down, 0 = edge-on).
export const CHIP_RADIUS = 22;
export const CHIP_SQUASH = 0.62;

// Dashed/solid ellipse ring (slot lattice, landing ghost, cut plane, merge
// halo, soft contact shadows). dash [0, 0] = solid; fill null = outline
// only; soft > 0 fades the fill edge over that many px (shadows).
export type RingItem = {
  kind: 'ring';
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

// Chip face, top-down but vertically squashed: SDF disc with edge spots,
// dashed inner ring, rim, bottom arc, optional highlight ring. dim
// multiplies all chip colors.
export type ChipItem = {
  kind: 'chip';
  x: number;
  y: number;
  face: RGB;
  spot: RGB;
  dim: number;
  highlight: RGBA | null;
};

// Chip wall seen edge-on: the cylinder side between the top face and the
// base, with painted edge trims (stripes aligned with the face spots),
// cylinder shading, and a groove line at the base.
export type WallItem = {
  kind: 'wall';
  x: number;
  y: number;
  face: RGB;
  spot: RGB;
  dim: number;
  thickness: number;
};

// Rounded-rect panel (hover value badge).
export type PanelItem = {
  kind: 'panel';
  x: number;
  y: number;
  hw: number;
  hh: number;
  radius: number;
  fill: RGBA;
  stroke: RGBA;
};

// One glyph quad sampled from the text atlas.
export type GlyphItem = {
  kind: 'glyph';
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