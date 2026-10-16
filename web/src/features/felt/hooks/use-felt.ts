import { useState } from "react";
import type { Catalog } from "../../chips/types";
import { createBoard, type Felt } from "../felt";
import { FREE_LAYOUT, type ZoneSpec } from "../zones";

/**
 * Owns the felt state and exposes a stable dispatcher for the pure felt
 * model ops.
 * @param catalog - the chip catalog the felt plays with
 * @param layout - the zone layout to start with
 * @returns the current felt and a stable op dispatcher
 */
export function useFelt(catalog: Catalog, layout: readonly ZoneSpec[] = FREE_LAYOUT) {
  const [felt, setFelt] = useState<Felt>(() => createBoard(catalog, { w: 0, h: 0 }, layout));
  const apply = (op: (felt: Felt) => Felt) => setFelt(op);
  return { felt, apply };
}
