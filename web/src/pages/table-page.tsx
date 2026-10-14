import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { getSession } from '../session-store';
import type { SessionSnapshot } from '../snapshot';
import { formatChips } from '../snapshot';
import { PokerTable } from '../components/poker-table';

export function TablePage() {
  const session = getSession();
  // Snapshot once on entry; the session is mutable WASM state that lives
  // outside React, so it can't go into a dependency array.
  const [snap] = useState<SessionSnapshot | null>(() =>
    session ? (session.snapshot() as SessionSnapshot) : null,
  );

  // No session (e.g. direct visit to /table) — nothing to show.
  if (!session || !snap) return <Navigate to="/" replace />;

  const hand = snap.hand;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-canvas p-8">
      <header className="flex w-full max-w-3xl items-center justify-between">
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

      {hand && (
        <PokerTable
          players={hand.players}
          button={hand.button}
          toAct={hand.to_act}
          board={hand.board}
          pot={hand.pot}
        />
      )}
    </div>
  );
}
