// Chip scene: pure translation from Board + interaction state to renderer
// primitives. No GL, no React — the renderer just packs and draws the
// returned items in order.
//
// Chips render in an oblique projection: every chip draws its cylinder
// wall (with painted edge trims) plus its face; within a stack the chip
// above covers the faces below, so a stack reads as a top face over one
// striped wall band per chip. Data stays compressed in the Board — the
// per-chip items exist only as draw-list entries.

import { CHIP_TIER_VARS } from '../../chips/palette';
import { CHIP_RADIUS, CHIP_SQUASH, STACK_LIFT } from '../world';
import type { FontFace } from './text';
import type { RGB, RGBA, RingItem, SceneItem } from './primitives';
import { chipLabel, formatChips } from '../../../snapshot';
import { runsValue } from '../../chips/runs';
import { stackSize, type Board } from '../board';
import { allSlots, slotPosition } from '../lattice';
import { landingFor, stackTopOffset, type Pick } from '../interaction';
import type { Point } from '../geom';

export type Drag = { pointerId: number; grabX: number; grabY: number };
export type Lift = { stackId: number; depth: number; value: number };

export type SceneColors = {
  tiers: { face: RGB; spot: RGB; text: RGB }[];
  onFelt: RGB;
  canvasBg: RGB;
  line: RGB;
  ink: RGB;
  orange: RGB;
  orangeTint: RGB;
  blue: RGB;
  bodyFont: string;
};

// Resolve the theme tokens the scene needs. Re-run on theme changes.
export function resolveSceneColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => parseColor(style.getPropertyValue(name));
  return {
    tiers: CHIP_TIER_VARS.map(({ face, spot, text }) => ({
      face: v(face),
      spot: v(spot),
      text: v(text),
    })),
    onFelt: v('--on-felt'),
    canvasBg: v('--canvas'),
    line: v('--line'),
    ink: v('--ink'),
    orange: v('--orange'),
    orangeTint: v('--orange-tint'),
    blue: v('--blue'),
    bodyFont: style.getPropertyValue('--body-font').trim(),
  };
}

function parseColor(color: string): RGB {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return [0, 1, 1]; // loud fallback: unparseable tokens should be visible
}

// Stable pseudo-random rotation for a chip at a given stack+depth.
// Returns a value in [-MAX, +MAX] radians. Top chip always gets 0.
const MAX_CHIP_ROTATION = 0.18; // ~10 degrees max
function chipAngle(stackId: number, depth: number): number {
  // Xorshift-based integer hash — no imports needed.
  let h = (stackId * 2654435761) ^ (depth * 2246822519);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  // Map to [-MAX_CHIP_ROTATION, +MAX_CHIP_ROTATION]
  return ((h & 0xffff) / 0xffff - 0.5) * 2 * MAX_CHIP_ROTATION;
}

function rgba(c: RGB, a: number): RGBA {
  return [c[0], c[1], c[2], a];
}

// Darken a color — the dim effect for non-merge-target stacks while dragging.
function shade(c: RGB, factor: number): RGB {
  return [c[0] * factor, c[1] * factor, c[2] * factor];
}

function ring(
  x: number,
  y: number,
  rx: number,
  ry: number,
  width: number,
  dash: readonly [number, number],
  stroke: RGBA,
  fill: RGBA | null,
  soft = 0,
): RingItem {
  return { kind: 'ring', x, y, rx, ry, width, dash, stroke, fill, soft };
}

// Soft contact shadow ellipse under a chip resting on the felt.
function shadow(x: number, y: number, spread: number, alpha: number, soft: number): RingItem {
  return {
    kind: 'ring',
    x,
    y,
    rx: CHIP_RADIUS + spread,
    ry: (CHIP_RADIUS + spread) * CHIP_SQUASH,
    width: 0,
    dash: [0, 0],
    stroke: [0, 0, 0, 0],
    fill: [0, 0, 0, alpha],
    soft,
  };
}

function pushLabel(
  items: SceneItem[],
  font: FontFace,
  text: string,
  cx: number,
  cy: number,
  color: RGB,
) {
  const w = font.width(text);
  for (const g of font.glyphs(text, cx - w / 2, cy, color)) items.push(g);
}

export function buildScene(o: {
  board: Board;
  handPos: Point | null;
  drag: Drag | null;
  hover: Pick | null;
  lift: Lift | null;
  colors: SceneColors;
  time: number;
  fonts: { chip: FontFace; badge: FontFace };
}): SceneItem[] {
  const { board, handPos, drag, hover, lift, colors, time, fonts } = o;
  const items: SceneItem[] = [];

  // Slot lattice — squashed to match the chip faces.
  for (const slot of allSlots(board.felt)) {
    const { x, y } = slotPosition(slot);
    items.push(
      ring(
        x,
        y,
        CHIP_RADIUS - 1,
        (CHIP_RADIUS - 1) * CHIP_SQUASH,
        1,
        [3, 5],
        rgba(colors.onFelt, 0.16),
        null,
      ),
    );
  }

  const landing = board.hand && handPos ? landingFor(board, handPos) : null;
  const mergeTarget =
    landing?.type === 'combine'
      ? (board.stacks.find((s) => s.id === landing.stackId) ?? null)
      : null;

  // Landing ghost: where the hand's bottom chip will sit.
  if (landing && landing.type !== 'none') {
    const combine = landing.type === 'combine';
    items.push(
      ring(
        landing.ring.x,
        landing.ring.y,
        CHIP_RADIUS,
        CHIP_RADIUS * CHIP_SQUASH,
        2,
        [4, 4],
        combine ? rgba(colors.orange, 1) : rgba(colors.onFelt, 0.6),
        combine ? rgba(colors.orangeTint, 0.2) : null,
      ),
    );
  }

  // Merge halo: pulses around the stack the hand will combine with.
  if (mergeTarget) {
    const { x, y } = slotPosition(mergeTarget.slot);
    const n = stackSize(mergeTarget);
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    items.push(
      ring(
        x,
        y - ((n - 1) * STACK_LIFT) / 2,
        CHIP_RADIUS + 6 + pulse * 1.5,
        CHIP_RADIUS * CHIP_SQUASH + ((n - 1) * STACK_LIFT) / 2 + 6 + pulse * 1.5,
        2,
        [0, 0],
        rgba(colors.orange, 0.45 + 0.55 * pulse),
        null,
      ),
    );
  }

  // Stacks, y-sorted: a stack's bottom chip y is its z depth. Stacks lower
  // on the felt occlude the stacks behind them, so a tall stack overlaps
  // the row above correctly instead of insertion order deciding.
  const stacks = [...board.stacks].sort(
    (a, b) => slotPosition(a.slot).y - slotPosition(b.slot).y,
  );
  // Contact shadows, hoisted into one consecutive run ahead of the stacks.
  // A shadow never reaches neighboring chip ink (lattice spacing keeps them
  // clear), so drawing them all first is visually identical to interleaving
  // and saves one kind-switch — one draw call — per stack.
  for (const stack of stacks) {
    const { x, y } = slotPosition(stack.slot);
    items.push(shadow(x, y + STACK_LIFT + 1.5, 2.5, 0.25, 4));
  }

  for (const stack of stacks) {
    const isMergeTarget = mergeTarget?.id === stack.id;
    const dimFactor = drag !== null && !isMergeTarget ? 0.5 : 1;
    const { x, y } = slotPosition(stack.slot);
    const size = stackSize(stack);
    const kindAt: number[] = [];
    for (const run of stack.runs) {
      for (let i = 0; i < run.count; i++) kindAt.push(run.kind);
    }

    const hovered = hover?.stackId === stack.id ? hover : null;
    const liftState = lift?.stackId === stack.id ? lift : null;
    // The cut structure rides the lift state so the preview decays smoothly
    // after the pointer leaves.
    const cut = liftState?.depth ?? null;
    const liftValue = liftState?.value ?? 0;
    const topHover = hovered?.isTop === true;

    // Per-depth geometry helpers. Walls go in one run and exposed faces in
    // another: the renderer batches consecutive same-kind items, so this is
    // ~3 draw calls per stack instead of ~3 per chip. The reordering is
    // order-safe — walls of different depths overlap each other and the one
    // exposed face below them, and both keep their relative order here.
    const cyAt = (d: number) =>
      y - d * STACK_LIFT - (cut !== null && d >= cut ? liftValue : 0);
    const angleAt = (d: number) => (d === size - 1 ? 0 : chipAngle(stack.id, d));
    const pushWall = (d: number) => {
      const palette = colors.tiers[kindAt[d] % colors.tiers.length];
      items.push({
        kind: 'wall',
        x,
        y: cyAt(d),
        face: palette.face,
        spot: palette.spot,
        dim: dimFactor,
        thickness: STACK_LIFT,
        angle: angleAt(d),
      });
    };
    // Only exposed segment tops draw a face — the chip above covers the
    // faces below, so the rest would be hidden.
    const pushFace = (d: number) => {
      const palette = colors.tiers[kindAt[d] % colors.tiers.length];
      items.push({
        kind: 'chip',
        x,
        y: cyAt(d),
        face: palette.face,
        spot: palette.spot,
        dim: dimFactor,
        highlight: topHover && d === size - 1 ? rgba(colors.blue, 1) : null,
        angle: angleAt(d),
      });
      pushLabel(
        items,
        fonts.chip,
        chipLabel(board.catalog[kindAt[d]].value),
        x,
        cyAt(d) + 0.5,
        shade(palette.text, dimFactor),
      );
    };

    if (cut === null) {
      for (let d = 0; d < size; d++) pushWall(d);
      pushFace(size - 1);
    } else {
      // Cut stack: lower half, then the ghost dashed ellipse at the cut
      // plane, then the lifted upper half — same relative order as before.
      for (let d = 0; d < cut; d++) pushWall(d);
      if (cut > 0) pushFace(cut - 1);
      items.push(
        ring(x, y - cut * STACK_LIFT, CHIP_RADIUS, CHIP_RADIUS * CHIP_SQUASH, 2, [4, 4], rgba(colors.orange, 1), null),
      );
      for (let d = cut; d < size; d++) pushWall(d);
      pushFace(size - 1);
    }
  }

  // Hand — materialized individual chips, each a full wall + face.
  if (board.hand && handPos) {
    // Held above the table: a softer, wider shadow offset further down.
    items.push(shadow(handPos.x, handPos.y + STACK_LIFT + 5, 4, 0.18, 7));
    const handTop = board.hand.chips.length - 1;
    board.hand.chips.forEach((chip, i) => {
      const palette = colors.tiers[chip.kind % colors.tiers.length];
      const cx = handPos.x;
      const cy = handPos.y - i * STACK_LIFT;
      // Top chip of the hand (last in array = highest visually) stays unrotated.
      const angle = i === handTop ? 0 : chipAngle(chip.id, i);
      items.push({
        kind: 'wall',
        x: cx,
        y: cy,
        face: palette.face,
        spot: palette.spot,
        dim: 1,
        thickness: STACK_LIFT,
        angle,
      });
      items.push({
        kind: 'chip',
        x: cx,
        y: cy,
        face: palette.face,
        spot: palette.spot,
        dim: 1,
        highlight: null,
        angle,
      });
      pushLabel(
        items,
        fonts.chip,
        chipLabel(board.catalog[chip.kind].value),
        cx,
        cy + 0.5,
        palette.text,
      );
    });
  }

  // Hovered stack value badge.
  if (hover && !drag) {
    const stack = board.stacks.find((s) => s.id === hover.stackId);
    if (stack) {
      const { x, y } = slotPosition(stack.slot);
      const by = Math.max(16, y - stackTopOffset(stack) - 14 - 10);
      const text = formatChips(runsValue(stack.runs, board.catalog));
      const tw = fonts.badge.width(text);
      items.push({
        kind: 'panel',
        x,
        y: by,
        hw: tw / 2 + 8,
        hh: 9,
        radius: 9,
        fill: rgba(colors.canvasBg, 0.9),
        stroke: rgba(colors.line, 1),
      });
      pushLabel(items, fonts.badge, text, x, by, colors.ink);
    }
  }

  return items;
}