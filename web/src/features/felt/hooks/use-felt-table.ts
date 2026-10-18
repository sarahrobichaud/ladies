import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasRenderLoop } from "../../../hooks/use-canvas-render-loop";
import type { Catalog } from "../../chips/types";
import type { Felt } from "../felt";
import { setFelt as resizeFelt } from "../felt";
import type { Size } from "../geom";
import { createPrimitiveRenderer, type PrimitiveRenderer } from "../renderer/renderer";
import { buildScene } from "../scene/build";
import { feltSize, stage, washRect } from "../stage";
import { type FeltStore, useFeltState } from "../store";
import { rpx } from "../world";
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
  const gestures = useFeltGestures({ store, canvasRef, stage });

  const rendererRef = useRef<PrimitiveRenderer | null>(null);
  const colorsRef = useSceneColors();
  const viewportRef = useRef<Size>({ w: 0, h: 0 });
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

  useCanvasRenderLoop(canvasRef, {
    onResize: (size) => {
      viewportRef.current = size;
      store.apply((f) => resizeFelt(f, feltSize(stage, size)));
    },
    draw: (time, dpr) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      try {
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
    const fonts = {
      chip: renderer.font(rpx(0.5), colors.bodyFont, "600", dpr),
      badge: renderer.font(rpx(0.54), colors.bodyFont, "600", dpr),
    };
    const viewport = viewportRef.current;
    if (viewport.w <= 0 || viewport.h <= 0) {
      emptyFramesRef.current += 1;
      if (emptyFramesRef.current > 60) {
        throw new Error(`viewport is ${viewport.w}x${viewport.h} — resize never ran`);
      }
      return;
    }
    emptyFramesRef.current = 0;
    const items = buildScene({
      felt: store.get(),
      surface: washRect(stage, viewport),
      handPos,
      drag,
      hover,
      lift,
      colors,
      time,
      fonts,
    });
    renderer.render(items, {
      viewport,
      stage,
      backdrop: { canvas: colors.canvasBg, felt: colors.felt },
    });
  };

  return { felt, store, gestures, canvasRef, glError };
}
