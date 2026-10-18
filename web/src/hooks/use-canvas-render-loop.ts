import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { useLatestRef } from "./use-latest-ref";

/** A width/height in CSS px. */
export type CanvasSize = { w: number; h: number };

/** Options for the canvas render loop. */
type Options = {
  /** Called when the canvas element's size changes; the bitmap catches up in the next draw. */
  onResize?: (size: CanvasSize, dpr: number) => void;
  /** Called every frame with the frame time (ms) and device pixel ratio. */
  draw: (time: number, dpr: number) => void;
};

/**
 * Canvas plumbing for a render loop: DPR-aware bitmap sizing and a
 * requestAnimationFrame loop. The bitmap is resized in the draw step, since
 * a resize clears it and the observer runs after rAF but before paint.
 * @param canvasRef - ref to the canvas element
 * @param options - resize callback and per-frame draw callback
 */
export function useCanvasRenderLoop(canvasRef: RefObject<HTMLCanvasElement | null>, options: Options) {
  const dprRef = useRef(1);
  const sizeRef = useRef<CanvasSize>({ w: 0, h: 0 });
  const optionsRef = useLatestRef(options);

  // Element size → pending bitmap size (DPR-aware); applied in the draw step.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
      dprRef.current = window.devicePixelRatio || 1;
      optionsRef.current.onResize?.(sizeRef.current, dprRef.current);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvasRef, optionsRef]);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      const el = canvasRef.current;
      if (el) {
        const { w, h } = sizeRef.current;
        const dpr = dprRef.current;
        const width = Math.max(1, Math.round(w * dpr));
        const height = Math.max(1, Math.round(h * dpr));
        // Assigning width/height clears the bitmap, so only touch them on a
        // real change.
        if (el.width !== width || el.height !== height) {
          el.width = width;
          el.height = height;
        }
      }
      optionsRef.current.draw(time, dprRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, optionsRef]);
}
