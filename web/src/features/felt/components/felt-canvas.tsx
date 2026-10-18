import type { CSSProperties, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { worldToView } from "../camera";
import { useFeltCursor } from "../hooks/use-felt-gestures";
import type { FeltTable } from "../hooks/use-felt-table";
import { stage } from "../stage";
import { MAP_SIZE } from "../world";

type FeltCanvasProps = {
  /** The felt table owning the store, gestures, and render loop. */
  table: FeltTable;
  className?: string;
  /** Shown when the felt holds no stacks and no hand. */
  emptyLabel?: string;
  /** DOM chrome rendered above the canvas (trays, cards, readouts). */
  children?: ReactNode;
};

/**
 * The felt canvas block: a presentational shell over a FeltTable. The canvas
 * is the full viewport; the felt surface is the camera's view of the fixed
 * map, rendered in GL with a double-layer fade (the felt dissolves before the
 * chips riding on it do), so stacks rise off the felt without a hard cut.
 * @param props - the felt table plus chrome and overlays
 */
export function FeltCanvas({ table, className, emptyLabel, children }: FeltCanvasProps) {
  const { felt, gestures, canvasRef, camera, glError } = table;
  const cursor = useFeltCursor(gestures);
  const cam = useSyncExternalStore(camera.subscribe, camera.get);

  // The felt rect in screen px: the world-px map rect through the camera.
  const feltOrigin = worldToView(cam, stage.origin);
  const feltRectStyle: CSSProperties = {
    top: feltOrigin.y,
    left: feltOrigin.x,
    width: MAP_SIZE.w * cam.scale,
    height: MAP_SIZE.h * cam.scale,
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
          style={feltRectStyle}
        >
          {emptyLabel}
        </p>
      )}
      {children}
    </div>
  );
}
