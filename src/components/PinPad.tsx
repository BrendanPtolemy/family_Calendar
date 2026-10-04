import { useState } from 'react';
import { post, setParentToken } from '../api';
import { useFamily } from '../family';
import { Modal } from './Modal';

export function PinPad() {
  const { closePin, unlocked, state } = useFamily();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (p: string) => {
    setBusy(true);
    try {
      const { token } = await post<{ token: string }>('/parent/unlock', { pin: p });
      setParentToken(token);
      unlocked();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    setError('');
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  return (
    <Modal title="Parent PIN" onClose={closePin}>
      <div className="pinpad">
        <div className="pin-dots" aria-live="polite">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        {error ? <p className="error">{error}</p> : state?.settings.pinIsDefault ? <p className="muted">Default PIN is 1234. Change it in Settings.</p> : <p className="muted">&nbsp;</p>}
        <div className="pin-keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)}>{d}</button>
          ))}
          <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete">⌫</button>
          <button onClick={() => press('0')}>0</button>
          <button className="primary" disabled={pin.length < 4 || busy} onClick={() => submit(pin)} aria-label="Unlock">✓</button>
        </div>
      </div>
    </Modal>
  );
}
