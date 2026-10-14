import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { WasmSession, wasmReady } from '../session';
import { setSession } from '../session-store';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;

export type SessionConfig = {
  players: number;
  chips: number;
  smallBlind: number;
  bigBlind: number;
};

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink focus:border-blue focus:ring-2 focus:ring-blue/30 focus:outline-none';

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
      <label className="block text-sm text-muted" htmlFor={id}>
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
  const [players, setPlayers] = useState(6);
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
    <section className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-lg">
      <h2 className="text-lg text-ink">Session setup</h2>

      <div className="mt-4">
        <label className="block text-sm text-muted" htmlFor="player-count">
          Players
        </label>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            aria-label="Remove player"
            className="h-9 w-9 rounded-md border border-line bg-raised text-lg text-ink hover:bg-blue-tint disabled:opacity-40"
            disabled={players <= MIN_PLAYERS}
            onClick={() => setPlayers((p) => clampPlayers(p - 1))}
          >
            −
          </button>
          <output
            id="player-count"
            className="w-10 text-center text-lg font-medium text-ink"
          >
            {players}
          </output>
          <button
            type="button"
            aria-label="Add player"
            className="h-9 w-9 rounded-md border border-line bg-raised text-lg text-ink hover:bg-blue-tint disabled:opacity-40"
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
        <p className="mt-1 text-xs text-muted">Big blind: {bigBlind}</p>
      </div>

      <button
        type="button"
        className="mt-5 w-full rounded-md bg-blue py-2 font-medium text-canvas hover:bg-blue-strong disabled:opacity-40"
        disabled={disabled}
        onClick={() => onStart({ players, chips, smallBlind, bigBlind })}
      >
        {disabled ? 'Loading engine…' : 'Start session'}
      </button>
      <Link
        to="/chips"
        className="mt-3 block text-center text-sm text-muted hover:text-orange"
      >
        Chip lab
      </Link>
    </section>
  );
}

export function ConfigPage() {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    wasmReady.then(() => setReady(true));
  }, []);

  const startSession = ({ players, chips, smallBlind, bigBlind }: SessionConfig) => {
    const stack = BigInt(chips);
    const stacks = new BigUint64Array(Array.from({ length: players }, () => stack));
    const session = new WasmSession(BigInt(smallBlind), BigInt(bigBlind), stacks);
    session.start_hand(1n);
    setSession(session);
    navigate('/table');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-8">
      <SessionConfigCard disabled={!ready} onStart={startSession} />
    </div>
  );
}
