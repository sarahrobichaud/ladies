import type { WasmSession } from './session';

// The WasmSession is a mutable WASM object, so it can't travel through
// router state. Pages hand it off through this module-level holder.
let current: WasmSession | null = null;

export function setSession(session: WasmSession | null) {
  current = session;
}

export function getSession(): WasmSession | null {
  return current;
}
