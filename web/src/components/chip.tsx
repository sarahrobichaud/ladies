import type { CSSProperties } from 'react';
import { chipLabel } from '../snapshot';

// Chip face palettes by tier, mapped to theme tokens so both color schemes
// read correctly. Tiers are ranks among the rack's denominations, not
// absolute values.
const CHIP_TIERS = [
  { face: 'var(--raised)', spot: 'var(--muted)', text: 'var(--ink)' },
  { face: 'var(--orange)', spot: 'var(--canvas)', text: 'var(--canvas)' },
  { face: 'var(--felt-deep)', spot: 'var(--on-felt)', text: 'var(--on-felt)' },
  { face: 'var(--ink)', spot: 'var(--canvas)', text: 'var(--canvas)' },
  { face: 'var(--blue)', spot: 'var(--canvas)', text: 'var(--canvas)' },
  { face: 'var(--wood-light)', spot: 'var(--canvas)', text: 'var(--ink)' },
];

export function Chip({
  value,
  tier,
  size = 44,
  className,
  style,
}: {
  value: bigint;
  tier: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const palette = CHIP_TIERS[tier % CHIP_TIERS.length];
  const vars = {
    '--chip-face': palette.face,
    '--chip-spot': palette.spot,
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.26)),
    ...style,
  } as CSSProperties;

  return (
    <span style={vars} className={`poker-chip ${className ?? ''}`}>
      <span className="relative z-10 font-semibold tabular-nums" style={{ color: palette.text }}>
        {chipLabel(value)}
      </span>
    </span>
  );
}
