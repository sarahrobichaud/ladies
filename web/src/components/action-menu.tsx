import { useState } from "react";
import type { HandSnapshot } from "../snapshot";
import { formatChips } from "../snapshot";

export type ActionKind = "fold" | "check" | "call" | "raise" | "all-in";

const neutralButton =
  "rounded-md border border-line bg-raised px-4 py-2 text-sm font-medium text-ink hover:bg-blue-tint disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton =
  "rounded-md bg-blue px-4 py-2 text-sm font-medium text-canvas hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-40";

// Parse a chip amount from draft text, or null while empty/partial.
function parseChips(text: string): bigint | null {
  const value = Math.floor(Number(text));
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

export function ActionMenu({
  hand,
  error,
  onAct,
}: {
  hand: HandSnapshot;
  error: string | null;
  onAct: (kind: ActionKind, raiseTo?: bigint) => void;
}) {
  const player = hand.players[hand.to_act];
  const facingBet = hand.current_bet > player.bet;
  const callAmount = facingBet ? hand.current_bet - player.bet : 0n;
  // `min_raise` is the minimum total raise-to level, not an increment.
  const minRaiseTo = hand.min_raise;
  const maxRaiseTo = player.stack + player.bet;
  const canRaise = player.can_raise && maxRaiseTo >= minRaiseTo;
  const suggested = minRaiseTo > maxRaiseTo ? maxRaiseTo : minRaiseTo;

  // Track the current bet so the suggested raise stays sensible as the
  // hand progresses: the draft is keyed to the suggestion it was typed
  // against, so a new betting round resets the field without an effect.
  const [raiseDraft, setRaiseDraft] = useState<{ key: bigint; text: string } | null>(null);
  const raiseText = raiseDraft?.key === suggested ? raiseDraft.text : suggested.toString();
  const setRaiseText = (text: string) => setRaiseDraft({ key: suggested, text });

  const raiseTo = parseChips(raiseText);
  const raiseLegal = raiseTo !== null && raiseTo >= minRaiseTo && raiseTo <= maxRaiseTo;

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-lg">
      <h2 className="text-lg text-ink">Action</h2>
      <p className="mt-1 text-sm text-muted">
        Player {hand.to_act} to act · {hand.street}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={neutralButton} onClick={() => onAct("fold")}>
          Fold
        </button>
        {facingBet ? (
          <button type="button" className={primaryButton} onClick={() => onAct("call")}>
            Call {formatChips(callAmount)}
          </button>
        ) : (
          <button type="button" className={neutralButton} onClick={() => onAct("check")}>
            Check
          </button>
        )}
      </div>

      {canRaise && (
        <div className="mt-4">
          <label className="block text-sm text-muted" htmlFor="raise-to">
            Raise to
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="raise-to"
              type="number"
              className="w-full rounded-md border border-line bg-raised px-3 py-2 text-ink focus:border-blue focus:ring-2 focus:ring-blue/30 focus:outline-none"
              value={raiseText}
              onChange={(e) => setRaiseText(e.target.value)}
            />
            <button
              type="button"
              className={primaryButton}
              disabled={!raiseLegal}
              onClick={() => raiseLegal && onAct("raise", raiseTo)}
            >
              Raise
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            Min {formatChips(minRaiseTo)} · Max {formatChips(maxRaiseTo)}
          </p>
        </div>
      )}

      <button
        type="button"
        className="mt-4 w-full rounded-md bg-orange px-4 py-2 text-sm font-medium text-canvas hover:bg-orange-strong disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => onAct("all-in")}
      >
        All-in
      </button>

      {error && <p className="mt-3 text-sm text-orange-strong">{error}</p>}
    </section>
  );
}
