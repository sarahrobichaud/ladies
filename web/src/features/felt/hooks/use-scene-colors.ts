import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { resolveSceneColors, type SceneColors } from "../renderer/colors";

/**
 * Keeps the theme-resolved scene colors in a ref, re-resolving on theme
 * changes.
 * @returns a ref with the latest resolved scene colors
 */
export function useSceneColors(): RefObject<SceneColors> {
  const colorsRef = useRef<SceneColors | null>(null);

  if (colorsRef.current === null) {
    colorsRef.current = resolveSceneColors();
  }

  useEffect(() => {
    const observer = new MutationObserver(() => {
      colorsRef.current = resolveSceneColors();
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  return colorsRef as RefObject<SceneColors>;
}
