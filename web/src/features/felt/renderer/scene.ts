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
import { chipAngle, engraved, pushLabel, rgba, ring, shade, shadow, spot } from "./items";
import type { SceneItem } from "./primitives";
import type { FontFace } from "./text";

export type { Drag, Lift } from "../interaction";
export type { SceneColors } from "./colors";

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

// Felt surface corner radius, matching the rounded-xl chrome.
const feltSurface = { radius: 12 } as const;

/** Draw the felt surface: the gradient wash every other item sits on. */
function pushFeltSurface(items: SceneItem[], surface: SceneInput["surface"], colors: SceneColors) {
  items.push({
    kind: "felt",
    x: surface.x + surface.w / 2,
    y: surface.y + surface.h / 2,
    hw: surface.w / 2,
    hh: surface.h / 2,
    radius: feltSurface.radius,
    felt: colors.felt,
    feltDeep: colors.feltDeep,
  });
}

// Lattice rings: faint dashed chip outlines.
const latticeRing = { inset: 1, width: 1, dash: [3, 5], alpha: 0.16 } as const;

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
        CHIP_RADIUS - latticeRing.inset,
        (CHIP_RADIUS - latticeRing.inset) * CHIP_SQUASH,
        latticeRing.width,
        latticeRing.dash,
        rgba(colors.onFelt, latticeRing.alpha),
        null,
      ),
    );
  }
}

// Bet slots darken like pressed-in spots in the felt.
const betSpot = { inset: 2, alpha: 0.14, soft: 2 } as const;

/** Draw bet-zone slots as darkened spots pressed into the felt. */
function pushZoneMarks(items: SceneItem[], zones: Zone[]) {
  for (const zone of zones) {
    if (zone.purpose !== "bet") {
      continue;
    }
    for (const slot of zone.slots) {
      const { x, y } = slotPosition(slot);
      items.push(spot(x, y, CHIP_RADIUS - betSpot.inset, betSpot.alpha, betSpot.soft));
    }
  }
}

// Buttons: engraved spots rimmed and labeled so they read pressable.
const button = { inset: 2, rimAlpha: 0.3, fillAlpha: 0.16, soft: 2, labelOffset: 0.5 } as const;

/** Draw one engraved, rimmed spot per button-zone slot, labeled and squashed like the lattice. */
function pushButtons(items: SceneItem[], zones: Zone[], colors: SceneColors, fonts: SceneFonts) {
  for (const zone of zones) {
    if (zone.purpose !== "button") {
      continue;
    }
    for (const slot of zone.slots) {
      const { x, y } = slotPosition(slot);
      items.push(
        engraved(x, y, CHIP_RADIUS - button.inset, rgba(colors.onFelt, button.rimAlpha), button.fillAlpha, button.soft),
      );
      pushLabel(items, fonts.badge, zone.label ?? "BET", x, y + button.labelOffset, colors.onFelt, CHIP_SQUASH);
    }
  }
}

// Dashed ghost rings: the landing preview and the cut-plane ring share one look.
const ghostRing = { width: 2, dash: [4, 4], placeAlpha: 0.6, combineTintAlpha: 0.2 } as const;

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
      ghostRing.width,
      ghostRing.dash,
      isCombine ? rgba(colors.orange, 1) : rgba(colors.onFelt, ghostRing.placeAlpha),
      isCombine ? rgba(colors.orangeTint, ghostRing.combineTintAlpha) : null,
    ),
  );
}

// Merge halo: a solid ring pulsing around the combine target.
const halo = { periodMs: 180, gap: 6, wobble: 1.5, alphaMin: 0.45, alphaRange: 0.55 } as const;

/** Draw the pulsing halo around the stack the hand will combine with. */
function pushMergeHalo(items: SceneItem[], target: Stack, colors: SceneColors, time: number) {
  const { x, y } = slotPosition(target.slot);
  const height = (stackSize(target) - 1) * STACK_LIFT;
  const pulse = 0.5 + 0.5 * Math.sin(time / halo.periodMs);
  const gap = halo.gap + pulse * halo.wobble;

  items.push(
    ring(
      x,
      y - height / 2,
      CHIP_RADIUS + gap,
      CHIP_RADIUS * CHIP_SQUASH + height / 2 + gap,
      ghostRing.width,
      [0, 0],
      rgba(colors.orange, halo.alphaMin + halo.alphaRange * pulse),
      null,
    ),
  );
}

/** Order stacks bottom-of-screen first, so lower stacks occlude higher ones. */
function stacksBackToFront(felt: Felt): Stack[] {
  return [...felt.stacks].sort((a, b) => slotPosition(a.slot).y - slotPosition(b.slot).y);
}

// Contact shadow under a stack resting on the felt.
const stackShadow = { drop: 1.5, spread: 2.5, alpha: 0.25, soft: 4 } as const;

/** Draw one contact shadow per stack, hoisted ahead of all stack ink. */
function pushStackShadows(items: SceneItem[], stacks: Stack[]) {
  for (const stack of stacks) {
    const { x, y } = slotPosition(stack.slot);
    items.push(shadow(x, y + STACK_LIFT + stackShadow.drop, stackShadow.spread, stackShadow.alpha, stackShadow.soft));
  }
}

// Chip ink: non-merge-target stacks dim while dragging; labels sit just below chip centers.
const chipInk = { dim: 0.5, labelBaselineOffset: 0.5 } as const;

/** Draw one stack: walls in one run, then the exposed faces with labels. */
function pushStack(items: SceneItem[], felt: Felt, stack: Stack, mergeTarget: Stack | null, ctx: StackContext) {
  const { drag, hover, lift, colors, fonts } = ctx;
  const isMergeTarget = mergeTarget?.id === stack.id;
  const dimFactor = drag !== null && !isMergeTarget ? chipInk.dim : 1;
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
      cyAt(depth) + chipInk.labelBaselineOffset,
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
        ghostRing.width,
        ghostRing.dash,
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

// Contact shadow under the hand, held above the felt: softer, wider, offset further down.
const handShadow = { drop: 5, spread: 4, alpha: 0.18, soft: 7 } as const;

/** Draw the held hand: a soft shadow plus a wall, face, and label per chip. */
function pushHand(items: SceneItem[], felt: Felt, handPos: Point | null, colors: SceneColors, fonts: SceneFonts) {
  if (!felt.hand || !handPos) {
    return;
  }

  const chips = felt.hand.chips;
  const topIndex = chips.length - 1;

  // Held above the table: a softer, wider shadow offset further down.
  items.push(
    shadow(handPos.x, handPos.y + STACK_LIFT + handShadow.drop, handShadow.spread, handShadow.alpha, handShadow.soft),
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
      cy + chipInk.labelBaselineOffset,
      palette.text,
      CHIP_SQUASH,
    );
  }
}

// Hover badge: a rounded panel floating above the hovered stack's top chip.
const badge = { lift: 14, clearance: 10, padX: 8, halfHeight: 9, radius: 9, fillAlpha: 0.9 } as const;

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
  const badgeY = y - stackTopOffset(stack) - badge.lift - badge.clearance;
  const text = formatChips(runsValue(stack.runs, felt.catalog));
  const textWidth = fonts.badge.width(text);

  items.push({
    kind: "panel",
    x,
    y: badgeY,
    hw: textWidth / 2 + badge.padX,
    hh: badge.halfHeight,
    radius: badge.radius,
    fill: rgba(colors.canvasBg, badge.fillAlpha),
    stroke: rgba(colors.line, 1),
  });
  pushLabel(items, fonts.badge, text, x, badgeY, colors.ink);
}
