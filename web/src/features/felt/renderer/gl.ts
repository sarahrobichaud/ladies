// Minimal WebGL2 device layer: context creation, program linking, and the
// instanced unit-quad batch every primitive program draws through.

/** WebGL2 context attributes tuned for premultiplied-alpha 2D compositing. */
const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: true,
  depth: false,
  stencil: false,
};

/**
 * Create a WebGL2 context on a canvas.
 * @param canvas - canvas to acquire the context on
 * @returns the context, or null when WebGL2 is unavailable
 */
export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", CONTEXT_ATTRS);
}

/**
 * Compile one shader stage, deleting the shader on failure.
 * @param gl - WebGL context
 * @param type - VERTEX_SHADER or FRAGMENT_SHADER
 * @param source - GLSL ES 3.00 source
 * @throws Error with the compiler log when compilation fails
 */
function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("webgl: shader allocation failed");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`webgl: shader compile failed — ${log}`);
  }

  return shader;
}

/**
 * Compile and link a vertex/fragment pair into a program.
 * @param gl - WebGL context
 * @param vs - vertex shader source
 * @param fs - fragment shader source
 * @throws Error with the linker log when linking fails
 */
export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("webgl: program allocation failed");
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, vs);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fs);

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  // Shaders are attached; the links keep them alive until link completes.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!linked) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`webgl: program link failed — ${log}`);
  }

  return program;
}

/** One per-instance vertex attribute: its shader name and component count. */
export type InstanceAttr = { name: string; size: number };

/** The shared unit quad every primitive draws through, as a triangle strip. */
const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

/**
 * Build a VAO drawing a shared unit quad (stream 0) plus interleaved
 * per-instance attributes (stream 1, divisor 1).
 * @param gl - WebGL context
 * @param program - program the attribute locations come from
 * @param instanceBuffer - buffer holding the packed instance data
 * @param attrs - instance layout; attributes optimized out are skipped
 * @throws Error on buffer or VAO allocation failure
 */
export function createQuadVAO(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  instanceBuffer: WebGLBuffer,
  attrs: InstanceAttr[],
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("webgl: VAO allocation failed");
  }

  const quad = gl.createBuffer();
  if (!quad) {
    throw new Error("webgl: buffer allocation failed");
  }

  gl.bindVertexArray(vao);

  // Stream 0: the unit quad, one corner per vertex.
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "aCorner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  // Stream 1: interleaved instance attributes, advancing once per instance.
  const stride = attrs.reduce((n, a) => n + a.size, 0) * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  let offset = 0;
  for (const attr of attrs) {
    const loc = gl.getAttribLocation(program, attr.name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    offset += attr.size * 4;
  }

  gl.bindVertexArray(null);
  return vao;
}

/**
 * Dynamic instance stream: upload a packed run and draw it instanced in
 * one call. Only the used prefix of `data` is uploaded — callers pack
 * into a shared scratch buffer that is usually larger than one run.
 */
export class Batch {
  /** Instance floats per item, matching the attribute layout. */
  readonly instanceFloats: number;

  private gl: WebGL2RenderingContext;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private capacity = 0; // floats

  /**
   * Create a batch bound to one program's attribute layout.
   * @param gl - WebGL context
   * @param program - program whose attribute locations the VAO captures
   * @param attrs - instance layout
   * @param capacityInstances - initial buffer capacity, in instances
   * @throws Error on buffer or VAO allocation failure
   */
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram, attrs: InstanceAttr[], capacityInstances = 256) {
    this.gl = gl;
    this.instanceFloats = attrs.reduce((n, a) => n + a.size, 0);

    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("webgl: buffer allocation failed");
    }
    this.buffer = buffer;

    this.vao = createQuadVAO(gl, program, buffer, attrs);
    this.reserve(capacityInstances * this.instanceFloats);
  }

  /**
   * Grow the buffer to hold at least `floats` floats, doubling capacity.
   * @param floats - required capacity in floats
   */
  private reserve(floats: number) {
    if (floats <= this.capacity) {
      return;
    }

    const capacity = Math.max(floats, this.capacity * 2, 256);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, capacity * 4, this.gl.DYNAMIC_DRAW);
    this.capacity = capacity;
  }

  /**
   * Upload the used prefix of `data` and draw `instances` copies of the quad.
   * @param data - packed instance floats; only the first `floats` are uploaded
   * @param floats - used prefix length of `data`
   * @param instances - instance count for the draw
   */
  draw(data: Float32Array, floats: number, instances: number) {
    if (instances === 0) {
      return;
    }

    this.reserve(floats);

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
    gl.bindVertexArray(null);
  }

  /** Delete the buffer and VAO. */
  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
  }
}
