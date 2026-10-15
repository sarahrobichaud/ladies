import type { Catalog } from './types';

// Tray denominations — classic casino colors via the chip palette tiers.
// Kind identity is the catalog index; the notation resolves values to
// kinds through this, so stored stacks never bake in colors.
export const CATALOG: Catalog = [
  { value: 1n, tier: 0 },
  { value: 5n, tier: 1 },
  { value: 25n, tier: 2 },
  { value: 100n, tier: 3 },
  { value: 500n, tier: 4 },
  { value: 1000n, tier: 5 },
];