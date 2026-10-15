// Minimal WebGL2 device layer: context creation, program linking, and the
// instanced unit-quad batch every primitive program draws through.

export function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: false,
    stencil: false,
  });
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('webgl: shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`webgl: shader compile failed — ${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('webgl: program allocation failed');
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`webgl: program link failed — ${log}`);
  }
  return program;
}

export type InstanceAttr = { name: string; size: number };

// One VAO per program: a shared unit quad on stream 0, interleaved
// instance attributes on stream 1 (divisor 1). Attributes optimized out
// of a program are skipped; the instance stride still covers them.
export function createQuadVAO(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  instanceBuffer: WebGLBuffer,
  attrs: InstanceAttr[],
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('webgl: VAO allocation failed');

  const quad = gl.createBuffer();
  if (!quad) throw new Error('webgl: buffer allocation failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

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

// Dynamic instance stream: upload + instanced draw in one call.
export class Batch {
  readonly instanceFloats: number;
  private gl: WebGL2RenderingContext;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private capacity = 0; // floats

  constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    attrs: InstanceAttr[],
    capacityInstances = 256,
  ) {
    this.gl = gl;
    this.instanceFloats = attrs.reduce((n, a) => n + a.size, 0);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('webgl: buffer allocation failed');
    this.buffer = buffer;
    this.vao = createQuadVAO(gl, program, buffer, attrs);
    this.reserve(capacityInstances * this.instanceFloats);
  }

  private reserve(floats: number) {
    if (floats <= this.capacity) return;
    const capacity = Math.max(floats, this.capacity * 2, 256);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, capacity * 4, this.gl.DYNAMIC_DRAW);
    this.capacity = capacity;
  }

  draw(data: Float32Array, instances: number) {
    if (instances === 0) return;
    this.reserve(data.length);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
  }
}