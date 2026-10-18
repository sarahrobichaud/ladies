import { useState } from "react";
import { Link } from "react-router";
import { CATALOG } from "../features/chips/catalog";
import { Chip } from "../features/chips/chip";
import { parseRuns } from "../features/chips/notation";
import { coalesce } from "../features/chips/runs";
import type { Catalog, Run } from "../features/chips/types";
import { ChipTray } from "../features/felt/components/chip-tray";
import { FeltCanvas } from "../features/felt/components/felt-canvas";
import {
  clearBoard,
  clearZone,
  STACK_CAPACITY,
  setLayout as setFeltLayout,
  spawnStack,
  totalValue,
} from "../features/felt/felt";
import type { FeltAction } from "../features/felt/hooks/use-felt-gestures";
import { useFeltTable } from "../features/felt/hooks/use-felt-table";
import { nearestFreeSlot } from "../features/felt/interaction";
import { allSlots } from "../features/felt/lattice";
import { FREE_LAYOUT, type ZoneSpec } from "../features/felt/zones";
import { chipLabel, formatChips } from "../snapshot";

// Poker layout: the whole lattice accepts stacks, with a staged bet zone near
// the top edge and its commit button one slot further along the same row.
const POKER_LAYOUT: readonly ZoneSpec[] = [
  { id: "free", purpose: "stack", slots: "all" },
  { id: "bet-0", purpose: "bet", slots: { cols: { from: 4, to: -4 }, rows: { from: 1, to: 2 } } },
  {
    id: "bet-button-0",
    purpose: "button",
    slots: { cols: { from: -3, to: -3 }, rows: { from: 2, to: 2 } },
    label: "BET",
    commits: "bet-0",
  },
];

// A random canonical stack: 1..STACK_CAPACITY chips split into runs of
// random denominations. coalesce merges adjacent same-kind runs.
function randomRuns(catalog: Catalog): Run[] {
  const total = 1 + Math.floor(Math.random() * STACK_CAPACITY);
  const runs: Run[] = [];
  let left = total;
  while (left > 0) {
    const count = 1 + Math.floor(Math.random() * left);
    const kind = Math.floor(Math.random() * catalog.length);
    runs.push({ kind, count });
    left -= count;
  }
  return coalesce(runs);
}

export function ChipLabPage() {
  const table = useFeltTable({ catalog: CATALOG, layout: POKER_LAYOUT });
  const { felt, store, gestures } = table;
  const [layoutName, setLayoutName] = useState<"free" | "poker">("poker");
  const [lastAction, setLastAction] = useState<string | null>(null);
  gestures.onAction = (action: FeltAction) => {
    if (action.type === "bet") {
      setLastAction(`Bet ${formatChips(action.value)} committed from ${action.zoneId}`);
      store.apply((f) => clearZone(f, action.zoneId));
    }
  };
  const [notation, setNotation] = useState("");
  const [notationError, setNotationError] = useState<string | null>(null);

  const toggleLayout = () => {
    const next = layoutName === "free" ? POKER_LAYOUT : FREE_LAYOUT;
    setLayoutName(layoutName === "free" ? "poker" : "free");
    store.apply((f) => setFeltLayout(f, next));
  };

  const total = totalValue(felt);

  // Fill every lattice slot with a random stack — worst case for the
  // renderer (max stacks × max chips) and for pick/landing hit-testing.
  const stressTest = () => {
    store.apply((felt) => {
      let next = clearBoard(felt);
      const slots = allSlots();
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (const slot of slots) {
        next = spawnStack(next, randomRuns(next.catalog), slot);
      }
      return next;
    });
    gestures.reset();
  };

  const addNotation = () => {
    try {
      const runs = parseRuns(notation, felt.catalog);
      const slot = nearestFreeSlot(felt, felt.felt.w / 2, felt.felt.h / 2);
      if (!slot) {
        setNotationError("the felt is full");
        return;
      }
      store.apply((f) => spawnStack(f, runs, slot));
      setNotation("");
      setNotationError(null);
    } catch (err) {
      setNotationError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-dvh flex-col gap-4 bg-canvas p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-ink">Chip lab</h1>
          <p className="text-sm text-muted">On the table: {formatChips(total)}</p>
        </div>
        <div className="flex items-center gap-3">
          {lastAction && <p className="text-xs text-blue-strong">{lastAction}</p>}
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={toggleLayout}
          >
            {layoutName === "free" ? "Poker layout" : "Free layout"}
          </button>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addNotation();
            }}
          >
            <input
              value={notation}
              onChange={(e) => setNotation(e.target.value)}
              placeholder="(500, 5), (25, 6)"
              className="w-44 rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink hover:bg-blue-tint"
            >
              Add
            </button>
          </form>
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={stressTest}
          >
            Stress test
          </button>
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-blue-tint"
            onClick={() => store.apply(clearBoard)}
          >
            Clear table
          </button>
          <Link to="/" className="text-sm text-orange hover:text-orange-strong">
            Back
          </Link>
        </div>
      </header>
      {notationError && <p className="text-xs text-orange-strong">{notationError}</p>}

      {/* Specimen strip: every palette tier, for component reference */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 shadow-lg">
        {felt.catalog.map((kind) => (
          <div key={kind.value.toString()} className="flex flex-col items-center gap-1">
            <Chip value={kind.value} tier={kind.tier} />
            <span className="text-[10px] text-muted">{chipLabel(kind.value)}</span>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <ChipTray catalog={felt.catalog} trayHandlers={gestures.trayHandlers} />
        <FeltCanvas table={table} className="min-h-0 flex-1" emptyLabel="Empty felt — add chips from the tray" />
      </div>
    </div>
  );
}
