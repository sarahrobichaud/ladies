import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { getSession } from '../session-store';
import { normalizeSnapshot } from '../snapshot';
import type { SessionSnapshot } from '../snapshot';
import { formatChips } from '../snapshot';
import { PokerTable } from '../components/poker-table';
import { ActionDeck } from '../components/action-deck';
import type { ActionKind } from '../components/action-menu';

export function TablePage() {
  const session = getSession();
  // Snapshot once on entry; the session is mutable WASM state that lives
  // outside React, so it can't go into a dependency array.
  const [snap, setSnap] = useState<SessionSnapshot | null>(() =>
    session ? normalizeSnapshot(session.snapshot() as SessionSnapshot) : null,
  );
  const [error, setError] = useState<string | null>(null);

  // No session (e.g. direct visit to /table) — nothing to show.
  if (!session || !snap) return <Navigate to="/" replace />;

  const hand = snap.hand;

  const act = (kind: ActionKind, raiseTo?: bigint) => {
    try {
      applyAction(session, kind, raiseTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(null);
    setSnap(normalizeSnapshot(session.snapshot() as SessionSnapshot));
  };

  return (
    <div className="flex h-dvh flex-col bg-canvas p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg text-ink">Table</h1>
          {hand && (
            <p className="text-sm text-muted">
              {hand.street} · Pot {formatChips(hand.pot)}
            </p>
          )}
        </div>
        <Link to="/" className="text-sm text-orange hover:text-orange-strong">
          New session
        </Link>
      </header>

      {hand ? (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center py-4">
            <PokerTable
              players={hand.players}
              button={hand.button}
              toAct={hand.to_act}
              board={hand.board}
              pot={hand.pot}
            />
          </div>
          <ActionDeck hand={hand} error={error} onAct={act} />
        </>
      ) : (
        <div className="mt-6">
          <button
            type="button"
            className="rounded-md bg-blue px-4 py-2 text-sm font-medium text-canvas hover:bg-blue-strong"
            onClick={() => {
              session.start_hand(BigInt(Date.now()));
              setError(null);
              setSnap(normalizeSnapshot(session.snapshot() as SessionSnapshot));
            }}
          >
            Deal next hand
          </button>
        </div>
      )}
    </div>
  );
}

function applyAction(
  session: NonNullable<ReturnType<typeof getSession>>,
  kind: ActionKind,
  raiseTo?: bigint,
) {
  switch (kind) {
    case 'fold':
      return session.fold();
    case 'check':
      return session.check();
    case 'call':
      return session.call();
    case 'raise':
      return session.raise_to(raiseTo!);
    case 'all-in':
      return session.all_in();
  }
}
