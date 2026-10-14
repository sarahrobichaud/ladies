// Canvas-rasterized glyph atlas: one texture shared by every font size,
// grown by re-rasterizing when full. Metrics are in CSS px; glyphs are
// rasterized at `scale`× (devicePixelRatio) for sharpness. Only the alpha
// channel is sampled, so glyphs are drawn white.

import type { GlyphItem, RGB } from './primitives';

export type Glyph = {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  dx: number; // quad offset from the anchor (left edge, middle baseline)
  dy: number;
  w: number;
  h: number;
  advance: number;
};

export interface FontFace {
  width(text: string): number;
  // Quads for `text` anchored at (x, y) = left edge, middle baseline.
  glyphs(text: string, x: number, y: number, color: RGB): GlyphItem[];
}

const ATLAS_SIZE = 256;

type Placed = { key: string; px: number; ch: string; scale: number };

export class GlyphAtlas {
  readonly texture: WebGLTexture;
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private entries = new Map<string, Glyph>();
  private placed: Placed[] = [];
  private size = ATLAS_SIZE;
  private penX = 0;
  private penY = 0;
  private rowH = 0;
  private weight = '600';
  private family = '';
  private dirty = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS_SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('atlas: 2d context unavailable');
    this.ctx = ctx;
    const texture = gl.createTexture();
    if (!texture) throw new Error('atlas: texture allocation failed');
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // A FontFace view over the atlas for one font. Switching family/weight
  // invalidates every cached glyph (metrics change with the font).
  font(px: number, family: string, weight: string, scale: number): FontFace {
    if (this.family !== family || this.weight !== weight) {
      this.family = family;
      this.weight = weight;
      this.entries.clear();
      this.placed = [];
      this.penX = this.penY = this.rowH = 0;
      this.dirty = true;
    }
    return {
      width: (text) => {
        let w = 0;
        for (const ch of text) w += this.glyph(px, ch, scale).advance;
        return w;
      },
      glyphs: (text, x, y, color) => {
        const items: GlyphItem[] = [];
        let pen = 0;
        for (const ch of text) {
          const g = this.glyph(px, ch, scale);
          if (g.w > 0 && g.h > 0) {
            items.push({
              kind: 'glyph',
              x: x + pen + g.dx,
              y: y + g.dy,
              w: g.w,
              h: g.h,
              u0: g.u0,
              v0: g.v0,
              u1: g.u1,
              v1: g.v1,
              color,
            });
          }
          pen += g.advance;
        }
        return items;
      },
    };
  }

  // Upload the atlas canvas when it changed. Call once per frame.
  upload() {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    this.dirty = false;
  }

  dispose() {
    this.gl.deleteTexture(this.texture);
  }

  private glyph(px: number, ch: string, scale: number): Glyph {
    const key = `${px}\u0000${scale}\u0000${ch}`;
    const cached = this.entries.get(key);
    if (cached) return cached;

    // Measure first so placement knows the quad size.
    this.setTextState(Math.max(1, Math.round(px * scale)));
    const m = this.ctx.measureText(ch);
    const wDev = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const hDev = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const qw = Math.ceil(wDev) + 2;
    const qh = Math.ceil(hDev) + 2;

    if (wDev > 0 && hDev > 0) {
      for (;;) {
        if (this.penX + qw > this.size) {
          this.penX = 0;
          this.penY += this.rowH + 1;
          this.rowH = 0;
        }
        if (this.penY + qh <= this.size && qw <= this.size && qh <= this.size) break;
        this.grow(this.size * 2);
      }
    }

    const g = this.rasterize(key, px, ch, scale);
    this.entries.set(key, g);
    return g;
  }

  // Draw one glyph at the current pen. Callers guarantee space.
  private rasterize(key: string, px: number, ch: string, scale: number): Glyph {
    this.setTextState(Math.max(1, Math.round(px * scale)));
    const m = this.ctx.measureText(ch);
    const wDev = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const hDev = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const advance = m.width / scale;

    // Whitespace: advance only, no ink.
    if (wDev <= 0 || hDev <= 0) {
      return { u0: 0, v0: 0, u1: 0, v1: 0, dx: 0, dy: 0, w: 0, h: 0, advance };
    }

    // Draw so the ink's top-left lands at (penX + 1, penY + 1), which is
    // where the UV coordinates below expect it. With textBaseline 'middle',
    // the origin sits at the vertical midpoint, so we must shift down by
    // actualBoundingBoxAscent to avoid clipping at the top of the atlas tile.
    const ax = this.penX + 1 + m.actualBoundingBoxLeft;
    const ay = this.penY + 1 + m.actualBoundingBoxAscent;
    this.ctx.fillText(ch, ax, ay);

    const x0 = ax - m.actualBoundingBoxLeft; // = penX + 1
    const y0 = ay - m.actualBoundingBoxAscent; // = penY + 1
    const g: Glyph = {
      u0: x0 / this.size,
      v0: y0 / this.size,
      u1: (x0 + wDev) / this.size,
      v1: (y0 + hDev) / this.size,
      dx: -m.actualBoundingBoxLeft / scale,
      dy: -m.actualBoundingBoxAscent / scale,
      w: wDev / scale,
      h: hDev / scale,
      advance,
    };
    this.penX += Math.ceil(wDev) + 3;
    this.rowH = Math.max(this.rowH, Math.ceil(hDev) + 2);
    this.placed.push({ key, px, ch, scale });
    this.dirty = true;
    return g;
  }

  // Full text state on every use — resizing the canvas (grow) resets it.
  private setTextState(rasterPx: number) {
    this.ctx.font = `${this.weight} ${rasterPx}px ${this.family}`;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#fff';
  }

  // Double the atlas and re-rasterize everything placed so far.
  private grow(minSize: number) {
    let size = this.size * 2;
    while (size < minSize) size *= 2;
    this.size = size;
    this.canvas.width = size;
    this.canvas.height = size;
    this.entries.clear();
    this.penX = this.penY = this.rowH = 0;
    const placed = this.placed;
    this.placed = [];
    for (const p of placed) this.entries.set(p.key, this.rasterize(p.key, p.px, p.ch, p.scale));
    this.dirty = true;
  }
}