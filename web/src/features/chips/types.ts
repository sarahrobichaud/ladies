// Chip identity and run algebra — pure data, no DOM, no px, no felt.

// A chip's monetary worth.
export type ChipValue = bigint;

// Index into a Catalog identifying a chip denomination.
export type KindId = number;

// Unique identifier for an individual chip while it exists in a hand.
export type ChipId = number;

// One denomination: its value plus its palette tier.
export type ChipKind = { value: ChipValue; tier: number };

// The ordered set of denominations the game plays with.
export type Catalog = ChipKind[];

// N chips of one kind; canonical form is count > 0 with no adjacent same-kind runs.
export type Run = { kind: KindId; count: number };

// An individual chip, materialized only while held in a hand.
export type Chip = { id: ChipId; kind: KindId };
