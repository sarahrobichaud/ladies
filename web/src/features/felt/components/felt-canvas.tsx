import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { useCanvasRenderLoop } from "../../../hooks/use-canvas-render-loop";
import { useLatestRef } from "../../../hooks/use-latest-ref";
import { type Felt, setFelt as resizeFelt } from "../felt";
import type { FeltGestures } from "../hooks/use-felt-gestures";
import { useSceneColors } from "../hooks/use-scene-colors";
import { createPrimitiveRenderer, type PrimitiveRenderer } from "../renderer/renderer";
import { buildScene } from "../renderer/scene";

type FeltCanvasProps = {
  felt: Felt;
  /** Stable dispatcher for the pure felt ops (from useFelt). */
  apply: (op: (felt: Felt) => Felt) => void;
  /** Ref for the canvas element; must be shared with useFeltGestures. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Gesture state machine from useFeltGestures, bound to the same canvasRef. */
  gestures: FeltGestures;
  className?: string;
  /** Shown when the felt holds no stacks and no hand. */
  emptyLabel?: string;
};

/**
 * The felt canvas block: a WebGL-rendered chip felt driven by felt state,
 * with pointer interactions handled by the injected gesture machine.
 * @param props - felt state, op dispatcher, canvas ref, gestures, and chrome
 */
export function FeltCanvas({ felt, apply, canvasRef, gestures, className, emptyLabel }: FeltCanvasProps) {
  const rendererRef = useRef<PrimitiveRenderer | null>(null);
  const colorsRef = useSceneColors();

  // Mirror the scene inputs for the rAF loop, so frames always read the
  // latest committed state.
  const sceneRef = useLatestRef({
    felt,
    handPos: gestures.handPos,
    drag: gestures.drag,
    hover: gestures.hover,
  });

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
      console.error("felt renderer: WebGL init failed", err);
    }
    rendererRef.current = renderer;
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [canvasRef]);

  useCanvasRenderLoop(canvasRef, {
    onResize: (size) => apply((f) => resizeFelt(f, size)),
    draw: (time, dpr) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      const scene = sceneRef.current;
      const colors = colorsRef.current;
      const lift = gestures.stepLift(scene.hover);
      const fonts = {
        chip: renderer.font(11, colors.bodyFont, "600", dpr),
        badge: renderer.font(12, colors.bodyFont, "600", dpr),
      };
      const items = buildScene({
        felt: scene.felt,
        handPos: scene.handPos,
        drag: scene.drag,
        hover: scene.hover,
        lift,
        colors,
        time,
        fonts,
      });
      renderer.render(items, scene.felt.felt.w, scene.felt.felt.h);
    },
  });

  return (
    <div className={`relative overflow-hidden rounded-xl border border-line${className ? ` ${className}` : ""}`}>
      <canvas
        ref={canvasRef}
        className="pov-felt absolute inset-0 h-full w-full"
        style={{
          cursor: gestures.drag ? "grabbing" : gestures.hover ? "grab" : "default",
          touchAction: "none",
        }}
        {...gestures.canvasHandlers}
      />
      {emptyLabel && felt.stacks.length === 0 && !felt.hand && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-on-felt/50">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}
