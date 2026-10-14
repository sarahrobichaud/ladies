// Primitive vocabulary of the mini engine. A frame is an ordered list of
// these items; the renderer batches consecutive same-kind runs into
// instanced draws, preserving painter's order exactly.

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

// Dashed/solid ellipse ring (slot lattice, landing ghost, cut plane, merge
// halo). dash [0, 0] = solid; fill null = outline only.
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
};

// Chip face, top-down: SDF disc with edge spots, dashed inner ring, rim,
// bottom arc, optional highlight ring. dim multiplies all chip colors.
export type ChipItem = {
  kind: 'chip';
  x: number;
  y: number;
  face: RGB;
  spot: RGB;
  dim: number;
  highlight: RGBA | null;
};

// Chip seen edge-on: solid disc with dark edge dashes and a bottom arc.
export type EdgeChipItem = {
  kind: 'edge';
  x: number;
  y: number;
  face: RGB;
  dim: number;
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

export type SceneItem = RingItem | ChipItem | EdgeChipItem | PanelItem | GlyphItem;
export type Scene = SceneItem[];