import { useEffect, useState } from 'react';
import { WasmSession, wasmReady } from './session';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;

type Snapshot = Record<string, unknown>;

type SessionConfig = {
  players: number;
  chips: number;
  smallBlind: number;
  bigBlind: number;
};

const inputClass =
  'mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 focus:border-emerald-500 focus:outline-none';

// Parse a draft text field into a positive integer, or null while the input
// is empty/partial so typing isn't fought by clamping.
function parseCount(text: string): number | null {
  const value = Math.floor(Number(text));
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function NumberField({
  id,
  label,
  text,
  min,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  text: string;
  min: number;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="block text-sm text-zinc-400" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        className={inputClass}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

function SessionConfigCard({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: (config: SessionConfig) => void;
}) {
  const [players, setPlayers] = useState(3);
  // Draft text (what the user sees) plus last valid values (what we submit).
  const [chipsText, setChipsText] = useState('5000');
  const [smallText, setSmallText] = useState('100');
  const [chips, setChips] = useState(5000);
  const [smallBlind, setSmallBlind] = useState(100);
  const bigBlind = smallBlind * 2;

  const clampPlayers = (value: number) =>
    Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, value));

  const updateChips = (text: string) => {
    setChipsText(text);
    const parsed = parseCount(text);
    if (parsed !== null) setChips(parsed);
  };

  const updateSmall = (text: string) => {
    setSmallText(text);
    const parsed = parseCount(text);
    if (parsed !== null) setSmallBlind(parsed);
  };

  return (
    <section className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg">
      <h2 className="text-lg font-semibold text-zinc-100">Session setup</h2>

      <div className="mt-4">
        <label className="block text-sm text-zinc-400" htmlFor="player-count">
          Players
        </label>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            aria-label="Remove player"
            className="h-9 w-9 rounded-md bg-zinc-800 text-lg text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            disabled={players <= MIN_PLAYERS}
            onClick={() => setPlayers((p) => clampPlayers(p - 1))}
          >
            −
          </button>
          <output
            id="player-count"
            className="w-10 text-center text-lg font-medium text-zinc-100"
          >
            {players}
          </output>
          <button
            type="button"
            aria-label="Add player"
            className="h-9 w-9 rounded-md bg-zinc-800 text-lg text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            disabled={players >= MAX_PLAYERS}
            onClick={() => setPlayers((p) => clampPlayers(p + 1))}
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4">
        <NumberField
          id="starting-chips"
          label="Starting chips"
          text={chipsText}
          min={1}
          onChange={updateChips}
          onBlur={() => setChipsText(String(chips))}
        />
      </div>

      <div className="mt-4">
        <NumberField
          id="small-blind"
          label="Small blind"
          text={smallText}
          min={1}
          onChange={updateSmall}
          onBlur={() => setSmallText(String(smallBlind))}
        />
        <p className="mt-1 text-xs text-zinc-500">Big blind: {bigBlind}</p>
      </div>

      <button
        type="button"
        className="mt-5 w-full rounded-md bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        disabled={disabled}
        onClick={() => onStart({ players, chips, smallBlind, bigBlind })}
      >
        {disabled ? 'Loading engine…' : 'Start session'}
      </button>
    </section>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    wasmReady.then(() => setReady(true));
  }, []);

  const startSession = ({ players, chips, smallBlind, bigBlind }: SessionConfig) => {
    const stack = BigInt(chips);
    const stacks = new BigUint64Array(Array.from({ length: players }, () => stack));
    const session = new WasmSession(BigInt(smallBlind), BigInt(bigBlind), stacks);
    session.start_hand(1n);
    setSnap(session.snapshot() as Snapshot);
  };

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-zinc-950 p-8">
      <SessionConfigCard disabled={!ready} onStart={startSession} />
      {snap && <pre className="text-xs text-zinc-300">{JSON.stringify(snap, null, 2)}</pre>}
    </div>
  );
}
