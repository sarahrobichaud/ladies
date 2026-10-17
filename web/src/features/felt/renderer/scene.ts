// The scene builder: pure translation from Felt + interaction state to
// renderer primitives, in painter's order. No GL, no React.

import { chipLabel, formatChips } from "../../../snapshot";
import { runsValue } from "../../chips/runs";
import { type Felt, feltZones, type Stack, stackSize } from "../felt";
import type { Point } from "../geom";
import { type Drag, type Landing, type Lift, landingFor, type Pick, stackTopOffset } from "../interaction";
import { allSlots, slotPosition } from "../lattice";
import { CHIP_RADIUS, CHIP_SQUASH, STACK_LIFT } from "../world";
import type { Zone } from "../zones";
import type { SceneColors } from "./colors";
import { chipAngle, pushLabel, rgba, ring, shade, shadow } from "./items";
import type { SceneItem } from "./primitives";
import type { FontFace } from "./text";

export type { Drag, Lift } from "../interaction";
export type { SceneColors } from "./colors";

// --- scene paint constants (px / alpha) ---------------------------------------

// Lattice rings.
const LATTICE_RING_INSET = 1; // px inside the chip radius
const LATTICE_RING_WIDTH = 1;
const LATTICE_RING_DASH: readonly [number, number] = [3, 5];
const LATTICE_RING_ALPHA = 0.16;

// Landing ghost ring.
const GHOST_RING_WIDTH = 2;
const GHOST_RING_DASH: readonly [number, number] = [4, 4];
const GHOST_PLACE_ALPHA = 0.6;
const GHOST_COMBINE_TINT_ALPHA = 0.2;

// Merge halo pulse.
const HALO_PULSE_PERIOD_MS = 180;
const HALO_GAP = 6; // px beyond the chip on all sides
const HALO_PULSE_WOBBLE = 1.5; // px the gap breathes
const HALO_ALPHA_MIN = 0.45;
const HALO_ALPHA_RANGE = 0.55;

// Zone paint: bet slots darken like pressed-in spots in the felt.
const BET_SPOT_INSET = 2; // px inside the chip radius
const BET_SPOT_ALPHA = 0.14;
const BET_SPOT_SOFT = 2;

// Button paint: an engraved spot in the felt, rimmed and labeled so it reads pressable.
const BUTTON_SPOT_ALPHA = 0.16;
const BUTTON_RIM_ALPHA = 0.3;
const BUTTON_LABEL_OFFSET = 0.5; // px below button center

// Contact shadows.
const STACK_SHADOW_DROP = 1.5; // px below the stack base
const STACK_SHADOW_SPREAD = 2.5;
const STACK_SHADOW_ALPHA = 0.25;
const STACK_SHADOW_SOFT = 4;
const HAND_SHADOW_DROP = 5; // px below the hand, held above the felt
const HAND_SHADOW_SPREAD = 4;
const HAND_SHADOW_ALPHA = 0.18;
const HAND_SHADOW_SOFT = 7;

// Stack ink.
const DIM_FACTOR = 0.5; // non-merge-target stacks while dragging
const LABEL_BASELINE_OFFSET = 0.5; // px below chip center

// Hover badge.
const BADGE_LIFT = 14; // px above the top chip
const BADGE_CLEARANCE = 10; // extra px above the top chip
const BADGE_PADDING_X = 8;
const BADGE_HALF_HEIGHT = 9;
const BADGE_RADIUS = 9;
const BADGE_FILL_ALPHA = 0.9;

// Felt surface.
const FELT_RADIUS = 12; // px, matches the rounded-xl chrome

/** Fonts the scene renders with. */
export type SceneFonts = { chip: FontFace; badge: FontFace };

/** Inputs to the scene builder for one frame. */
export type SceneInput = {
  felt: Felt;
  /** The felt surface quad in scene coords: the gradient wash under everything. */
  surface: { x: number; y: number; w: number; h: number };
  handPos: Point | null;
  drag: Drag | null;
  hover: Pick | null;
  lift: Lift | null;
  colors: SceneColors;
  time: number;
  fonts: SceneFonts;
};

/** State shared by the per-stack drawing helpers. */
type StackContext = {
  drag: Drag | null;
  hover: Pick | null;
  lift: Lift | null;
  colors: SceneColors;
  fonts: SceneFonts;
};

/**
 * Build the frame's draw list: lattice, landing preview, stacks, hand,
 * and hover badge, in painter's order.
 * @param input - felt state, interaction state, colors, fonts, and time
 * @returns draw items in painter's order; the renderer packs and draws them as-is
 */
export function buildScene(input: SceneInput): SceneItem[] {
  const { felt, handPos, drag, hover, lift, colors, time, fonts } = input;
  const items: SceneItem[] = [];

  pushFeltSurface(items, input.surface, colors);

  const zones = feltZones(felt);
  pushLattice(items, felt, zones, colors);
  pushZoneMarks(items, zones);
  pushButtons(items, zones, colors, fonts);

  const landing = felt.hand && handPos ? landingFor(felt, handPos) : null;
  const mergeTarget = landing?.type === "combine" ? (felt.stacks.find((s) => s.id === landing.stackId) ?? null) : null;

  pushLandingGhost(items, landing, colors);
  if (mergeTarget) {
    pushMergeHalo(items, mergeTarget, colors, time);
  }

  const stacks = stacksBackToFront(felt);
  pushStackShadows(items, stacks);
  for (const stack of stacks) {
    pushStack(items, felt, stack, mergeTarget, { drag, hover, lift, colors, fonts });
  }

  pushHand(items, felt, handPos, colors, fonts);
  pushHoverBadge(items, felt, hover, drag, colors, fonts);

  return items;
}

/** Draw the felt surface: the gradient wash every other item sits on. */
function pushFeltSurface(items: SceneItem[], surface: SceneInput["surface"], colors: SceneColors) {
  items.push({
    kind: "felt",
    x: surface.x + surface.w / 2,
    y: surface.y + surface.h / 2,
    hw: surface.w / 2,
    hh: surface.h / 2,
    radius: FELT_RADIUS,
    felt: colors.felt,
    feltDeep: colors.feltDeep,
  });
}

/** Draw one dashed ring per standard chip slot; marked zones render their own markers instead. */
function pushLattice(items: SceneItem[], felt: Felt, zones: Zone[], colors: SceneColors) {
  const blocked = new Set<string>();
  for (const zone of zones) {
    if (zone.purpose === "stack") {
      continue;
    }
    for (const slot of zone.slots) {
      blocked.add(`${slot.col},${slot.row}`);
    }
  }
  for (const slot of allSlots(felt.felt)) {
    if (blocked.has(`${slot.col},${slot.row}`)) {
      continue;
    }
    const { x, y } = slotPosition(slot);
    items.push(
      ring(
        x,
        y,
        CHIP_RADIUS - LATTICE_RING_INSET,
        (CHIP_RADIUS - LATTICE_RING_INSET) * CHIP_SQUASH,
        LATTICE_RING_WIDTH,
        LATTICE_RING_DASH,
        rgba(colors.onFelt, LATTICE_RING_ALPHA),
        null,
      ),
    );
  }
}

/** Draw bet-zone slots as darkened spots pressed into the felt. */
function pushZoneMarks(items: SceneItem[], zones: Zone[]) {
  for (const zone of zones) {
    if (zone.purpose !== "bet") {
      continue;
    }
    for (const slot of zone.slots) {
      const { x, y } = slotPosition(slot);
      items.push(
        ring(
          x,
          y,
          CHIP_RADIUS - BET_SPOT_INSET,
          (CHIP_RADIUS - BET_SPOT_INSET) * CHIP_SQUASH,
          0,
          [0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, BET_SPOT_ALPHA],
          BET_SPOT_SOFT,
        ),
      );
    }
  }
}

/** Draw one engraved, rimmed spot per button-zone slot, labeled and squashed like the lattice. */
function pushButtons(items: SceneItem[], zones: Zone[], colors: SceneColors, fonts: SceneFonts) {
  for (const zone of zones) {
    if (zone.purpose !== "button") {
      continue;
    }
    for (const slot of zone.slots) {
      const { x, y } = slotPosition(slot);
      const rx = CHIP_RADIUS - BET_SPOT_INSET;
      const ry = rx * CHIP_SQUASH;
      items.push(
        ring(
          x,
          y,
          rx,
          ry,
          1,
          [0, 0],
          rgba(colors.onFelt, BUTTON_RIM_ALPHA),
          [0, 0, 0, BUTTON_SPOT_ALPHA],
          BET_SPOT_SOFT,
        ),
      );
      pushLabel(items, fonts.badge, zone.label ?? "BET", x, y + BUTTON_LABEL_OFFSET, colors.onFelt, CHIP_SQUASH);
    }
  }
}

/** Draw the landing ghost where the hand's bottom chip would sit. */
function pushLandingGhost(items: SceneItem[], landing: Landing | null, colors: SceneColors) {
  if (!landing || landing.type === "none" || landing.type === "discard") {
    return;
  }

  const isCombine = landing.type === "combine";
  items.push(
    ring(
      landing.ring.x,
      landing.ring.y,
      CHIP_RADIUS,
      CHIP_RADIUS * CHIP_SQUASH,
      GHOST_RING_WIDTH,
      GHOST_RING_DASH,
      isCombine ? rgba(colors.orange, 1) : rgba(colors.onFelt, GHOST_PLACE_ALPHA),
      isCombine ? rgba(colors.orangeTint, GHOST_COMBINE_TINT_ALPHA) : null,
    ),
  );
}

/** Draw the pulsing halo around the stack the hand will combine with. */
function pushMergeHalo(items: SceneItem[], target: Stack, colors: SceneColors, time: number) {
  const { x, y } = slotPosition(target.slot);
  const height = (stackSize(target) - 1) * STACK_LIFT;
  const pulse = 0.5 + 0.5 * Math.sin(time / HALO_PULSE_PERIOD_MS);
  const gap = HALO_GAP + pulse * HALO_PULSE_WOBBLE;

  items.push(
    ring(
      x,
      y - height / 2,
      CHIP_RADIUS + gap,
      CHIP_RADIUS * CHIP_SQUASH + height / 2 + gap,
      GHOST_RING_WIDTH,
      [0, 0],
      rgba(colors.orange, HALO_ALPHA_MIN + HALO_ALPHA_RANGE * pulse),
      null,
    ),
  );
}

/** Order stacks bottom-of-screen first, so lower stacks occlude higher ones. */
function stacksBackToFront(felt: Felt): Stack[] {
  return [...felt.stacks].sort((a, b) => slotPosition(a.slot).y - slotPosition(b.slot).y);
}

/** Draw one contact shadow per stack, hoisted ahead of all stack ink. */
function pushStackShadows(items: SceneItem[], stacks: Stack[]) {
  for (const stack of stacks) {
    const { x, y } = slotPosition(stack.slot);
    items.push(
      shadow(x, y + STACK_LIFT + STACK_SHADOW_DROP, STACK_SHADOW_SPREAD, STACK_SHADOW_ALPHA, STACK_SHADOW_SOFT),
    );
  }
}

/** Draw one stack: walls in one run, then the exposed faces with labels. */
function pushStack(items: SceneItem[], felt: Felt, stack: Stack, mergeTarget: Stack | null, ctx: StackContext) {
  const { drag, hover, lift, colors, fonts } = ctx;
  const isMergeTarget = mergeTarget?.id === stack.id;
  const dimFactor = drag !== null && !isMergeTarget ? DIM_FACTOR : 1;
  const { x, y } = slotPosition(stack.slot);
  const size = stackSize(stack);
  const kindAt = kindsAt(stack);

  const hovered = hover?.stackId === stack.id ? hover : null;
  const liftState = lift?.stackId === stack.id ? lift : null;
  const cut = liftState?.depth ?? null;
  const liftValue = liftState?.value ?? 0;
  const topHover = hovered?.isTop === true;

  const cyAt = (depth: number) => y - depth * STACK_LIFT - (cut !== null && depth >= cut ? liftValue : 0);
  const angleAt = (depth: number) => (depth === size - 1 ? 0 : chipAngle(stack.id, depth));

  const pushWall = (depth: number) => {
    const palette = colors.tiers[kindAt[depth] % colors.tiers.length];
    items.push({
      kind: "wall",
      x,
      y: cyAt(depth),
      face: palette.face,
      spot: palette.spot,
      dim: dimFactor,
      thickness: STACK_LIFT,
      angle: angleAt(depth),
    });
  };

  const pushFace = (depth: number) => {
    const palette = colors.tiers[kindAt[depth] % colors.tiers.length];
    items.push({
      kind: "chip",
      x,
      y: cyAt(depth),
      face: palette.face,
      spot: palette.spot,
      dim: dimFactor,
      highlight: topHover && depth === size - 1 ? rgba(colors.blue, 1) : null,
      angle: angleAt(depth),
    });
    pushLabel(
      items,
      fonts.chip,
      chipLabel(felt.catalog[kindAt[depth]].value),
      x,
      cyAt(depth) + LABEL_BASELINE_OFFSET,
      shade(palette.text, dimFactor),
      CHIP_SQUASH,
    );
  };

  if (cut === null) {
    for (let depth = 0; depth < size; depth++) {
      pushWall(depth);
    }
    pushFace(size - 1);
  } else {
    // Cut stack: lower half, ghost ellipse at the cut plane, lifted upper half.
    for (let depth = 0; depth < cut; depth++) {
      pushWall(depth);
    }
    if (cut > 0) {
      pushFace(cut - 1);
    }
    items.push(
      ring(
        x,
        y - cut * STACK_LIFT,
        CHIP_RADIUS,
        CHIP_RADIUS * CHIP_SQUASH,
        GHOST_RING_WIDTH,
        GHOST_RING_DASH,
        rgba(colors.orange, 1),
        null,
      ),
    );
    for (let depth = cut; depth < size; depth++) {
      pushWall(depth);
    }
    pushFace(size - 1);
  }
}

/** Expand a stack's runs into one kind id per chip depth. */
function kindsAt(stack: Stack): number[] {
  const kindAt: number[] = [];
  for (const run of stack.runs) {
    for (let i = 0; i < run.count; i++) {
      kindAt.push(run.kind);
    }
  }
  return kindAt;
}

/** Draw the held hand: a soft shadow plus a wall, face, and label per chip. */
function pushHand(items: SceneItem[], felt: Felt, handPos: Point | null, colors: SceneColors, fonts: SceneFonts) {
  if (!felt.hand || !handPos) {
    return;
  }

  const chips = felt.hand.chips;
  const topIndex = chips.length - 1;

  // Held above the table: a softer, wider shadow offset further down.
  items.push(
    shadow(
      handPos.x,
      handPos.y + STACK_LIFT + HAND_SHADOW_DROP,
      HAND_SHADOW_SPREAD,
      HAND_SHADOW_ALPHA,
      HAND_SHADOW_SOFT,
    ),
  );

  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    const palette = colors.tiers[chip.kind % colors.tiers.length];
    const cy = handPos.y - i * STACK_LIFT;
    // Top chip of the hand (last in array = highest visually) stays unrotated.
    const angle = i === topIndex ? 0 : chipAngle(chip.id, i);

    items.push({
      kind: "wall",
      x: handPos.x,
      y: cy,
      face: palette.face,
      spot: palette.spot,
      dim: 1,
      thickness: STACK_LIFT,
      angle,
    });
    items.push({
      kind: "chip",
      x: handPos.x,
      y: cy,
      face: palette.face,
      spot: palette.spot,
      dim: 1,
      highlight: null,
      angle,
    });
    pushLabel(
      items,
      fonts.chip,
      chipLabel(felt.catalog[chip.kind].value),
      handPos.x,
      cy + LABEL_BASELINE_OFFSET,
      palette.text,
      CHIP_SQUASH,
    );
  }
}

/** Draw the hovered stack's value badge above its top chip. */
function pushHoverBadge(
  items: SceneItem[],
  felt: Felt,
  hover: Pick | null,
  drag: Drag | null,
  colors: SceneColors,
  fonts: SceneFonts,
) {
  if (!hover || drag) {
    return;
  }

  const stack = felt.stacks.find((s) => s.id === hover.stackId);
  if (!stack) {
    return;
  }

  const { x, y } = slotPosition(stack.slot);
  const badgeY = y - stackTopOffset(stack) - BADGE_LIFT - BADGE_CLEARANCE;
  const text = formatChips(runsValue(stack.runs, felt.catalog));
  const textWidth = fonts.badge.width(text);

  items.push({
    kind: "panel",
    x,
    y: badgeY,
    hw: textWidth / 2 + BADGE_PADDING_X,
    hh: BADGE_HALF_HEIGHT,
    radius: BADGE_RADIUS,
    fill: rgba(colors.canvasBg, BADGE_FILL_ALPHA),
    stroke: rgba(colors.line, 1),
  });
  pushLabel(items, fonts.badge, text, x, badgeY, colors.ink);
}
