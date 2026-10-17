import { useEffect, useState } from "react";
import type { HandSnapshot } from "../../snapshot";
import type { ActionKind } from "./action-core";
import { FeltActionDeck } from "./felt-action-deck";
import { TouchActionPad } from "./touch-action-pad";

/**
 * The action seam: the only module that knows environments exist. It renders
 * one adapter component per environment and re-picks it as the pointer and
 * viewport change; both adapters emit the same engine sink, so callers never
 * learn the swap happened. A swap discards staged chips, which the epoch
 * reset makes benign at turn boundaries.
 */

/** Props every action UI receives; the engine seam passes through untouched. */
export type ActionSystemProps = {
  hand: HandSnapshot;
  error: string | null;
  onAct: (kind: ActionKind, raiseTo?: bigint) => void;
};

/** Which action UI the environment gets. */
export type ActionEnvironment = "desktop" | "mobile";

/** Viewport width below which the touch pad takes over, in CSS px. */
const MOBILE_MAX_WIDTH = 640;

/** Matches every environment that gets the touch pad; live, so it tracks resizes. */
const TOUCH_QUERY = `(pointer: coarse), (max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * Tracks the environment from the pointer and viewport. A swap is deferred
 * while any pointer is down, so an in-flight gesture never has the UI
 * swapped out from under it; it lands when the pointer settles.
 * @returns the current environment
 */
function useEnvironment(): ActionEnvironment {
  const [env, setEnv] = useState<ActionEnvironment>(() =>
    window.matchMedia(TOUCH_QUERY).matches ? "mobile" : "desktop",
  );
  useEffect(() => {
    const query = window.matchMedia(TOUCH_QUERY);
    let pointers = 0;
    let deferred: ActionEnvironment | null = null;
    const apply = (next: ActionEnvironment) => {
      if (pointers > 0) {
        deferred = next;
        return;
      }
      setEnv(next);
    };
    const measure = () => {
      apply(query.matches ? "mobile" : "desktop");
    };
    const down = () => {
      pointers += 1;
    };
    const settle = () => {
      pointers = Math.max(0, pointers - 1);
      if (pointers === 0 && deferred) {
        const next = deferred;
        deferred = null;
        setEnv(next);
      }
    };
    query.addEventListener("change", measure);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", settle, true);
    window.addEventListener("pointercancel", settle, true);
    return () => {
      query.removeEventListener("change", measure);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", settle, true);
      window.removeEventListener("pointercancel", settle, true);
    };
  }, []);
  return env;
}

/**
 * Renders the action UI for the current environment.
 * @param props - the hand snapshot, engine error, and action sink
 */
export function ActionSystem(props: ActionSystemProps) {
  const env = useEnvironment();
  return env === "mobile" ? <TouchActionPad {...props} /> : <FeltActionDeck {...props} />;
}
