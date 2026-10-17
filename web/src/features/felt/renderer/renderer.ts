// The render front: takes an ordered scene (painter's order) and flushes
// consecutive same-kind runs as instanced draws, one pass per kind.

import type { Point } from "../geom";
import { CHIP_RADIUS, CHIP_SQUASH, INNER_DASH, INNER_RING_RADIUS, SPOT_HALF_WIDTH, SPOT_INNER_RADIUS } from "../world";
import { Batch, createGL, createProgram } from "./gl";
import { type Kind, PASS_SPECS, type PassSpec } from "./passes";
import type { SceneItem } from "./primitives";
import { type FontFace, GlyphAtlas } from "./text";

/** One compiled pass: its spec, program, instance batch, and cached uniform location. */
type Pass = {
  spec: PassSpec;
  program: WebGLProgram;
  batch: Batch;
  uResolution: WebGLUniformLocation | null;
  uOrigin: WebGLUniformLocation | null;
  uFade: WebGLUniformLocation | null;
  uFeltFade: WebGLUniformLocation | null;
  uCanvasColor: WebGLUniformLocation | null;
  uFeltColor: WebGLUniformLocation | null;
};

/**
 * Inject the world-derived shader constants as uniforms, once at program
 * init. Programs that don't declare a uniform get null locations, which
 * are skipped, so this is safe to run on every program.
 * @param gl - WebGL context
 * @param program - freshly linked program to bind and populate
 */
function initWorldUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  gl.useProgram(program);

  const scalar = (name: string, value: number) => {
    const loc = gl.getUniformLocation(program, name);
    if (loc) {
      gl.uniform1f(loc, value);
    }
  };
  const pair = (name: string, x: number, y: number) => {
    const loc = gl.getUniformLocation(program, name);
    if (loc) {
      gl.uniform2f(loc, x, y);
    }
  };

  scalar("uChipRadius", CHIP_RADIUS);
  scalar("uSquash", CHIP_SQUASH);
  scalar("uSpotHalfWidth", SPOT_HALF_WIDTH);
  scalar("uSpotInnerRadius", SPOT_INNER_RADIUS);
  scalar("uInnerRingRadius", INNER_RING_RADIUS);
  pair("uInnerDash", INNER_DASH[0], INNER_DASH[1]);
}

/**
 * Compile one pass spec into a usable pass.
 * @param gl - WebGL context
 * @param spec - the primitive's shader pair, attribute layout, and pack routine
 */
function buildPass(gl: WebGL2RenderingContext, spec: PassSpec): Pass {
  const program = createProgram(gl, spec.vs, spec.fs);
  initWorldUniforms(gl, program);

  return {
    spec,
    program,
    batch: new Batch(gl, program, spec.attrs),
    uResolution: gl.getUniformLocation(program, "uResolution"),
    uOrigin: gl.getUniformLocation(program, "uOrigin"),
    uFade: gl.getUniformLocation(program, "uFade"),
    uFeltFade: gl.getUniformLocation(program, "uFeltFade"),
    uCanvasColor: gl.getUniformLocation(program, "uCanvasColor"),
    uFeltColor: gl.getUniformLocation(program, "uFeltColor"),
  };
}

/** Initial scratch capacity per kind, in instances. */
const SCRATCH_INSTANCES = 256;

class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  readonly atlas: GlyphAtlas;
  private passes: Record<Kind, Pass>;
  private scratch: Record<Kind, Float32Array>;
  private cssW = 0;
  private cssH = 0;
  private view: FrameView = {
    origin: { x: 0, y: 0 },
    feltFade: [-1e9, -1e9],
    sceneFade: [-1e9, -1e9],
    canvasColor: [0, 0, 0],
    feltColor: [0, 0, 0],
  };

  /**
   * Create a renderer: atlas, blend state, one pass per primitive kind,
   * and a scratch buffer per kind.
   * @param gl - WebGL2 context on `canvas`
   * @param canvas - canvas backing the context; its bitmap is the viewport
   * @throws Error on program/buffer/VAO allocation failure
   */
  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.atlas = new GlyphAtlas(gl);

    // Painter's order over premultiplied-alpha blending; no depth.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.passes = {
      felt: buildPass(gl, PASS_SPECS.felt),
      ring: buildPass(gl, PASS_SPECS.ring),
      chip: buildPass(gl, PASS_SPECS.chip),
      wall: buildPass(gl, PASS_SPECS.wall),
      panel: buildPass(gl, PASS_SPECS.panel),
      glyph: buildPass(gl, PASS_SPECS.glyph),
    };

    // The atlas sampler is a fixed unit; bind it to texture slot 0 once.
    const text = this.passes.glyph.program;
    gl.useProgram(text);
    gl.uniform1i(gl.getUniformLocation(text, "uAtlas"), 0);

    this.scratch = {
      felt: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.felt.stride),
      ring: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.ring.stride),
      chip: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.chip.stride),
      wall: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.wall.stride),
      panel: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.panel.stride),
      glyph: new Float32Array(SCRATCH_INSTANCES * PASS_SPECS.glyph.stride),
    };
  }

  /**
   * Render one frame: clear, then batch consecutive same-kind runs in
   * painter's order.
   * @param scene - draw items in painter's order
   * @param cssWidth - viewport width in CSS px
   * @param cssHeight - viewport height in CSS px
   * @param view - scene offset and the two fade zones, in canvas px
   */
  render(scene: SceneItem[], cssWidth: number, cssHeight: number, view: FrameView) {
    if (cssWidth <= 0 || cssHeight <= 0) {
      return;
    }

    const gl = this.gl;
    this.cssW = cssWidth;
    this.cssH = cssHeight;
    this.view = view;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.atlas.upload();

    let i = 0;
    while (i < scene.length) {
      const kind = scene[i].kind;
      const pass = this.passes[kind];
      let count = 0;
      let offset = 0;

      while (i < scene.length && scene[i].kind === kind) {
        this.ensure(kind, (count + 1) * pass.spec.stride);
        offset = pass.spec.pack(scene[i], this.scratch[kind], offset);
        count++;
        i++;
      }

      this.flush(kind, count, offset);
    }
  }

  /** Delete every pass's program and batch, plus the glyph atlas. */
  dispose() {
    const gl = this.gl;
    for (const pass of Object.values(this.passes)) {
      pass.batch.dispose();
      gl.deleteProgram(pass.program);
    }
    this.atlas.dispose();
  }

  /**
   * Grow a kind's scratch buffer to hold at least `floats` floats.
   * @param kind - which kind's scratch to grow
   * @param floats - required capacity in floats
   */
  private ensure(kind: Kind, floats: number) {
    if (this.scratch[kind].length >= floats) {
      return;
    }

    const cap = Math.max(this.scratch[kind].length * 2, SCRATCH_INSTANCES, floats);
    this.scratch[kind] = new Float32Array(cap);
  }

  /**
   * Upload a packed run and issue its instanced draw.
   * @param kind - which pass to draw through
   * @param count - instance count in the run
   * @param floats - packed float count in the run's scratch prefix
   */
  private flush(kind: Kind, count: number, floats: number) {
    if (count === 0) {
      return;
    }

    const gl = this.gl;
    const pass = this.passes[kind];

    gl.useProgram(pass.program);
    if (pass.uResolution) {
      gl.uniform2f(pass.uResolution, this.cssW, this.cssH);
    }
    if (pass.uOrigin) {
      gl.uniform2f(pass.uOrigin, this.view.origin.x, this.view.origin.y);
    }
    if (pass.uFade) {
      const fade = kind === "felt" ? this.view.feltFade : this.view.sceneFade;
      gl.uniform2f(pass.uFade, fade[0], fade[1]);
    }
    if (pass.uFeltFade) {
      const f = this.view.feltFade;
      gl.uniform2f(pass.uFeltFade, f[0], f[1]);
    }
    if (pass.uCanvasColor) {
      const c = this.view.canvasColor;
      gl.uniform3f(pass.uCanvasColor, c[0], c[1], c[2]);
    }
    if (pass.uFeltColor) {
      const c = this.view.feltColor;
      gl.uniform3f(pass.uFeltColor, c[0], c[1], c[2]);
    }

    if (kind === "glyph") {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    }

    pass.batch.draw(this.scratch[kind], floats, count);
  }
}

/** Per-frame view state: the scene offset, both fade zones, and the two
 *  backdrop colors scene items dissolve into, sampled by height (page
 *  background above, felt color through the felt's ramp). Fade zones are
 *  [startY, endY] ramps; the felt zone dissolves the surface by alpha, the
 *  scene zone tints items into the height-sampled backdrop. */
export type FrameView = {
  origin: Point;
  feltFade: readonly [number, number];
  sceneFade: readonly [number, number];
  canvasColor: readonly [number, number, number];
  feltColor: readonly [number, number, number];
};

/** The renderer's public face: fonts, frame rendering, disposal. */
export interface PrimitiveRenderer {
  font(px: number, family: string, weight?: string, scale?: number): FontFace;
  render(scene: SceneItem[], cssWidth: number, cssHeight: number, view: FrameView): void;
  dispose(): void;
}

/**
 * Create a primitive renderer on a canvas.
 * @param canvas - canvas to render into
 * @returns the renderer, or null when WebGL2 is unavailable — callers decide the fallback
 */
export function createPrimitiveRenderer(canvas: HTMLCanvasElement): PrimitiveRenderer | null {
  const gl = createGL(canvas);
  if (!gl) {
    return null;
  }

  const renderer = new Renderer(gl, canvas);
  return {
    font: (px, family, weight = "600", scale = 1) => renderer.atlas.font(px, family, weight, scale),
    render: (scene, w, h, view) => renderer.render(scene, w, h, view),
    dispose: () => renderer.dispose(),
  };
}
