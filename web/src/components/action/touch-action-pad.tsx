import { useCallback, useState } from "react";
import { formatChips } from "../../snapshot";
import { PlayingCard } from "../player-card";
import { actionContext, commitPlan, useEpochReset } from "./action-core";
import type { ActionSystemProps } from "./action-system";

const neutralButton =
  "rounded-md border border-line bg-raised px-4 py-2.5 text-sm font-medium text-ink hover:bg-blue-tint disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton =
  "rounded-md bg-blue px-4 py-2.5 text-sm font-medium text-canvas hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-40";
const allInButton =
  "rounded-md bg-orange px-4 py-2.5 text-sm font-medium text-canvas hover:bg-orange-strong disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The mobile action UI: hole cards, quick buttons, and a raise slider; the
 * felt is never constructed here, so touch devices pay nothing for WebGL.
 * @param props - the hand snapshot, engine error, and action sink
 */
export function TouchActionPad({ hand, error, onAct }: ActionSystemProps) {
  const ctx = actionContext(hand);
  const { player, live, facingBet, callAmount, minRaiseTo, maxRaiseTo } = ctx;
  const canRaise = player.can_raise && maxRaiseTo >= minRaiseTo;
  const suggested = minRaiseTo > maxRaiseTo ? maxRaiseTo : minRaiseTo;

  // The slider thinks in raise-to targets; the draft is keyed to the
  // suggestion it was made against so a new betting round resets it.
  const [draft, setDraft] = useState<{ key: bigint; target: bigint } | null>(null);
  const target = draft?.key === suggested ? draft.target : suggested;
  const setTarget = (value: bigint) => setDraft({ key: suggested, target: value });

  useEpochReset(
    hand,
    useCallback(() => setDraft(null), []),
  );

  const plan = commitPlan(target - player.bet, ctx);
  const commit = () => {
    if (!live || !plan?.ok) {
      return;
    }
    setDraft(null);
    onAct(plan.kind, plan.raiseTo);
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-lg">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg text-ink">Your move</h2>
        <p className="text-xs text-muted">
          Stack {formatChips(player.stack)} · {hand.street}
        </p>
      </header>

      <div className="mt-3 flex items-center justify-center gap-2">
        {player.hole.map((card) => (
          <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="sm" />
        ))}
      </div>

      {facingBet && <p className="mt-3 text-center text-sm text-muted">To call {formatChips(callAmount)}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className={neutralButton} disabled={!live} onClick={() => onAct("fold")}>
          Fold
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={!live}
          onClick={() => onAct(facingBet ? "call" : "check")}
        >
          {facingBet ? `Call ${formatChips(callAmount)}` : "Check"}
        </button>
      </div>

      {canRaise && (
        <div className="mt-4">
          <label className="block text-xs uppercase tracking-wide text-muted" htmlFor="raise-to">
            Raise to
          </label>
          <input
            id="raise-to"
            type="range"
            className="mt-2 w-full accent-blue"
            min={Number(minRaiseTo)}
            max={Number(maxRaiseTo)}
            step={Number(hand.blinds.big)}
            value={Number(target)}
            onChange={(e) => setTarget(BigInt(Math.floor(Number(e.target.value))))}
          />
          <div className="mt-1 flex items-center justify-between text-xs text-muted">
            <span>Min {formatChips(minRaiseTo)}</span>
            <span>Max {formatChips(maxRaiseTo)}</span>
          </div>
          <button type="button" className={`${primaryButton} mt-2 w-full`} disabled={!plan?.ok} onClick={commit}>
            {plan === null ? "Raise" : "label" in plan ? plan.label : plan.reason}
          </button>
        </div>
      )}

      <button type="button" className={`${allInButton} mt-3 w-full`} disabled={!live} onClick={() => onAct("all-in")}>
        All-in
      </button>

      {error && <p className="mt-2 text-xs text-orange-strong">{error}</p>}
    </section>
  );
}
