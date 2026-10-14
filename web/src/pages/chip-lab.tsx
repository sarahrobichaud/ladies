import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { CHIP_TIER_VARS } from '../components/chip-palette';
import { Chip } from '../components/chip';
import { CATALOG } from '../chips/catalog';
import { chipLabel } from '../snapshot';
import { allSlots, CHIP_RADIUS, slotPosition } from '../chips/lattice';
import { parseRuns } from '../chips/notation';
import {
  PREVIEW_LIFT,
  STACK_CAPACITY,
  STACK_LIFT,
  landingFor,
  nearestFreeSlot,
  nearestSlotAny,
  pickAt,
  stackSize,
  stackTopOffset,
  type Pick,
} from '../chips/rules';
import {
  clearBoard,
  commitHand,
  createBoard,
  discardHand,
  pickFrom,
  pickStack,
  pickTop,
  runsValue,
  setFelt,
  sizeHand,
  spawnStack,
  takeFromTray,
  totalValue,
} from '../chips/model';
import type { Board, Point, Slot } from '../chips/types';
import { formatChips } from '../snapshot';

const SPAWN_THRESHOLD = 6; // pointer travel before a tray press becomes a drag

type Drag = { pointerId: number; grabX: number; grabY: number };
type Spawn = { kind: number; pointerId: number; startX: number; startY: number };
type Lift = { stackId: number; depth: number; value: number };

// --- canvas palette ---------------------------------------------------------

type TierColors = { face: string; spot: string; text: string };
type CanvasColors = {
  tiers: TierColors[];
  onFelt: string;
  canvasBg: string;
  line: string;
  ink: string;
  orange: string;
  orangeTint: string;
  blue: string;
  bodyFont: string;
};

// Resolve the theme tokens the chip renderer needs. Re-run on theme changes.
function resolveCanvasColors(): CanvasColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
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
    bodyFont: v('--body-font'),
  };
}

function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Darken a resolved hex color (the dim effect — filters don't exist here,
// and alpha would make stacks see-through).
function shade(color: string, factor: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- chip drawing -----------------------------------------------------------

// A chip's edge seen edge-on: solid base circle, dark edge dashes, and a
// dark bottom-rim arc that doubles as the border with the crescent below.
function drawEdgeChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  palette: TierColors,
) {
  ctx.fillStyle = palette.face;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgb(0 0 0 / 0.5)';
  for (const dx of [-9, -3, 3, 9]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy + 19, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgb(0 0 0 / 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI);
  ctx.stroke();
}

// A chip's face seen top-down: fully round — base, edge spots, dashed
// inner ring, hairline rim with a stronger bottom arc, label.
function drawFaceChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  palette: TierColors,
  colors: CanvasColors,
  label: string | null,
  highlighted: boolean,
) {
  ctx.fillStyle = palette.face;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.spot;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * 17.5, cy + Math.sin(a) * 17.5, 3, 1.5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = withAlpha(palette.spot, 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 12.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgb(0 0 0 / 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI);
  ctx.stroke();
  if (highlighted) {
    ctx.save();
    ctx.strokeStyle = colors.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (label) {
    ctx.fillStyle = palette.text;
    ctx.font = `600 11px ${colors.bodyFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 0.5);
  }
}

function drawStack(
  ctx: CanvasRenderingContext2D,
  board: Board,
  stack: Parameters<typeof stackSize>[0],
  o: {
    hover: Pick | null;
    lift: Lift | null;
    colors: CanvasColors;
    dimFactor: number;
    highlight: boolean;
  },
) {
  const { x, y } = slotPosition(stack.slot);
  const size = stackSize(stack);
  const kindAt: number[] = [];
  for (const run of stack.runs) {
    for (let i = 0; i < run.count; i++) kindAt.push(run.kind);
  }

  const hovered = o.hover?.stackId === stack.id ? o.hover : null;
  const liftState = o.lift?.stackId === stack.id ? o.lift : null;
  // The cut structure rides the lift state so the preview decays smoothly
  // after the pointer leaves.
  const cut = liftState?.depth ?? null;
  const lift = liftState?.value ?? 0;
  const topHover = hovered?.isTop === true;

  const pal = (kind: number): TierColors => {
    const p = o.colors.tiers[kind % o.colors.tiers.length];
    return o.dimFactor === 1
      ? p
      : {
          face: shade(p.face, o.dimFactor),
          spot: shade(p.spot, o.dimFactor),
          text: shade(p.text, o.dimFactor),
        };
  };

  for (let d = 0; d < size; d++) {
    const palette = pal(kindAt[d]);
    const cx = x;
    const cy = y - d * STACK_LIFT - (cut !== null && d >= cut ? lift : 0);
    if (cut !== null && d === cut) {
      // Ghost dashed circle at the cut plane, under the lifted upper half.
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = o.colors.orange;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, y - cut * STACK_LIFT, CHIP_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Each segment's exposed top chip renders as a full face.
    const isSegmentTop = d === size - 1 || (cut !== null && d === cut - 1);
    const label = isSegmentTop ? chipLabel(board.catalog[kindAt[d]].value) : null;
    if (isSegmentTop) {
      drawFaceChip(ctx, cx, cy, palette, o.colors, label, topHover && d === size - 1);
    } else {
      drawEdgeChip(ctx, cx, cy, palette);
    }
  }
}

// --- felt rendering ---------------------------------------------------------

function drawFelt(
  ctx: CanvasRenderingContext2D,
  o: {
    board: Board;
    handPos: Point | null;
    drag: Drag | null;
    hover: Pick | null;
    lift: Lift | null;
    colors: CanvasColors;
    time: number;
  },
) {
  const { board, handPos, drag, hover, lift, colors, time } = o;
  ctx.clearRect(0, 0, board.felt.w, board.felt.h);

  // Slot lattice.
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(colors.onFelt, 0.16);
  for (const slot of allSlots(board.felt)) {
    const { x, y } = slotPosition(slot);
    ctx.beginPath();
    ctx.arc(x, y, CHIP_RADIUS - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const landing = board.hand && handPos ? landingFor(board, handPos) : null;
  const mergeTarget =
    landing?.type === 'combine'
      ? (board.stacks.find((s) => s.id === landing.stackId) ?? null)
      : null;

  // Landing ghost: where the hand's bottom chip will sit.
  if (landing && landing.type !== 'none') {
    const combine = landing.type === 'combine';
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = combine ? colors.orange : withAlpha(colors.onFelt, 0.6);
    if (combine) {
      ctx.fillStyle = withAlpha(colors.orangeTint, 0.2);
      ctx.beginPath();
      ctx.arc(landing.ring.x, landing.ring.y, CHIP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(landing.ring.x, landing.ring.y, CHIP_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Merge halo: pulses around the stack the hand will combine with.
  if (mergeTarget) {
    const { x, y } = slotPosition(mergeTarget.slot);
    const n = stackSize(mergeTarget);
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.55 * pulse;
    ctx.strokeStyle = colors.orange;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y - ((n - 1) * STACK_LIFT) / 2,
      CHIP_RADIUS + 6 + pulse * 1.5,
      14 + ((n - 1) * STACK_LIFT) / 2 + 6 + pulse * 1.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }

  // Stacks.
  for (const stack of board.stacks) {
    const isMergeTarget = mergeTarget?.id === stack.id;
    drawStack(ctx, board, stack, {
      hover,
      lift,
      colors,
      dimFactor: drag !== null && !isMergeTarget ? 0.5 : 1,
      highlight: isMergeTarget,
    });
  }

  // Hand — materialized individual chips.
  if (board.hand && handPos) {
    board.hand.chips.forEach((chip, i) => {
      const palette = colors.tiers[chip.kind % colors.tiers.length];
      drawFaceChip(
        ctx,
        handPos.x,
        handPos.y - i * STACK_LIFT,
        palette,
        colors,
        chipLabel(board.catalog[chip.kind].value),
        false,
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
      ctx.font = `600 12px ${colors.bodyFont}`;
      const tw = ctx.measureText(text).width;
      ctx.save();
      ctx.fillStyle = withAlpha(colors.canvasBg, 0.9);
      ctx.beginPath();
      ctx.roundRect(x - tw / 2 - 8, by - 9, tw + 16, 18, 9);
      ctx.fill();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, by);
      ctx.restore();
    }
  }
}

export function ChipLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [board, setBoard] = useState<Board>(() => createBoard(CATALOG, { w: 0, h: 0 }));
  const [handPos, setHandPos] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spawn, setSpawn] = useState<Spawn | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [notation, setNotation] = useState('');
  const [notationError, setNotationError] = useState<string | null>(null);

  const canvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  const total = totalValue(board);

  // Mirror the scene for the rAF loop and the native wheel listener. The
  // assignment runs in an effect (after render) so events always see the
  // latest committed state.
  const sceneRef = useRef({ board, handPos, drag, spawn, hover });
  useEffect(() => {
    sceneRef.current = { board, handPos, drag, spawn, hover };
  });
  const liftRef = useRef<Lift | null>(null);
  const colorsRef = useRef(resolveCanvasColors());
  const dprRef = useRef(1);

  // Theme/font switches change the resolved tokens.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      colorsRef.current = resolveCanvasColors();
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Wheel sizing (native listener; capacity rules live in the model op).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!sceneRef.current.drag || e.deltaY === 0) return;
      e.preventDefault();
      setBoard((b) => sizeHand(b, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Felt size → model + canvas bitmap (DPR-aware).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const felt = { w: entry.contentRect.width, h: entry.contentRect.height };
      setBoard((b) => setFelt(b, felt));
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(felt.w * dpr));
      el.height = Math.max(1, Math.round(felt.h * dpr));
      dprRef.current = dpr;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render loop.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const loop = (time: number) => {
      const { board, handPos, drag, hover } = sceneRef.current;
      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);

      // Lift animation: grows while a cut is hovered, decays after.
      const cutHover = hover && !hover.isTop && hover.depth > 0 ? hover : null;
      let ls = liftRef.current;
      if (cutHover) {
        if (!ls || ls.stackId !== cutHover.stackId || ls.depth !== cutHover.depth) {
          ls = { stackId: cutHover.stackId, depth: cutHover.depth, value: 0 };
        }
        ls.value += (PREVIEW_LIFT - ls.value) * 0.25;
      } else if (ls) {
        ls.value *= 0.7;
        if (ls.value < 0.5) ls = null;
      }
      liftRef.current = ls;

      drawFelt(ctx, { board, handPos, drag, hover, lift: ls, colors: colorsRef.current, time });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cancelGesture = () => {
    setDrag(null);
    setSpawn(null);
    setHover(null);
  };

  // Pointer moves: drag the hand, promote a tray press to a drag, or track
  // hover. Shared by the canvas and the tray chips — whoever holds pointer
  // capture receives the moves.
  const onPointerMove = (e: ReactPointerEvent<Element>) => {
    if (drag && drag.pointerId === e.pointerId) {
      const rect = canvasRect();
      if (!rect) return;
      setHandPos({ x: e.clientX - rect.left - drag.grabX, y: e.clientY - rect.top - drag.grabY });
      setHover(null);
    } else if (spawn && spawn.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - spawn.startX, e.clientY - spawn.startY) < SPAWN_THRESHOLD) return;
      const rect = canvasRect();
      if (!rect) return;
      setBoard(takeFromTray(board, spawn.kind));
      setSpawn(null);
      setHandPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDrag({ pointerId: e.pointerId, grabX: 0, grabY: 0 });
      setHover(null);
    } else {
      const rect = canvasRect();
      if (!rect) return;
      setHover(pickAt(board, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<Element>) => {
    if (drag && drag.pointerId === e.pointerId) {
      setDrag(null);
      const rect = canvasRect();
      if (!rect || !handPos) return;
      const overCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overCanvas) {
        setBoard(discardHand(board));
        setHandPos(null);
        return;
      }
      const landingAt = landingFor(board, handPos);
      const slot: Slot | null =
        landingAt.type === 'none' ? nearestSlotAny(board, handPos.x, handPos.y) : landingAt.slot;
      if (!slot) return;
      setBoard(commitHand(board, slot));
      setHandPos(null);
    } else if (spawn && spawn.pointerId === e.pointerId) {
      setSpawn(null);
      const rect = canvasRect();
      if (!rect) return;
      const slot = nearestFreeSlot(board, rect.width / 2, rect.height / 2);
      if (slot) setBoard(spawnStack(board, [{ kind: spawn.kind, count: 1 }], slot));
    }
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const rect = canvasRect();
    if (!rect) return;
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pick = pickAt(board, point);
    if (!pick) return;
    const stack = board.stacks.find((s) => s.id === pick.stackId);
    if (!stack) return;
    const { x: sx, y: sy } = slotPosition(stack.slot);
    const previewLift =
      liftRef.current && liftRef.current.stackId === pick.stackId ? liftRef.current.value : 0;
    const visual = { x: sx, y: sy - pick.depth * STACK_LIFT - previewLift };
    const next =
      e.button === 2
        ? pickStack(board, stack.id)
        : pick.isTop
          ? pickTop(board, stack.id)
          : pickFrom(board, stack.id, pick.depth);
    if (next === board) return;
    setBoard(next);
    setHover(null);
    setHandPos(visual);
    setDrag({
      pointerId: e.pointerId,
      grabX: e.clientX - (rect.left + visual.x),
      grabY: e.clientY - (rect.top + visual.y),
    });
  };

  const onPointerDownTray =
    (kind: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHover(null);
      setSpawn({ kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY });
    };

  const addNotation = () => {
    try {
      const runs = parseRuns(notation, board.catalog);
      const slot = nearestFreeSlot(board, board.felt.w / 2, board.felt.h / 2);
      if (!slot) {
        setNotationError('the felt is full');
        return;
      }
      setBoard(spawnStack(board, runs, slot));
      setNotation('');
      setNotationError(null);
    } catch (err) {
      setNotationError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-dvh flex-col gap-4 bg-canvas p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-ink">Chip lab</h1>
          <p className="text-sm text-muted">
            Stacks are compressed entities — grab the top, split lower, wheel-size, combine on
            tops.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm tabular-nums text-muted">On the table: {formatChips(total)}</p>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addNotation();
            }}
          >
            <input
              value={notation}
              onChange={(e) => setNotation(e.target.value)}
              placeholder="(500, 5), (25, 6)"
              className="w-44 rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink hover:bg-blue-tint"
            >
              Add
            </button>
          </form>
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={() => setBoard(clearBoard(board))}
          >
            Clear table
          </button>
          <Link to="/" className="text-sm text-orange hover:text-orange-strong">
            Back
          </Link>
        </div>
      </header>
      {notationError && <p className="text-xs text-orange-strong">{notationError}</p>}

      {/* Specimen strip: every palette tier, for component reference */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 shadow-lg">
        {board.catalog.map((kind, kindId) => (
          <div key={kindId} className="flex flex-col items-center gap-1">
            <Chip value={kind.value} tier={kind.tier} size={44} />
            <span className="text-[10px] text-muted">{chipLabel(kind.value)}</span>
          </div>
        ))}
        <p className="ml-auto max-w-56 text-xs leading-relaxed text-muted">
          Press a tray chip to place one, or drag it straight onto the felt. Chips land on the
          slots — lower a stack onto another stack's top to combine; occupied slots are skipped,
          and dropping off the felt takes chips back. Right-click carries a whole stack; scroll
          while holding one to size it (max {STACK_CAPACITY}).
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Chip tray */}
        <div className="flex w-36 shrink-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <p className="text-[10px] uppercase tracking-wide text-muted">Tray</p>
          {board.catalog.map((kind, kindId) => (
            <div
              key={kindId}
              className="draggable cursor-grab self-start"
              onPointerDown={onPointerDownTray(kindId)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelGesture}
            >
              <Chip value={kind.value} tier={kind.tier} size={44} />
            </div>
          ))}
        </div>

        {/* Felt canvas */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line">
          <canvas
            ref={canvasRef}
            className="pov-felt absolute inset-0 h-full w-full"
            style={{
              cursor: drag ? 'grabbing' : hover ? 'grab' : 'default',
              touchAction: 'none',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={cancelGesture}
            onPointerLeave={() => setHover(null)}
          />
          {board.stacks.length === 0 && !board.hand && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-on-felt/50">
              Empty felt — add chips from the tray
            </p>
          )}
        </div>
      </div>
    </div>
  );
}