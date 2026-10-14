import { coalesce } from './model';
import type { Catalog, Run } from './types';

// Stack notation: "(500, 5), (25, 6)" — (value, count) pairs ordered
// bottom → top. Values resolve to kinds through the catalog, so the
// notation never bakes in colors/tiers. Parsing is strict: unknown values
// and non-positive counts are errors; output is canonical (coalesced).

export function parseRuns(text: string, catalog: Catalog): Run[] {
  const runs: Run[] = [];
  for (const part of text.split(',')) {
    const match = part.trim().match(/^\(?(\d+)\s*,\s*(\d+)\)?$/);
    if (!match) throw new Error(`bad run "${part.trim()}" — expected (value, count)`);
    const value = BigInt(match[1]);
    const count = Number(match[2]);
    if (count <= 0) throw new Error('run count must be positive');
    const kind = catalog.findIndex((k) => k.value === value);
    if (kind === -1) throw new Error(`unknown chip value ${value}`);
    runs.push({ kind, count });
  }
  return coalesce(runs);
}

export function formatRuns(runs: Run[], catalog: Catalog): string {
  return runs.map((r) => `(${catalog[r.kind].value}, ${r.count})`).join(', ');
}