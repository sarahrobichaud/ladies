import { useEffect, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import {
  PREVIEW_LIFT,
  landingFor,
  nearestFreeSlot,
  nearestSlotAny,
  pickAt,
  type Drag,
  type Lift,
  type Pick,
} from '../interaction';
import { slotPosition, type Slot } from '../lattice';
import { STACK_LIFT } from '../world';
import type { Point } from '../geom';
import type { KindId } from '../../chips/types';
import {
  commitHand,
  discardHand,
  pickFrom,
  pickStack,
  pickTop,
  sizeHand,
  spawnStack,
  takeFromTray,
  type Felt,
  type StackId,
} from '../felt';
import { useLatestRef } from '../../../hooks/use-latest-ref';

/** Pointer travel before a tray press becomes a drag, in px. */
const SPAWN_THRESHOLD = 6;

/** A tray press in progress: which kind, which pointer, where it started. */
type Spawn = { kind: KindId; pointerId: number; startX: number; startY: number };

/** Semantic outcomes of felt gestures, for callers reacting to interactions. */
export type FeltAction =
  | { type: 'pick'; stackId: StackId; depth: number; isTop: boolean }
  | { type: 'drop'; slot: Slot; combined: boolean }
  | { type: 'discard' }
  | { type: 'spawn'; kind: KindId; slot: Slot };

/** Pointer handlers for the felt canvas element. */
export type CanvasHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
};

/** Pointer handlers for one tray chip element. */
export type TrayHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: () => void;
};

type Options = {
  felt: Felt;
  /** Stable dispatcher for the pure felt ops (from useFelt). */
  apply: (op: (felt: Felt) => Felt) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onAction?: (action: FeltAction) => void;
};

/**
 * The felt's pointer state machine: drag, tray-spawn, hover, and the
 * cut-preview lift animation. Translates raw pointer gestures into felt
 * model ops and semantic FeltActions — the actions-out surface for a felt
 * canvas.
 * @param options - felt state, op dispatcher, canvas ref, and action sink
 * @returns gesture state, handler bundles, the lift animation stepper, and reset
 */
export function useFeltGestures({ felt, apply, canvasRef, onAction }: Options) {
  const [handPos, setHandPos] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spawn, setSpawn] = useState<Spawn | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);

  const feltRef = useLatestRef(felt);
  const handPosRef = useLatestRef(handPos);
  const dragRef = useLatestRef(drag);
  const spawnRef = useLatestRef(spawn);
  const onActionRef = useLatestRef(onAction);

  // Cut-preview lift animation state: grows while a cut is hovered, decays
  // after. Stepped by the render loop; read by the pick gesture for the
  // visual grab point.
  const liftRef = useRef<Lift | null>(null);

  const canvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  // Wheel sizing (native listener; capacity rules live in the model op).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!dragRef.current || e.deltaY === 0) return;
      e.preventDefault();
      apply((f) => sizeHand(f, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef, dragRef, apply]);

  /** Advances the lift animation one frame against the current hover. */
  const stepLift = (hover: Pick | null): Lift | null => {
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
    return ls;
  };

  const cancelGesture = () => {
    setDrag(null);
    setSpawn(null);
    setHover(null);
  };

  /** Clears all transient gesture state, including the hand position. */
  const reset = () => {
    setDrag(null);
    setSpawn(null);
    setHover(null);
    setHandPos(null);
  };

  // Pointer moves: drag the hand, promote a tray press to a drag, or track
  // hover. Shared by the canvas and the tray chips — whoever holds pointer
  // capture receives the moves.
  const onPointerMove = (e: ReactPointerEvent<Element>) => {
    const d = dragRef.current;
    const s = spawnRef.current;
    if (d && d.pointerId === e.pointerId) {
      const rect = canvasRect();
      if (!rect) return;
      setHandPos({ x: e.clientX - rect.left - d.grabX, y: e.clientY - rect.top - d.grabY });
      setHover(null);
    } else if (s && s.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < SPAWN_THRESHOLD) return;
      const rect = canvasRect();
      if (!rect) return;
      apply((f) => takeFromTray(f, s.kind));
      setSpawn(null);
      setHandPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setDrag({ pointerId: e.pointerId, grabX: 0, grabY: 0 });
      setHover(null);
    } else {
      const rect = canvasRect();
      if (!rect) return;
      setHover(pickAt(feltRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<Element>) => {
    const d = dragRef.current;
    const s = spawnRef.current;
    if (d && d.pointerId === e.pointerId) {
      setDrag(null);
      const rect = canvasRect();
      const pos = handPosRef.current;
      if (!rect || !pos) return;
      const overCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overCanvas) {
        apply(discardHand);
        setHandPos(null);
        onActionRef.current?.({ type: 'discard' });
        return;
      }
      const landingAt = landingFor(feltRef.current, pos);
      const slot: Slot | null =
        landingAt.type === 'none' ? nearestSlotAny(feltRef.current, pos.x, pos.y) : landingAt.slot;
      if (!slot) return;
      apply((f) => commitHand(f, slot));
      setHandPos(null);
      onActionRef.current?.({ type: 'drop', slot, combined: landingAt.type === 'combine' });
    } else if (s && s.pointerId === e.pointerId) {
      setSpawn(null);
      const rect = canvasRect();
      if (!rect) return;
      const slot = nearestFreeSlot(feltRef.current, rect.width / 2, rect.height / 2);
      if (!slot) return;
      apply((f) => spawnStack(f, [{ kind: s.kind, count: 1 }], slot));
      onActionRef.current?.({ type: 'spawn', kind: s.kind, slot });
    }
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const rect = canvasRect();
    if (!rect) return;
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pick = pickAt(feltRef.current, point);
    if (!pick) return;
    const stack = feltRef.current.stacks.find((s) => s.id === pick.stackId);
    if (!stack) return;
    const { x: sx, y: sy } = slotPosition(stack.slot);
    const lift = liftRef.current;
    const previewLift = lift && lift.stackId === pick.stackId ? lift.value : 0;
    const visual = { x: sx, y: sy - pick.depth * STACK_LIFT - previewLift };
    const source = feltRef.current;
    const next =
      e.button === 2
        ? pickStack(source, stack.id)
        : pick.isTop
          ? pickTop(source, stack.id)
          : pickFrom(source, stack.id, pick.depth);
    if (next === source) return;
    apply(() => next);
    setHover(null);
    setHandPos(visual);
    setDrag({
      pointerId: e.pointerId,
      grabX: e.clientX - (rect.left + visual.x),
      grabY: e.clientY - (rect.top + visual.y),
    });
    onActionRef.current?.({
      type: 'pick',
      stackId: pick.stackId,
      depth: pick.depth,
      isTop: pick.isTop,
    });
  };

  const onTrayPointerDown =
    (kind: KindId) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHover(null);
      setSpawn({ kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY });
    };

  const canvasHandlers: CanvasHandlers = {
    onPointerDown: onCanvasPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelGesture,
    onPointerLeave: () => setHover(null),
    onContextMenu: (e) => e.preventDefault(),
  };

  const trayHandlers = (kind: KindId): TrayHandlers => ({
    onPointerDown: onTrayPointerDown(kind),
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelGesture,
  });

  return { drag, hover, handPos, cancelGesture, reset, stepLift, canvasHandlers, trayHandlers };
}

export type FeltGestures = ReturnType<typeof useFeltGestures>;
