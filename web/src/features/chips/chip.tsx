import type { CSSProperties } from "react";
import { chipLabel } from "../../snapshot";
import { CHIP_TIERS } from "./palette";

// Canonical DOM chip size in px, independent of the felt world's scale knob.
export const CHIP_SIZE = 70;

export function Chip({
  value,
  tier,
  size = CHIP_SIZE,
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
    "--chip-face": palette.face,
    "--chip-spot": palette.spot,
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.26)),
    ...style,
  } as CSSProperties;

  return (
    <span style={vars} className={`poker-chip ${className ?? ""}`}>
      <span className="relative z-10 font-semibold tabular-nums" style={{ color: palette.text }}>
        {chipLabel(value)}
      </span>
    </span>
  );
}
