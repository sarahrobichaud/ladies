import type { CSSProperties, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasRenderLoop } from "../../../hooks/use-canvas-render-loop";
import { CHIP_SIZE } from "../../chips/chip";
import { setFelt as resizeFelt } from "../felt";
import type { Size } from "../geom";
import { type FeltGestures, useFeltCursor } from "../hooks/use-felt-gestures";
import { useSceneColors } from "../hooks/use-scene-colors";
import { createPrimitiveRenderer, type PrimitiveRenderer } from "../renderer/renderer";
import { buildScene } from "../renderer/scene";
import { feltSize, stage, washRect } from "../stage";
import { type FeltStore, useFeltState } from "../store";

/** Where the felt surface, and overlays anchored to it, sit in the container. */
const FELT_RECT_STYLE: CSSProperties = {
  top: stage.inset.top,
  right: stage.inset.x,
  bottom: stage.inset.bottom,
  left: stage.inset.x,
};

type FeltCanvasProps = {
  /** Felt state store; the render loop reads it directly, overlays subscribe. */
  store: FeltStore;
  /** Ref for the canvas element; must be shared with the gesture controller. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Gesture controller bound to the same canvasRef. */
  gestures: FeltGestures;
  className?: string;
  /** Shown when the felt holds no stacks and no hand. */
  emptyLabel?: string;
  /** DOM chrome rendered above the canvas (trays, cards, readouts). */
  children?: ReactNode;
};

/**
 * The felt canvas block: a WebGL-rendered chip felt driven by the felt store,
 * with pointer interactions handled by the injected gesture controller. The
 * canvas is the full viewport; the felt surface is an inset region of it,
 * rendered in GL with a double-layer fade (the felt dissolves before the
 * chips riding on it do), so stacks rise off the felt without a hard cut.
 * @param props - felt store, canvas ref, gestures, chrome, and overlays
 */
export function FeltCanvas({ store, canvasRef, gestures, className, emptyLabel, children }: FeltCanvasProps) {
  const felt = useFeltState(store);
  const cursor = useFeltCursor(gestures);
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
  }, [canvasRef, reportGlError]);

  // Native wheel handling lives on the gesture controller (React's wheel is
  // passive, so preventDefault needs a raw listener).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    return gestures.attach(el);
  }, [gestures, canvasRef]);

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
      chip: renderer.font(Math.round(CHIP_SIZE * 0.25), colors.bodyFont, "600", dpr),
      badge: renderer.font(Math.round(CHIP_SIZE * 0.27), colors.bodyFont, "600", dpr),
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
    renderer.render(items, viewport.w, viewport.h, {
      origin: stage.origin,
      feltFade: stage.feltFade,
      sceneFade: stage.sceneFade,
      canvasColor: colors.canvasBg,
      feltColor: colors.felt,
    });
  };

  return (
    <div className={`relative${className ? ` ${className}` : ""}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          cursor,
          touchAction: "none",
        }}
        {...gestures.canvasHandlers}
      />
      {glError && (
        <p className="pointer-events-none absolute left-2 top-2 z-20 max-w-md font-mono text-[10px] leading-tight text-orange-strong">
          {glError}
        </p>
      )}
      {emptyLabel && felt.stacks.length === 0 && !felt.hand && (
        <p
          className="pointer-events-none absolute flex items-center justify-center text-sm text-on-felt/50"
          style={FELT_RECT_STYLE}
        >
          {emptyLabel}
        </p>
      )}
      {children}
    </div>
  );
}
