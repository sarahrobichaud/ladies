import type { CSSProperties } from "react";
import type { CardDto, PlayerSnapshot } from "../snapshot";
import { formatChips } from "../snapshot";
import { PlayerCard, PlayingCard } from "./player-card";

// Ellipse radii as a percentage of the table container's width/height.
// Different values are what make the table a "long circle".
const RADIUS_X = 41;
const RADIUS_Y = 37;

// Seats are distributed clockwise starting from the top. Heads-up overrides
// this so the two players face each other across the long axis instead of
// stacking at the top and bottom of the oval.
function seatAngle(seat: number, count: number): number {
  if (count === 2) {
    return seat === 0 ? 0 : 180;
  }
  return (seat / count) * 360 - 90;
}

// Shrink seats as the table fills up so cards don't collide at 8-9 players.
function seatScale(count: number): number {
  if (count <= 4) {
    return 1;
  }
  if (count <= 6) {
    return 0.85;
  }
  return 0.72;
}

export function PokerTable({
  players,
  button,
  toAct,
  board,
  pot,
}: {
  players: PlayerSnapshot[];
  button: number;
  toAct: number;
  board: CardDto[];
  pot: bigint;
}) {
  const count = players.length;

  return (
    <div className="relative mx-auto aspect-16/10 max-h-full w-full max-w-5xl">
      {/* Wood rail + stitched felt. The rail's padding leaves a visible
          wood border around the felt; the felt fills the content box. */}
      <div className="wood-rail absolute inset-x-[6%] inset-y-[12%] rounded-[50%] p-[clamp(10px,1.8vw,26px)]">
        <div className="table-felt h-full w-full rounded-[50%]" />
      </div>

      {/* Pot + board in the middle of the felt */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        {board.length > 0 && (
          <div className="flex gap-1.5">
            {board.map((card) => (
              <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="lg" />
            ))}
          </div>
        )}
        <p className="text-sm font-semibold text-on-felt">Pot {formatChips(pot)}</p>
      </div>

      {players.map((player) => {
        const seat = player.seat;
        const rad = (seatAngle(seat, count) * Math.PI) / 180;
        const style: CSSProperties = {
          left: `${50 + RADIUS_X * Math.cos(rad)}%`,
          top: `${50 + RADIUS_Y * Math.sin(rad)}%`,
          transform: `translate(-50%, -50%) scale(${seatScale(count)})`,
        };
        return (
          <div key={seat} style={style} className="absolute">
            <PlayerCard player={player} isButton={seat === button} isToAct={seat === toAct} />
          </div>
        );
      })}
    </div>
  );
}
