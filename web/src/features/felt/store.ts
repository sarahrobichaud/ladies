import { useSyncExternalStore } from "react";
import type { Catalog } from "../chips/types";
import { createBoard, type Felt } from "./felt";
import { FREE_LAYOUT, type ZoneSpec } from "./zones";

/**
 * External store for the felt model: the render loop reads it directly each
 * frame, while React components subscribe through useSyncExternalStore.
 */

/** Reads and updates the felt model outside React's render cycle. */
export type FeltStore = {
  /** The current felt state; stable reference until the next applied change. */
  get(): Felt;
  /** Applies a pure felt op; rejected ops (same state back) notify no one. */
  apply(op: (felt: Felt) => Felt): void;
  /** Subscribes to felt changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

/**
 * Creates a felt store holding an empty board.
 * @param catalog - the chip catalog for value lookups
 * @param layout - the zone layout; defaults to one stack zone covering everything
 */
export function createFeltStore(catalog: Catalog, layout: readonly ZoneSpec[] = FREE_LAYOUT): FeltStore {
  let felt = createBoard(catalog, { w: 0, h: 0 }, layout);
  const listeners = new Set<() => void>();
  return {
    get: () => felt,
    apply: (op) => {
      const next = op(felt);
      if (next === felt) {
        return;
      }
      felt = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Subscribes a component to the store's felt state.
 * @param store - the felt store to read
 */
export function useFeltState(store: FeltStore): Felt {
  return useSyncExternalStore(store.subscribe, store.get);
}
