// The mini engine's render front: takes an ordered scene (painter's order)
// and flushes consecutive same-kind runs as instanced draws. One program +
// batch per primitive kind; all math is CSS px, the viewport is device px.

import { Batch, createGL, createProgram, type InstanceAttr } from './gl';
import { CHIP_RADIUS, CHIP_SQUASH, type ChipItem, type GlyphItem, type PanelItem, type RingItem, type SceneItem, type WallItem } from './primitives';
import {
  CHIP_FS,
  CHIP_VS,
  PANEL_FS,
  PANEL_VS,
  RING_FS,
  RING_VS,
  TEXT_FS,
  TEXT_VS,
  WALL_FS,
  WALL_VS,
} from './shaders';
import { GlyphAtlas, type FontFace } from './text';

type Kind = SceneItem['kind'];

const STRIDE: Record<Kind, number> = { ring: 18, chip: 16, wall: 13, panel: 15, glyph: 11 };

const CHIP_ATTRS: InstanceAttr[] = [
  { name: 'iCenter', size: 2 },
  { name: 'iExtent', size: 2 },
  { name: 'iFace', size: 3 },
  { name: 'iSpot', size: 3 },
  { name: 'iDim', size: 1 },
  { name: 'iHighlight', size: 4 },
  { name: 'iAngle', size: 1 },
];
const RING_ATTRS: InstanceAttr[] = [
  { name: 'iCenter', size: 2 },
  { name: 'iExtent', size: 2 },
  { name: 'iRadii', size: 2 },
  { name: 'iHalfWidth', size: 1 },
  { name: 'iDash', size: 2 },
  { name: 'iSoft', size: 1 },
  { name: 'iStroke', size: 4 },
  { name: 'iFill', size: 4 },
];
const WALL_ATTRS: InstanceAttr[] = [
  { name: 'iCenter', size: 2 },
  { name: 'iExtent', size: 2 },
  { name: 'iFace', size: 3 },
  { name: 'iSpot', size: 3 },
  { name: 'iDim', size: 1 },
  { name: 'iThick', size: 1 },
  { name: 'iAngle', size: 1 },
];
const PANEL_ATTRS: InstanceAttr[] = [
  { name: 'iCenter', size: 2 },
  { name: 'iExtent', size: 2 },
  { name: 'iHalfSize', size: 2 },
  { name: 'iRadius', size: 1 },
  { name: 'iFill', size: 4 },
  { name: 'iStroke', size: 4 },
];
const TEXT_ATTRS: InstanceAttr[] = [
  { name: 'iPos', size: 2 },
  { name: 'iSize', size: 2 },
  { name: 'iUV', size: 4 },
  { name: 'iColor', size: 3 },
];

// Quad half-extents with an AA margin beyond the outermost SDF feature.
const CHIP_EX = CHIP_RADIUS + 4; // highlight ring reaches R + 3 in circle space
const CHIP_EY = (CHIP_RADIUS + 4) * CHIP_SQUASH + 1.5;

type Pass = {
  program: WebGLProgram;
  batch: Batch;
  uResolution: WebGLUniformLocation | null;
};

class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  readonly atlas: GlyphAtlas;
  private passes: Record<Kind, Pass>;
  private scratch: Record<Kind, Float32Array>;
  private cssW = 0;
  private cssH = 0;

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.atlas = new GlyphAtlas(gl);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const make = (vs: string, fs: string, attrs: InstanceAttr[]): Pass => {
      const program = createProgram(gl, vs, fs);
      return {
        program,
        batch: new Batch(gl, program, attrs),
        uResolution: gl.getUniformLocation(program, 'uResolution'),
      };
    };
    this.passes = {
      ring: make(RING_VS, RING_FS, RING_ATTRS),
      chip: make(CHIP_VS, CHIP_FS, CHIP_ATTRS),
      wall: make(WALL_VS, WALL_FS, WALL_ATTRS),
      panel: make(PANEL_VS, PANEL_FS, PANEL_ATTRS),
      glyph: make(TEXT_VS, TEXT_FS, TEXT_ATTRS),
    };
    const text = this.passes.glyph.program;
    gl.useProgram(text);
    gl.uniform1i(gl.getUniformLocation(text, 'uAtlas'), 0);

    this.scratch = {
      ring: new Float32Array(256 * STRIDE.ring),
      chip: new Float32Array(256 * STRIDE.chip),
      wall: new Float32Array(256 * STRIDE.wall),
      panel: new Float32Array(256 * STRIDE.panel),
      glyph: new Float32Array(256 * STRIDE.glyph),
    };
  }

  render(scene: SceneItem[], cssWidth: number, cssHeight: number) {
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const gl = this.gl;
    this.cssW = cssWidth;
    this.cssH = cssHeight;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.atlas.upload();

    let i = 0;
    while (i < scene.length) {
      const kind = scene[i].kind;
      const stride = STRIDE[kind];
      let count = 0;
      let offset = 0;
      while (i < scene.length && scene[i].kind === kind) {
        this.ensure(kind, (count + 1) * stride);
        offset = this.pack(kind, scene[i], this.scratch[kind], offset);
        count++;
        i++;
      }
      this.flush(kind, count, offset);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const pass of Object.values(this.passes)) {
      pass.batch.dispose();
      gl.deleteProgram(pass.program);
    }
    this.atlas.dispose();
  }

  private ensure(kind: Kind, floats: number) {
    if (this.scratch[kind].length >= floats) return;
    const cap = Math.max(this.scratch[kind].length * 2, 256, floats);
    this.scratch[kind] = new Float32Array(cap);
  }

  private pack(kind: Kind, item: SceneItem, out: Float32Array, o: number): number {
    switch (kind) {
      case 'ring': {
        const it = item as RingItem;
        const extent = Math.max(it.rx, it.ry) + it.width / 2 + it.soft + 1;
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
        return o + 18;
      }
      case 'chip': {
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
        return o + 16;
      }
      case 'wall': {
        const it = item as WallItem;
        out[o] = it.x;
        out[o + 1] = it.y;
        out[o + 2] = CHIP_RADIUS + 1.5;
        out[o + 3] = CHIP_RADIUS * CHIP_SQUASH + it.thickness + 1.5;
        out.set(it.face, o + 4);
        out.set(it.spot, o + 7);
        out[o + 10] = it.dim;
        out[o + 11] = it.thickness;
        out[o + 12] = it.angle;
        return o + 13;
      }
      case 'panel': {
        const it = item as PanelItem;
        const extent = Math.max(it.hw, it.hh) + 1.5;
        out[o] = it.x;
        out[o + 1] = it.y;
        out[o + 2] = extent;
        out[o + 3] = extent;
        out[o + 4] = it.hw;
        out[o + 5] = it.hh;
        out[o + 6] = it.radius;
        out.set(it.fill, o + 7);
        out.set(it.stroke, o + 11);
        return o + 15;
      }
      case 'glyph': {
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
        return o + 11;
      }
    }
  }

  private flush(kind: Kind, count: number, floats: number) {
    if (count === 0) return;
    const gl = this.gl;
    const pass = this.passes[kind];
    gl.useProgram(pass.program);
    if (pass.uResolution) gl.uniform2f(pass.uResolution, this.cssW, this.cssH);
    if (kind === 'glyph') {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    }
    pass.batch.draw(this.scratch[kind], floats, count);
  }
}

export interface PrimitiveRenderer {
  font(px: number, family: string, weight?: string, scale?: number): FontFace;
  render(scene: SceneItem[], cssWidth: number, cssHeight: number): void;
  dispose(): void;
}

// Null when WebGL2 is unavailable — callers decide the fallback.
export function createPrimitiveRenderer(canvas: HTMLCanvasElement): PrimitiveRenderer | null {
  const gl = createGL(canvas);
  if (!gl) return null;
  const renderer = new Renderer(gl, canvas);
  return {
    font: (px, family, weight = '600', scale = 1) => renderer.atlas.font(px, family, weight, scale),
    render: (scene, w, h) => renderer.render(scene, w, h),
    dispose: () => renderer.dispose(),
  };
}
