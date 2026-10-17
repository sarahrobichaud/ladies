import type { CSSProperties, ReactNode } from "react";
import { useFeltCursor } from "../hooks/use-felt-gestures";
import type { FeltTable } from "../hooks/use-felt-table";
import { stage } from "../stage";

/** Where the felt surface, and overlays anchored to it, sit in the container. */
const FELT_RECT_STYLE: CSSProperties = {
  top: stage.inset.top,
  right: stage.inset.x,
  bottom: stage.inset.bottom,
  left: stage.inset.x,
};

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
 * is the full viewport; the felt surface is an inset region of it, rendered
 * in GL with a double-layer fade (the felt dissolves before the chips riding
 * on it do), so stacks rise off the felt without a hard cut.
 * @param props - the felt table plus chrome and overlays
 */
export function FeltCanvas({ table, className, emptyLabel, children }: FeltCanvasProps) {
  const { felt, gestures, canvasRef, glError } = table;
  const cursor = useFeltCursor(gestures);

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
