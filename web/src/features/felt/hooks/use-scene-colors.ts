import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { resolveSceneColors, type SceneColors } from '../renderer/colors';

/**
 * Keeps the theme-resolved scene colors in a ref, re-resolving when the
 * document element's attributes change (theme/font switches).
 * @returns a ref with the latest resolved scene colors
 */
export function useSceneColors(): RefObject<SceneColors> {
  const colorsRef = useRef(resolveSceneColors());
  useEffect(() => {
    const observer = new MutationObserver(() => {
      colorsRef.current = resolveSceneColors();
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);
  return colorsRef;
}
