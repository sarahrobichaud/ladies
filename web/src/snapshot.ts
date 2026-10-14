// Shape of the plain object returned by `WasmSession.snapshot()`.
// Chips are u64 on the Rust side, so they arrive as BigInt.

export type Suit = 'heart' | 'club' | 'spade' | 'diamond';

export type CardDto = {
  rank: number; // 2..14 (Ace = 14)
  suit: Suit;
};

export type PlayerStatus = 'active' | 'folded' | 'all-in';

export type PlayerSnapshot = {
  stack: bigint;
  bet: bigint;
  committed: bigint;
  hole: [CardDto, CardDto];
  status: PlayerStatus;
  needs_action: boolean;
  can_raise: boolean;
};

export type HandSnapshot = {
  street: string;
  to_act: number;
  current_bet: bigint;
  min_raise: bigint;
  pot: bigint;
  board: CardDto[];
  button: number;
  players: PlayerSnapshot[];
};

export type SessionSnapshot = {
  stacks: BigUint64Array;
  hand: HandSnapshot | null;
};

export function formatChips(amount: bigint): string {
  return amount.toLocaleString();
}
