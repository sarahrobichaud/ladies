import { CHIP_TIER_VARS } from "../../chips/palette";
import type { RGB } from "./primitives";

/** Off-DOM element the browser parses colors through. */
const colorProbe = document.createElement("span");

/** The color tokens the scene needs, resolved from the active theme. */
export type SceneColors = {
  tiers: { face: RGB; spot: RGB; text: RGB }[];
  onFelt: RGB;
  felt: RGB;
  feltDeep: RGB;
  canvasBg: RGB;
  line: RGB;
  ink: RGB;
  orange: RGB;
  orangeTint: RGB;
  blue: RGB;
  bodyFont: string;
};

/**
 * Resolve the theme tokens the scene needs from the document's computed style.
 * @returns resolved colors; unparseable tokens become a loud cyan fallback
 */
export function resolveSceneColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => parseColor(style.getPropertyValue(name));

  const tiers = CHIP_TIER_VARS.map(({ face, spot, text }) => ({
    face: token(face),
    spot: token(spot),
    text: token(text),
  }));

  return {
    tiers,
    onFelt: token("--on-felt"),
    felt: token("--felt"),
    feltDeep: token("--felt-deep"),
    canvasBg: token("--canvas"),
    line: token("--line"),
    ink: token("--ink"),
    orange: token("--orange"),
    orangeTint: token("--orange-tint"),
    blue: token("--blue"),
    bodyFont: style.getPropertyValue("--body-font").trim(),
  };
}

/**
 * Parse a CSS color string into normalized RGB components (0..1).
 * @param color - raw CSS color value, e.g. "#f60" or "rgba(255, 0, 0, 0.5)"
 * @returns [r, g, b] in 0..1; loud cyan when the value can't be parsed
 */
function parseColor(color: string): RGB {
  // The browser normalizes any valid CSS color to a canonical rgb()
  // string, or leaves the style empty when the value is invalid.
  colorProbe.style.color = "";
  colorProbe.style.color = color.trim();

  const match = colorProbe.style.color.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) {
    // loud fallback: unparseable tokens should be visible
    return [0, 1, 1];
  }

  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}
