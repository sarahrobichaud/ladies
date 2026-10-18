import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useState, useSyncExternalStore } from "react";
import type { KindId } from "../../chips/types";
import { type CameraStore, type PanZone, viewToWorld } from "../camera";
import {
  commitHand,
  discardHand,
  type Felt,
  pickFrom,
  pickStack,
  pickTop,
  type StackId,
  sizeHand,
  spawnStack,
  takeFromTray,
  zoneStackValue,
} from "../felt";
import type { Point } from "../geom";
import {
  buttonZoneAt,
  type Drag,
  type Lift,
  landingFor,
  nearestFreeSlot,
  nearestPlaceableSlot,
  type Pick,
  PREVIEW_LIFT,
  pickAt,
} from "../interaction";
import { type Slot, slotPosition } from "../lattice";
import { feltPoint, type Stage } from "../stage";
import type { FeltStore } from "../store";
import { CHIP_RADIUS, CHIP_SQUASH, rpx, STACK_LIFT } from "../world";
import { resolveZones, zoneById } from "../zones";

/** Pointer semantics against the resting felt, as a plain controller. */

/** Pointer travel before a tray press becomes a drag, as a fraction of the chip radius. */
const SPAWN_THRESHOLD = rpx(0.17);

/** A tray press in progress: which kind, which pointer, where it started. */
type Spawn = { kind: KindId; pointerId: number; startX: number; startY: number };

/** Semantic outcomes of felt gestures, for callers reacting to interactions. */
export type FeltAction =
  | { type: "pick"; stackId: StackId; depth: number; isTop: boolean }
  | { type: "drop"; slot: Slot; combined: boolean }
  | { type: "discard" }
  | { type: "spawn"; kind: KindId; slot: Slot }
  | { type: "bet"; zoneId: string; value: bigint };

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

/** Cursor the felt canvas should show, derived from the gesture state. */
export type FeltCursor = "grab" | "grabbing" | "default";

/** Per-frame gesture inputs, read by the render loop instead of React state. */
export type GestureFrame = {
  handPos: Point | null;
  drag: Drag | null;
  hover: Pick | null;
};

/** Creation options for the gesture controller. */
export type FeltGesturesOptions = {
  /** Felt state store the controller reads and applies ops to. */
  store: FeltStore;
  /** Canvas layout authority; supplies the felt origin for pointer mapping. */
  stage: Stage;
  /** Live camera store; supplies the world↔screen mapping for pointers. */
  camera: CameraStore;
  /** Ref for the canvas element the gestures are bound to. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

/** The felt's gesture controller: mutable frame state plus stable handlers. */
export type FeltGestures = {
  /** Snapshot of the gesture state for one rendered frame; valid until the next call. */
  frame(): GestureFrame;
  /** Advances the cut-preview lift animation one frame; null once settled. */
  stepLift(): Lift | null;
  /** Cursor derived from the current gesture state; stable between changes. */
  getCursor(): FeltCursor;
  /** Subscribes to cursor changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Binds the native (non-passive) wheel listener; returns its cleanup. */
  attach(canvas: HTMLCanvasElement): () => void;
  /** Clears all transient gesture state, including the hand position. */
  reset(): void;
  /** Semantic action sink; assign to react to picks, drops, discards, spawns, and bets. */
  onAction?: (action: FeltAction) => void;
  /** Camera pan sink; assign to tween the camera toward a zone on a/s/d. */
  onPan?: (zone: PanZone) => void;
  /** Pointer handlers for the felt canvas element. */
  readonly canvasHandlers: CanvasHandlers;
  /**
   * Pointer handler bundle for one tray chip.
   * @param kind - the tray chip's kind id
   */
  trayHandlers(kind: KindId): TrayHandlers;
};

/**
 * Creates the felt gesture controller. Frame state lives in plain variables
 * that the render loop reads directly; React only subscribes to the cursor.
 * @param options - felt store, canvas layout, and canvas ref
 * @returns the controller with handlers, frame access, and lifecycle
 */
export function createFeltGestures({ store, stage, camera, canvasRef }: FeltGesturesOptions): FeltGestures {
  let handPos: Point | null = null;
  let drag: Drag | null = null;
  let spawn: Spawn | null = null;
  let hover: Pick | null = null;
  let lift: Lift | null = null;
  let cursor: FeltCursor = "default";
  let onAction: ((action: FeltAction) => void) | undefined;
  let onPan: ((zone: PanZone) => void) | undefined;

  const listeners = new Set<() => void>();
  const frameView: GestureFrame = { handPos: null, drag: null, hover: null };

  /** Notifies React subscribers; only the cursor is React-visible. */
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  /** Re-derives the cursor from drag/hover and notifies on change. */
  const syncCursor = () => {
    const next = drag ? "grabbing" : hover ? "grab" : "default";
    if (next !== cursor) {
      cursor = next;
      emit();
    }
  };

  const setDrag = (next: Drag | null) => {
    drag = next;
    syncCursor();
  };

  const setHover = (next: Pick | null) => {
    hover = next;
    syncCursor();
  };

  /**
   * Client-space rect of the canvas.
   * @returns the rect, or null when the canvas is unmounted
   */
  const canvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  /**
   * Converts a client-space point to felt-local pixels.
   * @param clientX - the point x in client space
   * @param clientY - the point y in client space
   * @returns the point in felt pixels, or null when the canvas is unmounted
   */
  const toFelt = (clientX: number, clientY: number): Point | null => {
    const rect = canvasRect();
    if (!rect) {
      return null;
    }
    return feltPoint(stage, viewToWorld(camera.get(), { x: clientX - rect.left, y: clientY - rect.top }));
  };

  /**
   * Ends the active gesture, leaving felt state and hand position untouched.
   */
  const cancelGesture = () => {
    setDrag(null);
    spawn = null;
    setHover(null);
  };

  /**
   * Moves the held hand with the pointer.
   * @param e - move event from the capturing element
   * @param d - the active drag
   */
  const dragHand = (e: ReactPointerEvent<Element>, d: Drag) => {
    const pos = toFelt(e.clientX, e.clientY);
    if (!pos) {
      return;
    }
    handPos = { x: pos.x - d.grabX, y: pos.y - d.grabY };
    setHover(null);
  };

  /**
   * Promotes a tray press past the spawn threshold into a hand drag.
   * @param e - move event from the capturing tray chip
   * @param s - the tray press being promoted
   */
  const promoteSpawn = (e: ReactPointerEvent<Element>, s: Spawn) => {
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < SPAWN_THRESHOLD) {
      return;
    }
    const pos = toFelt(e.clientX, e.clientY);
    if (!pos) {
      return;
    }
    store.apply((f) => takeFromTray(f, s.kind));
    spawn = null;
    handPos = pos;
    setDrag({ pointerId: e.pointerId, grabX: 0, grabY: 0 });
    setHover(null);
  };

  /**
   * Tracks hover against the resting felt.
   * @param e - move event over the canvas
   */
  const trackHover = (e: ReactPointerEvent<Element>) => {
    const pos = toFelt(e.clientX, e.clientY);
    if (!pos) {
      return;
    }
    setHover(pickAt(store.get(), pos));
  };

  // Shared by the canvas and the tray chips: whoever holds pointer capture
  // receives the moves.
  const onPointerMove = (e: ReactPointerEvent<Element>) => {
    if (drag && drag.pointerId === e.pointerId) {
      dragHand(e, drag);
    } else if (spawn && spawn.pointerId === e.pointerId) {
      promoteSpawn(e, spawn);
    } else {
      trackHover(e);
    }
  };

  /**
   * Fires the bet action when a button zone's face is pressed; the consumer
   * owns what the commit does with the staged value.
   * @param source - the felt to read the button and bet zone from
   * @param point - the pointer position in felt pixels
   * @returns whether the press landed on a button
   */
  const pressBetButton = (source: Felt, point: Point): boolean => {
    const button = buttonZoneAt(source, point);
    if (!button?.commits) {
      return false;
    }
    const betZone = zoneById(resolveZones(source.layout), button.commits);
    if (betZone?.purpose !== "bet") {
      return false;
    }
    const value = zoneStackValue(source, betZone.id);
    if (value > 0n) {
      onAction?.({ type: "bet", zoneId: betZone.id, value });
    }
    return true;
  };

  /**
   * Releases a held hand: the landing outcome decides between combine, place,
   * and discard, so the commit matches what the drag preview showed.
   */
  const releaseDrag = () => {
    const pos = handPos;
    if (!pos) {
      return;
    }
    const source = store.get();
    const landingAt = landingFor(source, pos);
    if (landingAt.type === "discard") {
      store.apply(discardHand);
      handPos = null;
      onAction?.({ type: "discard" });
      return;
    }
    const slot: Slot | null = landingAt.type === "none" ? nearestPlaceableSlot(source, pos.x, pos.y) : landingAt.slot;
    if (!slot) {
      return;
    }
    const next = commitHand(source, slot);
    if (next === source) {
      // Rejected (e.g. the stack height cap): the hand stays held, ready to re-grab.
      return;
    }
    store.apply(() => next);
    handPos = null;
    onAction?.({ type: "drop", slot, combined: landingAt.type === "combine" });
  };

  /**
   * Releases a tray press that stayed under the spawn threshold: places one
   * chip near the felt's center.
   * @param s - the tray press being released
   */
  const releaseSpawn = (s: Spawn) => {
    const size = store.get().felt;
    const slot = nearestFreeSlot(store.get(), size.w / 2, size.h / 2);
    if (!slot) {
      return;
    }
    store.apply((f) => spawnStack(f, [{ kind: s.kind, count: 1 }], slot));
    onAction?.({ type: "spawn", kind: s.kind, slot });
  };

  const onPointerUp = (e: ReactPointerEvent<Element>) => {
    if (drag && drag.pointerId === e.pointerId) {
      setDrag(null);
      releaseDrag();
    } else if (spawn && spawn.pointerId === e.pointerId) {
      const s = spawn;
      spawn = null;
      releaseSpawn(s);
    }
  };

  /**
   * Picks chips from a stack into the hand: right-click carries the whole
   * stack, otherwise the top chip or a split at the hovered depth.
   * @param e - down event on the canvas
   */
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const point = toFelt(e.clientX, e.clientY);
    if (!point) {
      return;
    }
    if (pressBetButton(store.get(), point)) {
      return;
    }
    // A held hand that couldn't be placed stays on the felt; pressing on it re-grabs it.
    const held = store.get().hand;
    if (held && handPos) {
      const topOffset = (held.chips.length - 1) * STACK_LIFT;
      const withinHand =
        Math.abs(point.x - handPos.x) <= CHIP_RADIUS &&
        point.y >= handPos.y - topOffset - CHIP_RADIUS * CHIP_SQUASH &&
        point.y <= handPos.y + CHIP_RADIUS * CHIP_SQUASH + STACK_LIFT;
      if (withinHand) {
        setDrag({ pointerId: e.pointerId, grabX: point.x - handPos.x, grabY: point.y - handPos.y });
      }
      return;
    }
    const pick = pickAt(store.get(), point);
    if (!pick) {
      return;
    }
    const stack = store.get().stacks.find((s) => s.id === pick.stackId);
    if (!stack) {
      return;
    }
    const { x: sx, y: sy } = slotPosition(stack.slot);
    const previewLift = lift && lift.stackId === pick.stackId ? lift.value : 0;
    const visual = { x: sx, y: sy - pick.depth * STACK_LIFT - previewLift };
    const source = store.get();
    const next =
      e.button === 2
        ? pickStack(source, stack.id)
        : pick.isTop
          ? pickTop(source, stack.id)
          : pickFrom(source, stack.id, pick.depth);
    if (next === source) {
      return;
    }
    store.apply(() => next);
    setHover(null);
    handPos = visual;
    setDrag({
      pointerId: e.pointerId,
      grabX: point.x - visual.x,
      grabY: point.y - visual.y,
    });
    onAction?.({
      type: "pick",
      stackId: pick.stackId,
      depth: pick.depth,
      isTop: pick.isTop,
    });
  };

  /**
   * Starts a tray press for a chip kind.
   * @param kind - the pressed tray chip's kind id
   */
  const onTrayPointerDown = (kind: KindId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(null);
    spawn = { kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  };

  const canvasHandlers: CanvasHandlers = {
    onPointerDown: onCanvasPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancelGesture,
    onPointerLeave: () => setHover(null),
    onContextMenu: (e) => e.preventDefault(),
  };

  return {
    frame: () => {
      frameView.handPos = handPos;
      frameView.drag = drag;
      frameView.hover = hover;
      return frameView;
    },
    stepLift: () => {
      const cutHover = hover && !hover.isTop && hover.depth > 0 ? hover : null;
      if (cutHover) {
        if (!lift || lift.stackId !== cutHover.stackId || lift.depth !== cutHover.depth) {
          lift = { stackId: cutHover.stackId, depth: cutHover.depth, value: 0 };
        }
        lift.value += (PREVIEW_LIFT - lift.value) * 0.25;
      } else if (lift) {
        lift.value *= 0.7;
        if (lift.value < PREVIEW_LIFT * 0.05) {
          lift = null;
        }
      }
      return lift;
    },
    getCursor: () => cursor,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: (canvas) => {
      // A native listener so wheel can preventDefault; capacity rules live in
      // the model op.
      const onWheel = (e: WheelEvent) => {
        if (!drag || e.deltaY === 0) {
          return;
        }
        e.preventDefault();
        store.apply((f) => sizeHand(f, e.deltaY < 0 ? 1 : -1));
      };
      canvas.addEventListener("wheel", onWheel, { passive: false });

      // Keyboard panning: pressing a/s/d tweens the camera to the
      // left/center/right zone; the camera no-ops when the world fits.
      const zoneKeys: Record<string, PanZone> = { a: "left", s: "center", d: "right" };
      const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
        const zone = zoneKeys[e.key.toLowerCase()];
        if (zone && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
          onPan?.(zone);
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => {
        canvas.removeEventListener("wheel", onWheel);
        window.removeEventListener("keydown", onKeyDown);
      };
    },
    reset: () => {
      setDrag(null);
      spawn = null;
      setHover(null);
      handPos = null;
    },
    get onAction() {
      return onAction;
    },
    set onAction(sink) {
      onAction = sink;
    },
    get onPan() {
      return onPan;
    },
    set onPan(sink) {
      onPan = sink;
    },
    canvasHandlers,
    trayHandlers: (kind: KindId): TrayHandlers => ({
      onPointerDown: onTrayPointerDown(kind),
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelGesture,
    }),
  };
}

/**
 * Owns one gesture controller for the component's lifetime.
 * @param options - felt store, canvas layout, and canvas ref
 * @returns the gesture controller
 */
export function useFeltGestures(options: FeltGesturesOptions): FeltGestures {
  const [gestures] = useState(() => createFeltGestures(options));
  return gestures;
}

/**
 * Subscribes a component to the gesture-derived canvas cursor.
 * @param gestures - the gesture controller to read
 */
export function useFeltCursor(gestures: FeltGestures): FeltCursor {
  return useSyncExternalStore(gestures.subscribe, gestures.getCursor);
}
