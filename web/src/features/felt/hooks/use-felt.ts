import { useState } from "react";
import type { Catalog } from "../../chips/types";
import { createBoard, type Felt } from "../felt";

/**
 * Owns the felt state and exposes a stable dispatcher for the pure felt
 * model ops.
 * @param catalog - the chip catalog the felt plays with
 * @returns the current felt and a stable op dispatcher
 */
export function useFelt(catalog: Catalog) {
  const [felt, setFelt] = useState<Felt>(() => createBoard(catalog, { w: 0, h: 0 }));
  const apply = (op: (felt: Felt) => Felt) => setFelt(op);
  return { felt, apply };
}
