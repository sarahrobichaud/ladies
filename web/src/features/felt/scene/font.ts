// Text layout contract the scene builder renders with; the renderer's
// glyph atlas implements it.

import type { GlyphItem, RGB } from "./primitives";

export interface FontFace {
  width(text: string): number;
  // Quads for `text` anchored at (x, y) = left edge, middle baseline.
  glyphs(text: string, x: number, y: number, color: RGB): GlyphItem[];
}
