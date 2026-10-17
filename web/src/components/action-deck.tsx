import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CHIP_SIZE, Chip } from "../features/chips/chip";
import type { Catalog } from "../features/chips/types";
import { FeltCanvas } from "../features/felt/components/felt-canvas";
import { clearZone, zoneStackValue } from "../features/felt/felt";
import { useFelt } from "../features/felt/hooks/use-felt";
import { useFeltGestures } from "../features/felt/hooks/use-felt-gestures";
import { stage } from "../features/felt/stage";
import type { ZoneSpec } from "../features/felt/zones";
import type { HandSnapshot, PlayerSnapshot } from "../snapshot";
import { formatChips } from "../snapshot";
import type { ActionKind } from "./action-menu";
import { PlayingCard } from "./player-card";

// Gesture threshold in px.
const FOLD_DISTANCE = 90;

// The betting line: the only placeable band of slots on the table felt.
const BET_ZONE_ID = "bet";
const TABLE_LAYOUT: readonly ZoneSpec[] = [
  { id: "free", purpose: "stack", slots: "all" },
  { id: BET_ZONE_ID, purpose: "bet", slots: { cols: { from: 2, to: -3 }, rows: { from: 1, to: 2 } } },
];

// What committing the chips currently staged on the line would do.
type Plan = { ok: true; kind: ActionKind; raiseTo?: bigint; label: string } | { ok: false; reason: string };

function commitPlan(
  total: bigint,
  player: PlayerSnapshot,
  facingBet: boolean,
  callAmount: bigint,
  minRaiseTo: bigint,
): Plan | null {
  if (total === 0n) {
    return null;
  }

  const target = player.bet + total;
  const maxTo = player.bet + player.stack;

  // Everything went in: let the engine decide call/raise/all-in.
  if (target >= maxTo) {
    return { ok: true, kind: "all-in", label: `All-in ${formatChips(maxTo)}` };
  }
  if (facingBet && total < callAmount) {
    return { ok: false, reason: `${formatChips(callAmount - total)} short of a call` };
  }
  if (facingBet && total === callAmount) {
    return { ok: true, kind: "call", label: `Call ${formatChips(callAmount)}` };
  }
  if (target < minRaiseTo) {
    return { ok: false, reason: `Min is ${formatChips(minRaiseTo)}` };
  }
  if (!player.can_raise) {
    return { ok: false, reason: "Betting was not reopened" };
  }
  return {
    ok: true,
    kind: "raise",
    raiseTo: target,
    label: `${facingBet ? "Raise to" : "Bet"} ${formatChips(target)}`,
  };
}

// Transform for a hole card while it is / isn't being dragged.
function dragStyle(active: boolean, dx: number, dy: number, extra = ""): CSSProperties {
  if (active) {
    return {
      transform: `translate(${dx}px, ${dy}px)${extra ? ` ${extra}` : ""}`,
      transition: "none",
      position: "relative",
      zIndex: 50,
    };
  }
  return { transition: "transform 160ms ease" };
}

// Chip denominations scaled to the blinds, one palette tier per denomination.
function blindsCatalog({ small, big }: { small: bigint; big: bigint }): Catalog {
  return [small, big, big * 5n, big * 25n, big * 100n]
    .filter((value, i, all) => value > 0n && all.indexOf(value) === i)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((value, tier) => ({ value, tier }));
}

// Hole-card fold gesture: grab a card, drag it down, release to fold.
type CardDrag = { pointerId: number; startX: number; startY: number; dx: number; dy: number; index: number };

export function ActionDeck({
  hand,
  error,
  onAct,
}: {
  hand: HandSnapshot;
  error: string | null;
  onAct: (kind: ActionKind, raiseTo?: bigint) => void;
}) {
  const player = hand.players[hand.to_act];
  const live = player.needs_action && hand.street !== "complete" && hand.street !== "showdown";
  const facingBet = hand.current_bet > player.bet;
  const callAmount = facingBet ? hand.current_bet - player.bet : 0n;

  // The table felt: chips staged on the betting line are the wager. The
  // catalog is scaled to the blinds so the tray holds usable denominations.
  const { small, big } = hand.blinds;
  const catalog = useMemo(() => blindsCatalog({ small, big }), [small, big]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { felt, apply } = useFelt(catalog, TABLE_LAYOUT);
  const gestures = useFeltGestures({ felt, apply, canvasRef, stage });

  const staged = zoneStackValue(felt, BET_ZONE_ID);
  const plan = commitPlan(staged, player, facingBet, callAmount, hand.min_raise);
  const commitLabel = plan === null ? null : "label" in plan ? plan.label : plan.reason;

  // The line resets when the turn passes on or the street turns.
  const epoch = `${hand.to_act}:${hand.street}`;
  const [feltEpoch, setFeltEpoch] = useState(epoch);
  useEffect(() => {
    if (feltEpoch === epoch) {
      return;
    }
    setFeltEpoch(epoch);
    apply((f) => clearZone(f, BET_ZONE_ID));
  }, [epoch, feltEpoch, apply]);

  const commit = () => {
    if (!live || !plan?.ok) {
      return;
    }
    apply((f) => clearZone(f, BET_ZONE_ID));
    onAct(plan.kind, plan.raiseTo);
  };

  const [cardDrag, setCardDrag] = useState<CardDrag | null>(null);

  const beginCardDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (!live) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setCardDrag({ pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, index });
  };
  const moveCardDrag = (e: ReactPointerEvent<Element>) => {
    setCardDrag((d) =>
      d && d.pointerId === e.pointerId ? { ...d, dx: e.clientX - d.startX, dy: e.clientY - d.startY } : d,
    );
  };
  const endCardDrag = (e: ReactPointerEvent<Element>) => {
    const d = cardDrag;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    setCardDrag(null);
    if (d.dy >= FOLD_DISTANCE) {
      onAct("fold");
    }
  };

  const cardHandlers = (i: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginCardDrag(e, i),
    onPointerMove: moveCardDrag,
    onPointerUp: endCardDrag,
    onPointerCancel: () => setCardDrag(null),
  });

  const cardFolding = cardDrag !== null && cardDrag.dy >= FOLD_DISTANCE;
  const cardDragAt = (i: number) => (cardDrag?.index === i ? cardDrag : null);

  const fallbackButton =
    "rounded-md border border-line bg-raised px-2 py-1.5 text-xs font-medium text-ink hover:bg-blue-tint disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid h-[50dvh] shrink-0 grid-cols-[1fr_18rem] gap-4">
      {/* ------------------------------------------------ POV felt (left) */}
      <FeltCanvas felt={felt} apply={apply} canvasRef={canvasRef} gestures={gestures} className="min-h-0">
        {/* Facing bet / state readout at the far edge of the felt */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center gap-1 pt-2">
          {facingBet ? (
            <>
              <Chip value={hand.current_bet} tier={2} size={30} />
              <p className="text-xs font-medium text-on-felt/85">To call {formatChips(callAmount)}</p>
            </>
          ) : (
            <p className="text-xs text-on-felt/60">{live ? "No bet to you" : "Waiting…"}</p>
          )}
        </div>

        {/* Fold band while dragging a hole card */}
        {cardDrag && (
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-0 flex h-16 items-center justify-center border-t-2 border-dashed ${
              cardFolding ? "border-orange bg-orange-tint/60" : "border-on-felt/40 bg-black/10"
            }`}
          >
            <span className={`text-sm font-semibold ${cardFolding ? "text-orange-strong" : "text-on-felt/60"}`}>
              {cardFolding ? "Release to fold" : "Drag down to fold"}
            </span>
          </div>
        )}

        {/* Your side: chip tray (left) + hole cards (right) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
          <div className="flex items-end gap-3">
            <div className="pb-1 text-right">
              <p className="text-[10px] uppercase tracking-wide text-on-felt/60">Stack</p>
              <p className="font-heading text-lg font-semibold tabular-nums text-on-felt">
                {formatChips(player.stack - staged > 0n ? player.stack - staged : 0n)}
              </p>
            </div>

            <div className="flex items-end gap-2">
              {catalog.map((kind, kindId) => (
                <div
                  key={kind.value.toString()}
                  className={`draggable pointer-events-auto ${live ? "cursor-grab" : "cursor-default"}`}
                  {...(live ? gestures.trayHandlers(kindId) : {})}
                >
                  <Chip value={kind.value} tier={kind.tier} size={CHIP_SIZE} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2">
            {player.hole.map((card, i) => {
              const d = cardDragAt(i);
              return (
                <div
                  key={`${card.rank}-${card.suit}`}
                  className={`draggable pointer-events-auto ${d ? "cursor-grabbing" : "cursor-grab"}`}
                  style={dragStyle(!!d, d?.dx ?? 0, d?.dy ?? 0, `rotate(${(d?.dx ?? 0) * 0.06}deg) scale(1.05)`)}
                  {...cardHandlers(i)}
                >
                  <PlayingCard card={card} size="lg" />
                </div>
              );
            })}
          </div>
        </div>
      </FeltCanvas>

      {/* ------------------------------------------------ Console (right) */}
      <aside className="flex w-72 shrink-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-lg">
        <header>
          <h2 className="text-lg text-ink">Your move</h2>
          <p className="text-sm text-muted">
            Player {hand.to_act} · {hand.street}
          </p>
        </header>

        <div className="mt-3 rounded-lg border border-line bg-raised p-3">
          {staged === 0n ? (
            <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
              <li>· Drag a chip from the tray onto the line to {facingBet ? "call or raise" : "bet"}</li>
              <li>· Pick chips off the line and drop them off the felt to take them back</li>
              <li>· Drag your cards down off the felt to fold</li>
            </ul>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-muted">On the line</p>
              <p className="font-heading text-3xl font-semibold tabular-nums text-ink">{formatChips(staged)}</p>
              <p className="text-xs text-muted">
                {facingBet ? "Raise to" : "Bet"} {formatChips(player.bet + staged)}
                {facingBet && staged < callAmount
                  ? ` · ${formatChips(callAmount - staged)} short of a call`
                  : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md bg-blue px-3 py-2 text-sm font-medium text-canvas hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!plan?.ok}
                  onClick={commit}
                >
                  {commitLabel}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-blue-tint"
                  onClick={() => apply((f) => clearZone(f, BET_ZONE_ID))}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-auto pt-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Buttons</p>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            <button type="button" className={fallbackButton} disabled={!live} onClick={() => onAct("fold")}>
              Fold
            </button>
            <button
              type="button"
              className={fallbackButton}
              disabled={!live}
              onClick={() => onAct(facingBet ? "call" : "check")}
            >
              {facingBet ? "Call" : "Check"}
            </button>
            <button type="button" className={fallbackButton} disabled={!live} onClick={() => onAct("all-in")}>
              All-in
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-orange-strong">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
