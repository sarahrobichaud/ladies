import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Mirrors a value into a ref, assigned in an effect (after commit) so
 * native listeners and rAF loops always read the latest committed state.
 * @param value - the value to mirror
 * @returns a ref holding the latest committed value
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
