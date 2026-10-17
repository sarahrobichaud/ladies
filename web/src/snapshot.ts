// Shape of the plain object returned by `WasmSession.snapshot()`.
// serde-wasm-bindgen emits u64 chips as plain numbers while they fit in a
// safe integer (BigInt only beyond that), so chip fields are normalized
// to BigInt at the boundary via `normalizeSnapshot`.

export type Suit = "heart" | "club" | "spade" | "diamond";

export type CardDto = {
  rank: number; // 2..14 (Ace = 14)
  suit: Suit;
};

export type PlayerStatus = "active" | "folded" | "all-in";

export type PlayerSnapshot = {
  seat: number;
  stack: bigint;
  bet: bigint;
  committed: bigint;
  hole: [CardDto, CardDto];
  status: PlayerStatus;
  needs_action: boolean;
  can_raise: boolean;
};

/** What the engine says the acting player may do; null when no action is required. */
export type ActionOptions = {
  can_check: boolean;
  call_amount: bigint;
  can_raise: boolean;
  min_raise_to: bigint;
  max_raise_to: bigint;
};

export type HandSnapshot = {
  blinds: { small: bigint; big: bigint };
  street: string;
  to_act: number;
  current_bet: bigint;
  pot: bigint;
  board: CardDto[];
  button: number;
  players: PlayerSnapshot[];
  options: ActionOptions | null;
};

export type SessionSnapshot = {
  stacks: (number | bigint)[];
  hand: HandSnapshot | null;
};

function chips(value: number | bigint): bigint {
  return BigInt(value);
}

export function normalizeSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const { hand } = snapshot;
  if (!hand) {
    return snapshot;
  }

  return {
    ...snapshot,
    hand: {
      ...hand,
      blinds: { small: chips(hand.blinds.small), big: chips(hand.blinds.big) },
      current_bet: chips(hand.current_bet),
      pot: chips(hand.pot),
      options: hand.options
        ? {
            ...hand.options,
            call_amount: chips(hand.options.call_amount),
            min_raise_to: chips(hand.options.min_raise_to),
            max_raise_to: chips(hand.options.max_raise_to),
          }
        : null,
      players: hand.players.map((p, seat) => ({
        ...p,
        seat,
        stack: chips(p.stack),
        bet: chips(p.bet),
        committed: chips(p.committed),
      })),
    },
  };
}

export function formatChips(amount: bigint): string {
  return amount.toLocaleString();
}

// Compact label for a chip face: full values don't fit on small discs.
export function chipLabel(value: bigint): string {
  if (value >= 1_000_000n) {
    return `${value / 1_000_000n}M`;
  }
  if (value >= 1_000n) {
    const k = Number(value) / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return value.toString();
}
