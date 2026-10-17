import { useRef } from "react";
import type { Catalog } from "../../chips/types";
import { createFeltStore, type FeltStore } from "../store";
import { FREE_LAYOUT, type ZoneSpec } from "../zones";

/**
 * Owns one felt store for the component's lifetime; later catalog or layout
 * arguments are ignored, matching the previous create-once behavior.
 * @param catalog - the chip catalog the felt plays with
 * @param layout - the zone layout to start with
 * @returns the felt store to apply ops to and subscribe to
 */
export function useFeltStore(catalog: Catalog, layout: readonly ZoneSpec[] = FREE_LAYOUT): FeltStore {
  const ref = useRef<FeltStore | null>(null);
  if (ref.current === null) {
    ref.current = createFeltStore(catalog, layout);
  }
  return ref.current;
}
