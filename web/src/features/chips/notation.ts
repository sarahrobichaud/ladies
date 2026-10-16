import { coalesce } from "./runs";
import type { Catalog, Run } from "./types";

// Stack notation — text ⇄ runs, resolved through the catalog.

// The whole compacted notation: one pair, then any number of ", pair" more.
const GRAMMAR = /^\(\d+,\d+\)(?:,\(\d+,\d+\))*$/;

/** One pair within the compacted text. */
const PAIR = /\(\d+,\d+\)/g;

/**
 * Parse stack notation — "(500, 5), (25, 6)" — into canonical runs.
 * @param text - comma-separated (value, count) pairs with parens, ordered bottom → top
 * @param catalog - denomination lookup; every value must match exactly one kind
 * @throws Error on malformed text, an unknown value, or a non-positive count
 */
export function parseRuns(text: string, catalog: Catalog): Run[] {
  const compact = text.replace(/\s+/g, "");
  if (compact === "") {
    return [];
  }

  if (!GRAMMAR.test(compact)) {
    throw new Error(`bad run "${text.trim()}" — expected (value, count) pairs`);
  }

  const runs: Run[] = [];
  for (const match of compact.matchAll(PAIR)) {
    runs.push(resolvePair(match[0], catalog));
  }

  return coalesce(runs);
}

/**
 * Resolve one "(value, count)" pair to a catalog kind.
 * @param pair - pair text, e.g. "(500, 5)" compacted to "(500,5)"
 * @param catalog - denomination lookup for the value
 * @throws Error if the count is not positive or the value is not in the catalog
 */
function resolvePair(pair: string, catalog: Catalog): Run {
  const [rawValue, rawCount] = pair.slice(1, -1).split(",");
  const value = BigInt(rawValue);
  const count = Number(rawCount);

  if (count <= 0) {
    throw new Error("run count must be positive");
  }

  const kind = catalog.findIndex((k) => k.value === value);
  if (kind === -1) {
    throw new Error(`unknown chip value ${value}`);
  }

  return { kind, count };
}
