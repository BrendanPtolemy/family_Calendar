import { useState } from 'react';
import { post } from '../api';
import { useFamily } from '../family';

function guessName(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'Tablet';
  if (/iPhone|Android.*Mobile/i.test(ua)) return 'Phone';
  return 'Computer';
}

/** Shown on a device the server doesn't know yet. */
export function PairScreen() {
  const { refresh } = useFamily();
  const [code, setCode] = useState('');
  const [name, setName] = useState(guessName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/pair', { code, name: name.trim() });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pair-screen">
      <form className="card pair-card" onSubmit={submit}>
        <p className="big-emoji">🔑</p>
        <h2>Connect this device</h2>
        <p className="muted">
          Ask a parent for a code: on a device that's already connected, go to Settings › Devices › Add a device.
          For the very first device, run <code>npm run pair</code> on the server.
        </p>
        <label className="field">
          <span>Pairing code</span>
          <input
            className="pair-code"
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            value={code}
            maxLength={12}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          <span>Name this device</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Kitchen tablet" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 8}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
