import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Mirrors a value into a ref, updated after commit.
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
