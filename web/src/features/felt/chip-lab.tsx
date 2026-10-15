import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { Chip } from '../chips/chip';
import { CATALOG } from '../chips/catalog';
import { chipLabel } from '../../snapshot';
import { allSlots, slotPosition, type Slot } from './lattice';
import { parseRuns } from '../chips/notation';
import {
  PREVIEW_LIFT,
  landingFor,
  nearestFreeSlot,
  nearestSlotAny,
  pickAt,
  type Pick,
} from './interaction';
import { STACK_LIFT } from './world';
import { STACK_CAPACITY, clearBoard, commitHand, createBoard, discardHand, pickFrom, pickStack, pickTop, setFelt, sizeHand, spawnStack, takeFromTray, totalValue, type Board } from './board';
import { coalesce } from '../chips/runs';
import type { Catalog, Run } from '../chips/types';
import type { Point } from './geom';
import { formatChips } from '../../snapshot';
import { createPrimitiveRenderer, type PrimitiveRenderer } from './renderer/renderer';
import { buildScene, type Drag, type Lift } from './renderer/scene';
import { resolveSceneColors } from './renderer/colors';

const SPAWN_THRESHOLD = 6; // pointer travel before a tray press becomes a drag

type Spawn = { kind: number; pointerId: number; startX: number; startY: number };

// A random canonical stack: 1..STACK_CAPACITY chips split into runs of
// random denominations. coalesce merges adjacent same-kind runs.
function randomRuns(catalog: Catalog): Run[] {
  const total = 1 + Math.floor(Math.random() * STACK_CAPACITY);
  const runs: Run[] = [];
  let left = total;
  while (left > 0) {
    const count = 1 + Math.floor(Math.random() * left);
    const kind = Math.floor(Math.random() * catalog.length);
    runs.push({ kind, count });
    left -= count;
  }
  return coalesce(runs);
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
  const colorsRef = useRef(resolveSceneColors());
  const dprRef = useRef(1);

  // Theme/font switches change the resolved tokens.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      colorsRef.current = resolveSceneColors();
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
    let renderer: PrimitiveRenderer | null = null;
    try {
      renderer = createPrimitiveRenderer(el);
    } catch (err) {
      console.error('chip renderer: WebGL init failed', err);
    }
    if (!renderer) return;
    let raf = 0;
    const loop = (time: number) => {
      const { board, handPos, drag, hover } = sceneRef.current;
      const colors = colorsRef.current;

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

      const dpr = dprRef.current;
      const fonts = {
        chip: renderer.font(11, colors.bodyFont, '600', dpr),
        badge: renderer.font(12, colors.bodyFont, '600', dpr),
      };
      const scene = buildScene({ board, handPos, drag, hover, lift: ls, colors, time, fonts });
      renderer.render(scene, board.felt.w, board.felt.h);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
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

  // Fill every lattice slot with a random stack — worst case for the
  // renderer (max stacks × max chips) and for pick/landing hit-testing.
  const stressTest = () => {
    setBoard((b) => {
      let next = clearBoard(b);
      const slots = allSlots(next.felt);
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (const slot of slots) next = spawnStack(next, randomRuns(next.catalog), slot);
      return next;
    });
    setHandPos(null);
    setHover(null);
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
            onClick={stressTest}
          >
            Stress test
          </button>
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
            <Chip value={kind.value} tier={kind.tier} />
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
              <Chip value={kind.value} tier={kind.tier} />
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