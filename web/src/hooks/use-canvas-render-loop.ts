import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useLatestRef } from './use-latest-ref';

/** A width/height in CSS px. */
export type CanvasSize = { w: number; h: number };

/** Options for the canvas render loop. */
type Options = {
  /** Called when the canvas is resized, after the bitmap is updated. */
  onResize?: (size: CanvasSize, dpr: number) => void;
  /** Called every frame with the frame time (ms) and device pixel ratio. */
  draw: (time: number, dpr: number) => void;
};

/**
 * Canvas plumbing for a render loop: DPR-aware bitmap sizing and a
 * requestAnimationFrame loop. Options are read through a ref, so the loop
 * and the resize observer always see the latest committed callbacks without
 * being torn down.
 * @param canvasRef - ref to the canvas element
 * @param options - resize callback and per-frame draw callback
 */
export function useCanvasRenderLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: Options,
) {
  const dprRef = useRef(1);
  const optionsRef = useLatestRef(options);

  // Size → canvas bitmap (DPR-aware).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = { w: entry.contentRect.width, h: entry.contentRect.height };
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(size.w * dpr));
      el.height = Math.max(1, Math.round(size.h * dpr));
      dprRef.current = dpr;
      optionsRef.current.onResize?.(size, dpr);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvasRef, optionsRef]);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      optionsRef.current.draw(time, dprRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [optionsRef]);
}
