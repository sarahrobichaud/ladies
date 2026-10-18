import type { Point, Size } from "./geom";
import { type Stage, worldSize } from "./stage";

/**
 * The felt camera: the single authority for mapping between the world plane
 * and the screen. It scales the world so its height fills the viewport (never
 * shrinking further to fit the width — width overflow pans instead), clamps
 * the scale to readable bounds, and centers the leftover space. Consumers
 * read the mapping through `worldToView` / `viewToWorld`; nothing else does
 * scale math. The camera lives in an external store: frame and event code
 * read `get()` directly, React components subscribe.
 */

/** Device-px scale lower bound; below it the world crops, centered. */
export const MIN_SCALE = 0.75;

/** Device-px scale upper bound; above it the world letterboxes, centered. */
export const MAX_SCALE = 1.5;

/** Horizontal anchor points for keyboard panning, as fractions of the world width. */
export type PanZone = "left" | "center" | "right";

/** Fraction of the world width each pan zone centers on. */
const ZONE_ANCHOR: Record<PanZone, number> = { left: 0.2, center: 0.5, right: 0.8 };

/** Fraction of the remaining pan distance covered per second while easing. */
const PAN_EASE_PER_SECOND = 8;

/** Remaining pan distance below which the camera snaps to its target, in world px. */
const PAN_SNAP_PX = 0.5;

/**
 * Whether the camera's pan sits on a zone's anchor, so a tween can stop.
 * @param camera - the camera to check
 * @param zone - the zone whose anchor to test against
 */
export function cameraPanAtTarget(camera: Camera, zone: PanZone): boolean {
  const overflow = worldSize.w - camera.view.w;
  if (overflow <= 0) {
    return true;
  }
  const target = ZONE_ANCHOR[zone] * worldSize.w - camera.view.w / 2;
  const clamped = Math.max(0, Math.min(overflow, target));
  return Math.abs(clamped - camera.pan.x) < PAN_SNAP_PX;
}

/** The camera state the renderer, gestures, and DOM chrome share. */
export type Camera = {
  /** Screen px per world px. */
  readonly scale: number;
  /** World-px position of the view's top-left corner on the world plane. */
  readonly pan: Point;
  /** The world-px region of the world plane the viewport shows. */
  readonly view: Size;
};

/**
 * Scales the world so its height fills the viewport, within the scale bounds;
 * width overflow is handled by panning, not by shrinking.
 * @param viewport - canvas size in screen px
 * @param dpr - device pixel ratio, which scales the clamp bounds so browser
 * zoom is absorbed instead of cropping or letterboxing the map
 * @returns the camera for that viewport
 */
export function createCamera(viewport: Size, dpr: number): Camera {
  if (viewport.w <= 0 || viewport.h <= 0) {
    return { scale: 1, pan: { x: 0, y: 0 }, view: { w: 0, h: 0 } };
  }
  const ratio = dpr > 0 ? dpr : 1;
  const fit = viewport.h / worldSize.h;
  const scale = Math.min(MAX_SCALE / ratio, Math.max(MIN_SCALE / ratio, fit));
  const view = { w: viewport.w / scale, h: viewport.h / scale };
  // The view's top-left world-plane position; centering puts it at the
  // world's negative margin, so the world lands in the view's middle.
  const pan = { x: (worldSize.w - view.w) / 2, y: (worldSize.h - view.h) / 2 };
  return { scale, pan, view };
}

/**
 * Converts a world-px point to view px.
 * @param camera - the camera providing the mapping
 * @param p - the point in world px
 */
export function worldToView(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.pan.x) * camera.scale, y: (p.y - camera.pan.y) * camera.scale };
}

/**
 * Converts a view-px point to world px.
 * @param camera - the camera providing the mapping
 * @param p - the point in view px
 */
export function viewToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.scale + camera.pan.x, y: p.y / camera.scale + camera.pan.y };
}

/**
 * The felt wash quad in felt-local world px: the camera's view relative to the
 * felt origin, so the gradient wash covers the whole viewport.
 * @param s - the stage providing the felt origin
 * @param camera - the camera providing the view region
 */
export function washRect(s: Stage, camera: Camera): { x: number; y: number; w: number; h: number } {
  return { x: camera.pan.x - s.origin.x, y: camera.pan.y - s.origin.y, w: camera.view.w, h: camera.view.h };
}

/** External store for the camera: frame and event code read it outside React,
 *  while React components subscribe through useSyncExternalStore. */
export type CameraStore = {
  /** The current camera; stable reference until the next resize. */
  get(): Camera;
  /**
   * Re-fits the camera to a viewport, notifying subscribers on change.
   * @param viewport - canvas size in screen px
   * @param dpr - device pixel ratio scaling the clamp bounds
   */
  resize(viewport: Size, dpr: number): void;
  /**
   * Eases the camera's pan toward a zone anchor over successive frames; a
   * no-op when the whole world already fits the viewport.
   * @param zone - the zone to center on
   * @param dt - seconds since the last frame
   */
  panToward(zone: PanZone, dt: number): void;
  /** Subscribes to camera changes; returns the unsubscribe function.
   * @param listener - called after each camera change
   */
  subscribe(listener: () => void): () => void;
};

/**
 * Creates a camera store holding the degenerate pre-resize camera.
 * @returns the camera store to resize and read
 */
export function createCameraStore(): CameraStore {
  let camera = createCamera({ w: 0, h: 0 }, 1);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    get: () => camera,
    resize: (viewport, dpr) => {
      const next = createCamera(viewport, dpr);
      const changed =
        next.scale !== camera.scale ||
        next.pan.x !== camera.pan.x ||
        next.pan.y !== camera.pan.y ||
        next.view.w !== camera.view.w ||
        next.view.h !== camera.view.h;
      if (!changed) {
        return;
      }
      camera = next;
      notify();
    },
    panToward: (zone, dt) => {
      const overflow = worldSize.w - camera.view.w;
      if (overflow <= 0) {
        return;
      }
      const target = ZONE_ANCHOR[zone] * worldSize.w - camera.view.w / 2;
      const clamped = Math.max(0, Math.min(overflow, target));
      const remaining = clamped - camera.pan.x;
      if (Math.abs(remaining) < PAN_SNAP_PX) {
        if (camera.pan.x !== clamped) {
          camera = { ...camera, pan: { x: clamped, y: camera.pan.y } };
          notify();
        }
        return;
      }
      const eased = camera.pan.x + remaining * Math.min(1, PAN_EASE_PER_SECOND * dt);
      camera = { ...camera, pan: { x: eased, y: camera.pan.y } };
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
