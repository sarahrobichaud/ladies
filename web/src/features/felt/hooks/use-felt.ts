import { useCallback, useState } from 'react';
import { createBoard, type Felt } from '../felt';
import type { Catalog } from '../../chips/types';

/**
 * Owns the felt state and exposes a stable dispatcher for the pure felt
 * model ops.
 * @param catalog - the chip catalog the felt plays with
 * @returns the current felt and a stable op dispatcher
 */
export function useFelt(catalog: Catalog) {
  const [felt, setFelt] = useState<Felt>(() => createBoard(catalog, { w: 0, h: 0 }));
  const apply = useCallback((op: (felt: Felt) => Felt) => setFelt(op), []);
  return { felt, apply };
}
