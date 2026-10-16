import { Chip } from "../../chips/chip";
import type { Catalog, KindId } from "../../chips/types";
import type { TrayHandlers } from "../hooks/use-felt-gestures";

type ChipTrayProps = {
  catalog: Catalog;
  /** Gesture handlers from useFeltGestures, one set per tray chip. */
  trayHandlers: (kind: KindId) => TrayHandlers;
};

/** The chip tray: one pressable/draggable chip per catalog kind. */
export function ChipTray({ catalog, trayHandlers }: ChipTrayProps) {
  return (
    <div className="flex w-36 shrink-0 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-lg">
      <p className="text-[10px] uppercase tracking-wide text-muted">Tray</p>
      {catalog.map((kind, kindId) => (
        <div key={kind.value.toString()} className="draggable cursor-grab self-start" {...trayHandlers(kindId)}>
          <Chip value={kind.value} tier={kind.tier} />
        </div>
      ))}
    </div>
  );
}
