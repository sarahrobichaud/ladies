import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { Chip } from "../features/chips/chip";
import type { HandSnapshot, PlayerSnapshot } from "../snapshot";
import { formatChips } from "../snapshot";
import type { ActionKind } from "./action-menu";
import { PlayingCard } from "./player-card";

// Gesture thresholds in px.
const FOLD_DISTANCE = 90;
const COMMIT_DISTANCE = 70;

// Palette tier for the all-in stack (the "black" chip).
const ALL_IN_TIER = 3;

type PendingChip = { id: number; value: bigint; tier: number };

type DragSeed =
  | { kind: "card"; index: number }
  | { kind: "chip"; index: number; value: bigint; tier: number }
  | { kind: "stack" }
  | { kind: "pending" };

type DragBase = { pointerId: number; startX: number; startY: number; dx: number; dy: number };

type Drag =
  | (DragBase & { kind: "card"; index: number })
  | (DragBase & { kind: "chip"; index: number; value: bigint; tier: number; overZone: boolean })
  | (DragBase & { kind: "stack"; overZone: boolean; committing: boolean })
  | (DragBase & { kind: "pending"; committing: boolean });

// What committing the chips currently on the line would do.
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

// Transform for a piece while it is / isn't being dragged.
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

  // Chip rack: denominations scaled to the blinds, filtered to what fits.
  const { small, big } = hand.blinds;
  const denoms = [small, big, big * 5n, big * 25n, big * 100n]
    .filter((v, i, all) => v > 0n && all.indexOf(v) === i && v <= player.stack)
    .sort((a, b) => (a < b ? -1 : 1))
    .slice(0, 5);

  // Chips built up on the betting line, in the order they were dropped.
  // Keyed to the turn (seat + street) they were built on, so a new turn
  // resets the line during render without an effect.
  const epoch = `${hand.to_act}:${hand.street}`;
  const [line, setLine] = useState<{ epoch: string; chips: PendingChip[] }>({
    epoch,
    chips: [],
  });
  const pending = line.epoch === epoch ? line.chips : [];
  const pendingTotal = pending.reduce((sum, c) => sum + c.value, 0n);

  const [drag, setDrag] = useState<Drag | null>(null);
  const zoneRef = useRef<HTMLButtonElement | null>(null);
  const nextChipId = useRef(1);

  const plan = commitPlan(pendingTotal, player, facingBet, callAmount, hand.min_raise);

  const inZone = (x: number, y: number): boolean => {
    const zone = zoneRef.current?.getBoundingClientRect();
    return !!zone && x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
  };

  const beginDrag = (e: ReactPointerEvent<HTMLElement>, seed: DragSeed) => {
    if (!live) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      ...seed,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      ...(seed.kind === "chip" || seed.kind === "stack" ? { overZone: false } : {}),
      ...(seed.kind === "stack" ? { committing: false } : {}),
      ...(seed.kind === "pending" ? { committing: false } : {}),
    } as Drag);
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    setDrag((d) => {
      if (!d || d.pointerId !== e.pointerId) {
        return d;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.kind === "card") {
        return { ...d, dx, dy };
      }
      const overZone = inZone(e.clientX, e.clientY);
      if (d.kind === "chip") {
        return { ...d, dx, dy, overZone };
      }
      if (d.kind === "stack") {
        return { ...d, dx, dy, overZone, committing: dy < -COMMIT_DISTANCE };
      }
      return { ...d, dx, dy, committing: dy < -COMMIT_DISTANCE };
    });
  };

  const cancelDrag = () => setDrag(null);

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }
    setDrag(null);

    if (drag.kind === "card") {
      if (drag.dy >= FOLD_DISTANCE) {
        onAct("fold");
      }
      return;
    }
    if (drag.kind === "chip" && drag.overZone) {
      const { value, tier } = drag;
      // Can't put more chips on the line than the stack holds.
      if (pendingTotal + value <= player.stack) {
        setLine({ epoch, chips: [...pending, { id: nextChipId.current++, value, tier }] });
      }
      return;
    }
    if (drag.kind === "stack") {
      if (drag.committing) {
        onAct("all-in");
      } else if (drag.overZone) {
        // Shoving replaces whatever is on the line: everything goes in.
        setLine({ epoch, chips: [{ id: nextChipId.current++, value: player.stack, tier: ALL_IN_TIER }] });
      }
      return;
    }
    if (drag.kind === "pending" && drag.committing && plan?.ok) {
      onAct(plan.kind, plan.raiseTo);
    }
  };

  const commit = () => {
    if (!plan?.ok) {
      return;
    }
    setLine({ epoch, chips: [] });
    onAct(plan.kind, plan.raiseTo);
  };

  const cardDrag = (i: number) => (drag?.kind === "card" && drag.index === i ? drag : null);
  const chipDrag = (i: number) => (drag?.kind === "chip" && drag.index === i ? drag : null);
  const stackDrag = drag?.kind === "stack" ? drag : null;
  const pendingDrag = drag?.kind === "pending" ? drag : null;

  const cardHandlers = (i: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(e, { kind: "card", index: i }),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  });
  const chipHandlers = (i: number, value: bigint, tier: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(e, { kind: "chip", index: i, value, tier }),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  });
  const stackHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(e, { kind: "stack" }),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  };
  const pendingHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => beginDrag(e, { kind: "pending" }),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  };

  const cardFolding = drag?.kind === "card" && drag.dy >= FOLD_DISTANCE;
  const stackCommitting = (drag?.kind === "pending" || drag?.kind === "stack") && drag.committing;

  const fallbackButton =
    "rounded-md border border-line bg-raised px-2 py-1.5 text-xs font-medium text-ink hover:bg-blue-tint disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid h-80 shrink-0 grid-cols-[1fr_18rem] gap-4">
      {/* ------------------------------------------------ POV strip (left) */}
      <section className="pov-felt relative overflow-hidden rounded-xl border border-line">
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

        {/* Commit band while dragging the line stack or the all-in stack */}
        {(drag?.kind === "pending" || drag?.kind === "stack") && (
          <div
            className={`absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-center border-b-2 border-dashed ${
              stackCommitting ? "border-blue bg-blue-tint/60" : "border-on-felt/40 bg-black/10"
            }`}
          >
            <span className={`text-sm font-semibold ${stackCommitting ? "text-blue-strong" : "text-on-felt/60"}`}>
              {stackCommitting ? "Release to commit" : "Drag up to commit"}
            </span>
          </div>
        )}

        {/* Fold band while dragging a hole card */}
        {drag?.kind === "card" && (
          <div
            className={`absolute inset-x-0 bottom-0 z-0 flex h-16 items-center justify-center border-t-2 border-dashed ${
              cardFolding ? "border-orange bg-orange-tint/60" : "border-on-felt/40 bg-black/10"
            }`}
          >
            <span className={`text-sm font-semibold ${cardFolding ? "text-orange-strong" : "text-on-felt/60"}`}>
              {cardFolding ? "Release to fold" : "Drag down to fold"}
            </span>
          </div>
        )}

        {/* Betting line: chip drop zone + check tap target */}
        <button
          type="button"
          ref={zoneRef}
          onClick={() => {
            if (live && !facingBet && pendingTotal === 0n) {
              onAct("check");
            }
          }}
          className={`absolute inset-x-16 top-[36%] z-10 flex h-24 items-center justify-center rounded-lg border-2 border-dashed px-3 ${
            drag?.kind === "chip" && drag.overZone ? "border-on-felt bg-white/15" : "border-on-felt/40"
          } ${live && !facingBet && pendingTotal === 0n ? "cursor-pointer" : ""}`}
        >
          {pending.length > 0 ? (
            <div
              className={`draggable cursor-grab${pendingDrag ? " cursor-grabbing" : ""}`}
              style={dragStyle(!!pendingDrag, pendingDrag?.dx ?? 0, pendingDrag?.dy ?? 0, "scale(1.05)")}
              {...pendingHandlers}
            >
              <div className="flex items-center">
                {pending.map((c, i) => (
                  <Chip key={c.id} value={c.value} tier={c.tier} size={36} className={i > 0 ? "-ml-3" : undefined} />
                ))}
              </div>
              <p className="mt-1 text-center text-sm font-bold tabular-nums text-on-felt">
                {formatChips(pendingTotal)}
              </p>
            </div>
          ) : (
            <span className="text-xs text-on-felt/50">
              {facingBet
                ? "Betting line — drop chips here to call or raise"
                : "Tap here to check · drop chips here to bet"}
            </span>
          )}
        </button>

        {/* Your side: chip rack (left) + hole cards (right) */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
          <div className="flex items-end gap-3">
            <div className="pb-1 text-right">
              <p className="text-[10px] uppercase tracking-wide text-on-felt/60">Stack</p>
              <p className="font-heading text-lg font-semibold tabular-nums text-on-felt">
                {formatChips(player.stack - pendingTotal)}
              </p>
            </div>

            <div className="flex items-end gap-2">
              {denoms.map((value, i) => {
                const d = chipDrag(i);
                return (
                  <div
                    key={value.toString()}
                    className={`draggable ${d ? "cursor-grabbing" : "cursor-grab"}`}
                    style={dragStyle(!!d, d?.dx ?? 0, d?.dy ?? 0, "scale(1.1)")}
                    {...chipHandlers(i, value, i)}
                  >
                    <Chip value={value} tier={i} size={44} />
                  </div>
                );
              })}

              {player.stack > 0n && (
                <div
                  className={`draggable flex flex-col items-center ${stackDrag ? "cursor-grabbing" : "cursor-grab"}`}
                  style={dragStyle(!!stackDrag, stackDrag?.dx ?? 0, stackDrag?.dy ?? 0)}
                  {...stackHandlers}
                >
                  <div className="flex flex-col items-center">
                    <Chip value={player.stack} tier={ALL_IN_TIER} size={40} />
                    <Chip value={player.stack} tier={ALL_IN_TIER} size={40} className="-mt-7" />
                    <Chip value={player.stack} tier={ALL_IN_TIER} size={40} className="-mt-7" />
                  </div>
                  <span className="mt-1 text-[10px] font-bold tracking-widest text-on-felt">ALL-IN</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-end gap-2">
            {player.hole.map((card, i) => {
              const d = cardDrag(i);
              return (
                <div
                  key={`${card.rank}-${card.suit}`}
                  className={`draggable ${d ? "cursor-grabbing" : "cursor-grab"}`}
                  style={dragStyle(!!d, d?.dx ?? 0, d?.dy ?? 0, `rotate(${(d?.dx ?? 0) * 0.06}deg) scale(1.05)`)}
                  {...cardHandlers(i)}
                >
                  <PlayingCard card={card} size="lg" />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Console (right) */}
      <aside className="flex w-72 shrink-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-lg">
        <header>
          <h2 className="text-lg text-ink">Your move</h2>
          <p className="text-sm text-muted">
            Player {hand.to_act} · {hand.street}
          </p>
        </header>

        <div className="mt-3 rounded-lg border border-line bg-raised p-3">
          {pendingTotal === 0n ? (
            <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
              <li>· Drag a chip onto the line to {facingBet ? "call or raise" : "bet"}</li>
              {!facingBet && <li>· Tap the line to check</li>}
              <li>· Drag your cards down off the felt to fold</li>
              <li>· Drag the tall stack in for all-in</li>
            </ul>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-muted">On the line</p>
              <p className="font-heading text-3xl font-semibold tabular-nums text-ink">{formatChips(pendingTotal)}</p>
              <p className="text-xs text-muted">
                {facingBet ? "Raise to" : "Bet"} {formatChips(player.bet + pendingTotal)}
                {facingBet && pendingTotal < callAmount
                  ? ` · ${formatChips(callAmount - pendingTotal)} short of a call`
                  : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md bg-blue px-3 py-2 text-sm font-medium text-canvas hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!plan?.ok}
                  onClick={commit}
                >
                  {plan?.ok ? plan.label : plan?.reason}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-blue-tint"
                  onClick={() => setLine({ epoch, chips: [] })}
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
