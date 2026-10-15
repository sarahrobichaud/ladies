// Chip board primitives — pure data, no DOM or React.
//
// A stack at rest is compressed into kind-runs ordered bottom → top;
// individual chips only exist inside the hand while it is being
// interacted with (materialize/coalesce in model.ts are the compression
// seam between Stack and Hand).

export type ChipValue = bigint;
export type KindId = number; // index into a Catalog
export type ChipId = number;
export type StackId = number;

export type ChipKind = { value: ChipValue; tier: number };
export type Catalog = ChipKind[];

// Lattice address; pixel conversion lives in lattice.ts.
export type Slot = { col: number; row: number };

// One kind, N chips. Canonical form: count > 0, no adjacent runs of the
// same kind.
export type Run = { kind: KindId; count: number };

export type Stack = { id: StackId; slot: Slot; runs: Run[] };

export type Chip = { id: ChipId; kind: KindId };

export type Hand = { chips: Chip[]; origin: StackId | null };

export type Size = { w: number; h: number };
export type Point = { x: number; y: number };

export type Board = {
  catalog: Catalog;
  felt: Size;
  stacks: Stack[];
  hand: Hand | null;
  nextChipId: number;
  nextStackId: number;
};