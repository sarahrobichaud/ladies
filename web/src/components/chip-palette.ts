// Chip palette tiers — the single source for chip coloring. `CHIP_TIERS`
// maps the tiers to CSS variables for DOM rendering; `CHIP_TIER_VARS` keeps
// the raw variable names so the canvas renderer can resolve them against
// the theme.

export type TierVars = { face: string; spot: string; text: string };

export const CHIP_TIER_VARS: TierVars[] = [
  { face: '--raised', spot: '--muted', text: '--ink' },
  { face: '--orange', spot: '--canvas', text: '--canvas' },
  { face: '--felt-deep', spot: '--on-felt', text: '--on-felt' },
  { face: '--ink', spot: '--canvas', text: '--canvas' },
  { face: '--blue', spot: '--canvas', text: '--canvas' },
  { face: '--wood-light', spot: '--canvas', text: '--ink' },
];

export const CHIP_TIERS: { face: string; spot: string; text: string }[] = CHIP_TIER_VARS.map(
  (tier) => {
    return {
      face: `var(${tier.face})`,
      spot: `var(${tier.spot})`,
      text: `var(${tier.text})`,
    };
  },
);