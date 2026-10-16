import type { CSSProperties } from 'react';
import { formatChips } from '../snapshot';
import type { CardDto, PlayerSnapshot, Suit } from '../snapshot';

const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

const SUIT_SYMBOLS: Record<Suit, string> = {
  heart: '♥',
  club: '♣',
  spade: '♠',
  diamond: '♦',
};

const SUIT_COLORS: Record<Suit, string> = {
  heart: 'text-orange-strong',
  diamond: 'text-orange-strong',
  club: 'text-ink',
  spade: 'text-ink',
};

function rankChar(rank: number): string {
  return RANK_CHARS[rank - 2] ?? '?';
}

const CARD_SIZES = {
  sm: { frame: 'h-14 w-10 rounded-md', rank: 'text-xs', cornerSuit: 'text-[10px]', pip: 'text-lg' },
  lg: { frame: 'h-24 w-16 rounded-lg', rank: 'text-base', cornerSuit: 'text-xs', pip: 'text-3xl' },
} as const;

export function PlayingCard({
  card,
  size = 'sm',
  className,
  style,
}: {
  card: CardDto;
  size?: keyof typeof CARD_SIZES;
  className?: string;
  style?: CSSProperties;
}) {
  const sizeClasses = CARD_SIZES[size];
  const color = SUIT_COLORS[card.suit];

  // Corner index like a real card, so overlapping cards in a stack never
  // hide each other's rank/suit.
  const corner = (
    <span className={`flex flex-col items-center leading-none ${color}`}>
      <span className={`font-bold ${sizeClasses.rank}`}>{rankChar(card.rank)}</span>
      <span className={sizeClasses.cornerSuit}>{SUIT_SYMBOLS[card.suit]}</span>
    </span>
  );

  return (
    <div
      style={style}
      className={`relative flex items-center justify-center border border-line bg-raised shadow-md ${sizeClasses.frame} ${className ?? ''}`}
    >
      <span className="absolute top-1 left-1">{corner}</span>
      <span className={`leading-none ${sizeClasses.pip} ${color}`}>{SUIT_SYMBOLS[card.suit]}</span>
      <span className="absolute right-1 bottom-1 rotate-180">{corner}</span>
    </div>
  );
}

const STATUS_LABELS: Record<PlayerSnapshot['status'], string> = {
  active: 'Active',
  folded: 'Folded',
  'all-in': 'All-in',
};

const STATUS_CLASSES: Record<PlayerSnapshot['status'], string> = {
  active: 'bg-blue-tint text-blue-strong',
  folded: 'bg-raised text-muted',
  'all-in': 'bg-orange-tint text-orange-strong',
};

export function PlayerCard({
  player,
  isButton = false,
  isToAct = false,
}: {
  player: PlayerSnapshot;
  isButton?: boolean;
  isToAct?: boolean;
}) {
  const seat = player.seat;
  const dimmed = player.status === 'folded';

  return (
    <section
      className={`relative w-72 overflow-hidden rounded-2xl border bg-surface p-4 shadow-lg ${
        isToAct ? 'border-orange ring-2 ring-orange' : 'border-line'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-tint text-sm font-semibold text-blue-strong">
            {seat}
          </span>
          <h3 className="text-base text-ink">Player {seat}</h3>
        </div>
        <div className="flex items-center gap-2">
          {isButton && (
            <span
              title="Dealer button"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-xs font-bold text-ink"
            >
              D
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[player.status]}`}
          >
            {STATUS_LABELS[player.status]}
          </span>
        </div>
      </header>

      <dl className="mt-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Stack</dt>
          <dd className="font-heading text-2xl font-semibold tabular-nums text-ink">
            {formatChips(player.stack)}
          </dd>
        </div>
        <div className="mt-2 flex gap-5">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs uppercase tracking-wide text-muted">Bet</dt>
            <dd
              className={`text-sm font-semibold tabular-nums ${
                player.bet > 0n ? 'text-orange-strong' : 'text-ink'
              }`}
            >
              {formatChips(player.bet)}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-xs uppercase tracking-wide text-muted">Committed</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {formatChips(player.committed)}
            </dd>
          </div>
        </div>
      </dl>

      {/* Hole cards emerge from the bottom-right corner, nested in a small
          fan; the card's bottom edge clips them (overflow-hidden above).
          They overlap the card's lower-right area rather than adding height. */}
      {player.hole.length > 0 && (
        <div className="pointer-events-none absolute -bottom-6 right-3 flex items-end">
          {player.hole.map((card, i) => (
            <PlayingCard
              key={`${card.rank}-${card.suit}`}
              card={card}
              size="lg"
              className={i > 0 ? '-ml-8' : undefined}
              style={{ transform: `rotate(${i % 2 === 0 ? -8 : 8}deg)` }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
