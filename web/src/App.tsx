import { useEffect, useState } from 'react';
import { WasmSession, wasmReady } from './session';

export function App() {
  const [snap, setSnap] = useState<any>(null);

  useEffect(() => {
    wasmReady.then(() => {
      const session = new WasmSession(100n, 200n, new BigUint64Array([5000n, 5000n, 5000n]));
      session.start_hand(1n);
      setSnap(session.snapshot());
    });
  }, []);

    return (
      <div>

        <h2 className='text-red-500'>Hello</h2>
        <pre>{JSON.stringify(snap, null, 2)}</pre>;
      </div>
    )
}
