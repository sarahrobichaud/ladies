import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasRenderLoop } from "../../../hooks/use-canvas-render-loop";
import type { Catalog } from "../../chips/types";
import { type CameraStore, cameraPanAtTarget, createCameraStore, type PanZone, washRect } from "../camera";
import type { Felt } from "../felt";
import { setFelt } from "../felt";
import { createPrimitiveRenderer, type PrimitiveRenderer } from "../renderer/renderer";
import { buildScene } from "../scene/build";
import { stage } from "../stage";
import { type FeltStore, useFeltState } from "../store";
import { MAP_SIZE, rpx } from "../world";
import type { ZoneSpec } from "../zones";
import { useFeltStore } from "./use-felt";
import { type FeltGestures, useFeltGestures } from "./use-felt-gestures";
import { useSceneColors } from "./use-scene-colors";

/** Everything a felt screen needs: state, gestures, canvas wiring, health. */
export type FeltTable = {
  /** Current felt state, subscribed by the host component. */
  felt: Felt;
  /** Felt state store for applying ops. */
  store: FeltStore;
  /** Gesture controller bound to canvasRef. */
  gestures: FeltGestures;
  /** Ref for the canvas element; render into it via FeltCanvas. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Live camera store; frame code reads `get()`, React components subscribe. */
  camera: CameraStore;
  /** First GL failure (init or draw) as display text; null while healthy. */
  glError: string | null;
};

/**
 * Owns the felt store, gesture controller, renderer lifecycle, render loop,
 * and GL error policy for one canvas.
 * @param options - catalog and optional zone layout
 * @returns the felt table to render with FeltCanvas
 */
export function useFeltTable(options: { catalog: Catalog; layout?: readonly ZoneSpec[] }): FeltTable {
  const store = useFeltStore(options.catalog, options.layout);
  const felt = useFeltState(store);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camera = useCameraStore();
  const gestures = useFeltGestures({ store, canvasRef, stage, camera });
  // Camera pan target while a/s/d tweens toward a zone; null when settled.
  const panTargetRef = useRef<PanZone | null>(null);
  gestures.onPan = (zone) => {
    panTargetRef.current = zone;
  };

  const rendererRef = useRef<PrimitiveRenderer | null>(null);
  const colorsRef = useSceneColors();
  // First GL failure (init or draw), surfaced in the DOM until reloaded.
  const [glError, setGlError] = useState<string | null>(null);
  const reportedRef = useRef(false);
  // Frames drawn before the ResizeObserver's first callback; it fires after
  // the loop starts, so an empty viewport is normal for the first frames.
  const emptyFramesRef = useRef(0);
  const reportGlError = useCallback((message: string, err: unknown) => {
    console.error(`felt canvas: ${message}`, err);
    if (!reportedRef.current) {
      reportedRef.current = true;
      setGlError(`${message} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Renderer lifecycle: created once per canvas, disposed on unmount.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    let renderer: PrimitiveRenderer | null = null;
    try {
      renderer = createPrimitiveRenderer(el);
    } catch (err) {
      reportGlError("WebGL init failed", err);
    }
    rendererRef.current = renderer;
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [reportGlError]);

  // Native wheel handling lives on the gesture controller (React's wheel is
  // passive, so preventDefault needs a raw listener).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    return gestures.attach(el);
  }, [gestures]);

  // Last frame time, for the pan easing's dt.
  const lastFrameRef = useRef(0);

  useCanvasRenderLoop(canvasRef, {
    onResize: (size, dpr) => {
      camera.resize(size, dpr);
      // The felt is the fixed slot map; resizing only re-derives the camera.
      store.apply((f) => setFelt(f, MAP_SIZE));
    },
    draw: (time, dpr) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      try {
        if (panTargetRef.current) {
          const dt = lastFrameRef.current > 0 ? Math.min((time - lastFrameRef.current) / 1000, 0.1) : 0;
          camera.panToward(panTargetRef.current, dt);
          // The tween is done when the camera sits exactly on its target.
          if (cameraPanAtTarget(camera.get(), panTargetRef.current)) {
            panTargetRef.current = null;
          }
        }
        lastFrameRef.current = time;
        drawFrame(time, dpr, renderer);
      } catch (err) {
        reportGlError("draw failed", err);
      }
    },
  });

  // One frame of the felt scene, factored out so the render loop can catch
  // and surface GL failures without dying.
  const drawFrame = (time: number, dpr: number, renderer: PrimitiveRenderer) => {
    const colors = colorsRef.current;
    const { handPos, drag, hover } = gestures.frame();
    const lift = gestures.stepLift();
    const cam = camera.get();
    const fonts = {
      chip: renderer.font(rpx(0.5), colors.bodyFont, "600", dpr * cam.scale),
      badge: renderer.font(rpx(0.54), colors.bodyFont, "600", dpr * cam.scale),
    };
    const view = cam.view;
    if (view.w <= 0 || view.h <= 0) {
      emptyFramesRef.current += 1;
      if (emptyFramesRef.current > 60) {
        throw new Error(`viewport is ${view.w}x${view.h} — resize never ran`);
      }
      return;
    }
    emptyFramesRef.current = 0;
    const items = buildScene({
      felt: store.get(),
      surface: washRect(stage, cam),
      handPos,
      drag,
      hover,
      lift,
      colors,
      time,
      fonts,
    });
    renderer.render(items, {
      camera: cam,
      stage,
      backdrop: { canvas: colors.canvasBg, felt: colors.felt },
    });
  };

  return { felt, store, gestures, canvasRef, camera, glError };
}

/**
 * Owns one camera store for the component's lifetime.
 * @returns the camera store to resize and read
 */
function useCameraStore(): CameraStore {
  const [store] = useState(() => createCameraStore());
  return store;
}
