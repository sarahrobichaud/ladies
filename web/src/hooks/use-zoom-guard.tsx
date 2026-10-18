import { type ReactNode, useEffect, useState } from "react";

/** Supported browser zoom lower bound, as a fraction of 100% zoom. */
export const ZOOM_MIN = 0.75;

/** Supported browser zoom upper bound, as a fraction of 100% zoom. */
export const ZOOM_MAX = 1.5;

/** localStorage key holding the zoom reference; per-origin, like the browser's own zoom setting. */
const STORAGE_KEY = "zoom-guard:baseline";

/** The stored reference: the devicePixelRatio captured at 100% zoom, and the screen it belongs to. */
type Baseline = { dpr: number; screen: string };

/**
 * Identifies the current screen independently of its pixel ratio.
 * @returns the screen dimensions as a key string
 */
function screenKey(): string {
  return `${window.screen.width}x${window.screen.height}`;
}

/**
 * Reads the stored zoom reference when it exists and belongs to the current screen.
 * @returns the stored baseline, or null when absent or stale
 */
function readBaseline(): Baseline | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Baseline;
    if (parsed.screen === screenKey() && parsed.dpr > 0) {
      return parsed;
    }
  } catch {
    // Unreadable storage: fall through to a fresh capture.
  }
  return null;
}

/**
 * Persists the zoom reference for this origin and screen.
 * @param dpr - the devicePixelRatio to treat as 100% zoom
 */
function writeBaseline(dpr: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dpr, screen: screenKey() } satisfies Baseline));
  } catch {
    // Storage unavailable (privacy mode): the in-memory reference still holds.
  }
}

/**
 * Returns the devicePixelRatio to treat as 100% zoom.
 * @returns the baseline device pixel ratio
 */
function captureBaseline(): number {
  const current = window.devicePixelRatio || 1;
  const stored = readBaseline();
  if (stored) {
    return stored.dpr;
  }
  writeBaseline(current);
  return current;
}

// Module-level so remounts never reset the zoom reference.
let baseline: number | null = null;

/**
 * Captures the zoom reference at app startup, before any guard mounts.
 */
export function initZoomBaseline(): void {
  if (baseline === null) {
    baseline = captureBaseline();
  }
}

/**
 * Guards a page against unsupported browser zoom.
 * @returns the overlay to render, or null while zoom is supported
 */
export function useZoomGuard(): ReactNode {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (baseline === null) {
      baseline = captureBaseline();
    }
    const reference = baseline;
    const update = () => setZoom((window.devicePixelRatio || 1) / reference);
    update();
    // The resolution query fires exactly when devicePixelRatio changes; each
    // query is pinned to the ratio it was created for, so the listener removes
    // itself and re-arms on every change.
    let detach = () => {};
    const watch = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        mq.removeEventListener("change", onChange);
        update();
        watch();
      };
      mq.addEventListener("change", onChange);
      detach = () => mq.removeEventListener("change", onChange);
    };
    watch();
    return () => detach();
  }, []);

  if (zoom >= ZOOM_MIN && zoom <= ZOOM_MAX) {
    return null;
  }
  const tooLow = zoom < ZOOM_MIN;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
      <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-lg">
        <p className="font-heading text-lg font-semibold text-ink">Browser zoom unsupported</p>
        <p className="mt-1 max-w-xs text-sm text-muted">
          Zoom is too {tooLow ? "low" : "high"}. Set it {tooLow ? "higher" : "lower"} to continue.
        </p>
      </div>
    </div>
  );
}
