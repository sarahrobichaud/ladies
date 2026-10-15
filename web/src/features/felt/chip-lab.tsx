import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Chip } from '../chips/chip';
import { CATALOG } from '../chips/catalog';
import { chipLabel, formatChips } from '../../snapshot';
import { parseRuns } from '../chips/notation';
import { coalesce } from '../chips/runs';
import type { Catalog, Run } from '../chips/types';
import { nearestFreeSlot } from './interaction';
import { allSlots } from './lattice';
import { STACK_CAPACITY, clearBoard, spawnStack, totalValue } from './felt';
import { useFelt } from './hooks/use-felt';
import { useFeltGestures } from './hooks/use-felt-gestures';
import { ChipTray } from './chip-tray';
import { FeltCanvas } from './felt-canvas';

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

export function ChipLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { felt, apply } = useFelt(CATALOG);
  const gestures = useFeltGestures({ felt, apply, canvasRef });
  const [notation, setNotation] = useState('');
  const [notationError, setNotationError] = useState<string | null>(null);

  const total = totalValue(felt);

  // Fill every lattice slot with a random stack — worst case for the
  // renderer (max stacks × max chips) and for pick/landing hit-testing.
  const stressTest = () => {
    apply((felt) => {
      let next = clearBoard(felt);
      const slots = allSlots(next.felt);
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (const slot of slots) next = spawnStack(next, randomRuns(next.catalog), slot);
      return next;
    });
    gestures.reset();
  };

  const addNotation = () => {
    try {
      const runs = parseRuns(notation, felt.catalog);
      const slot = nearestFreeSlot(felt, felt.felt.w / 2, felt.felt.h / 2);
      if (!slot) {
        setNotationError('the felt is full');
        return;
      }
      apply((f) => spawnStack(f, runs, slot));
      setNotation('');
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
          <p className="text-sm text-muted">
            Stacks are compressed entities — grab the top, split lower, wheel-size, combine on
            tops.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm tabular-nums text-muted">On the table: {formatChips(total)}</p>
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
            onClick={() => apply(clearBoard)}
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
        {felt.catalog.map((kind, kindId) => (
          <div key={kindId} className="flex flex-col items-center gap-1">
            <Chip value={kind.value} tier={kind.tier} />
            <span className="text-[10px] text-muted">{chipLabel(kind.value)}</span>
          </div>
        ))}
        <p className="ml-auto max-w-56 text-xs leading-relaxed text-muted">
          Press a tray chip to place one, or drag it straight onto the felt. Chips land on the
          slots — lower a stack onto another stack's top to combine; occupied slots are skipped,
          and dropping off the felt takes chips back. Right-click carries a whole stack; scroll
          while holding one to size it (max {STACK_CAPACITY}).
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <ChipTray catalog={felt.catalog} trayHandlers={gestures.trayHandlers} />
        <FeltCanvas
          felt={felt}
          apply={apply}
          canvasRef={canvasRef}
          gestures={gestures}
          className="min-h-0 flex-1"
          emptyLabel="Empty felt — add chips from the tray"
        />
      </div>
    </div>
  );
}
