import { useEffect, useRef } from "react";
import type { HandSnapshot, PlayerSnapshot } from "../../snapshot";
import { formatChips } from "../../snapshot";

/**
 * Shared action semantics: the vocabulary every action UI emits and the
 * derivations no adapter may re-derive. The environment swap lives above
 * this module; the engine seam lives below it.
 */

/** The actions the engine accepts; the one vocabulary every adapter emits. */
export type ActionKind = "fold" | "check" | "call" | "raise" | "all-in";

/** The engine sink: the only effect an action UI has on the game. */
export type ActionSink = (kind: ActionKind, raiseTo?: bigint) => void;

/** What committing the staged wager on top of the player's bet would do. */
export type Plan = { ok: true; kind: ActionKind; raiseTo?: bigint; label: string } | { ok: false; reason: string };

/** The acting player's options, mapped 1:1 from the engine's snapshot options. */
export type ActionContext = {
  player: PlayerSnapshot;
  /** True while this player owes the engine a decision. */
  live: boolean;
  facingBet: boolean;
  /** 0n exactly when facingBet is false. */
  callAmount: bigint;
  /** Minimum total raise-to level, not an increment. */
  minRaiseTo: bigint;
  /** Largest total raise-to level: the player's bet plus their whole stack. */
  maxRaiseTo: bigint;
};

/**
 * Maps the engine-provided options into the context every action UI needs;
 * no rule is re-derived here, so the UI can never disagree with the engine.
 * @param hand - the current normalized hand snapshot
 * @returns the context for this turn
 */
export function actionContext(hand: HandSnapshot): ActionContext {
  const player = hand.players[hand.to_act];
  const options = hand.options;
  return {
    player,
    live: options !== null,
    facingBet: options !== null && !options.can_check,
    callAmount: options === null ? 0n : options.call_amount,
    minRaiseTo: options === null ? 0n : options.min_raise_to,
    maxRaiseTo: options === null ? 0n : options.max_raise_to,
  };
}

/**
 * Maps a staged wager to the action committing it would perform.
 * @param staged - the wager as an increment over the player's current bet
 * @param ctx - the acting player's options
 * @returns the plan, or null when nothing is staged
 */
export function commitPlan(staged: bigint, ctx: ActionContext): Plan | null {
  if (staged === 0n) {
    return null;
  }
  const { player, facingBet, callAmount, minRaiseTo, maxRaiseTo } = ctx;
  const target = player.bet + staged;

  // Everything went in: let the engine decide call/raise/all-in.
  if (target >= maxRaiseTo) {
    return { ok: true, kind: "all-in", label: `All-in ${formatChips(maxRaiseTo)}` };
  }
  if (facingBet && staged < callAmount) {
    return { ok: false, reason: `${formatChips(callAmount - staged)} short of a call` };
  }
  if (facingBet && staged === callAmount) {
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

/**
 * Runs reset exactly when the acting turn or street changes; no reset on
 * mount. The reset itself is adapter-owned: each adapter knows what its
 * staged state is and how to clear it.
 * @param hand - the current hand snapshot supplying the epoch
 * @param reset - clears the adapter's staged state
 */
export function useEpochReset(hand: HandSnapshot, reset: () => void): void {
  const epoch = `${hand.to_act}:${hand.street}`;
  const prev = useRef(epoch);
  useEffect(() => {
    if (prev.current === epoch) {
      return;
    }
    prev.current = epoch;
    reset();
  }, [epoch, reset]);
}
