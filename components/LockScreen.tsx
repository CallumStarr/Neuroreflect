'use client';

import { useEffect, useRef, useState } from 'react';
import { unlock } from '@/lib/lock';
import { wipeAll } from '@/lib/vault';

export default function LockScreen() {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState<'unlock' | 'erase' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase || busy) return;
    setBusy('unlock');
    setError(null);
    try {
      const ok = await unlock(passphrase);
      if (!ok) {
        setError('That passphrase does not unlock this journal.');
        setPassphrase('');
        setBusy(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      // On success the shell replaces this screen.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const erase = async () => {
    setBusy('erase');
    try {
      await wipeAll({ keepLock: false, markSeeded: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-ink-950 px-6 text-paper-50">
      <div className="w-full max-w-[380px]">
        <svg viewBox="0 0 120 48" className="h-12 w-[120px]" aria-hidden>
          <path
            d="M4 30 C 18 30, 22 12, 32 12 S 46 40, 58 40 S 74 16, 86 18 S 104 28, 116 26"
            fill="none"
            stroke="#e0aa4a"
            strokeWidth="2.25"
            strokeLinecap="round"
            pathLength={1}
            className="nr-draw"
          />
        </svg>
        <h1 className="mt-6 font-serif text-[1.85rem] leading-tight text-paper-50" style={{ fontVariationSettings: "'opsz' 36" }}>
          Your journal is locked
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-paper-300">Enter your passphrase to read and write on this device.</p>

        <form onSubmit={submit} className="mt-7" aria-label="Unlock journal">
          <label htmlFor="lock-pass" className="block text-[13px] text-paper-100">
            Passphrase
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              ref={inputRef}
              id="lock-pass"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'lock-error' : undefined}
              disabled={busy !== null}
              className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-[15px] text-paper-50 focus:border-ember-400 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!passphrase || busy !== null}
              className="rounded-lg bg-ember-400 px-4 text-[14px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-50"
            >
              {busy === 'unlock' ? 'Unlocking...' : 'Unlock'}
            </button>
          </div>
          <p id="lock-error" role="alert" className="mt-2 min-h-[20px] text-[13px] text-rose-300">
            {error ?? ''}
          </p>
        </form>

        <div className="mt-6 border-t border-ink-800 pt-4">
          {!forgot ? (
            <button type="button" onClick={() => setForgot(true)} className="text-[12.5px] text-paper-500 underline decoration-ink-600 underline-offset-2 hover:text-paper-100">
              Forgotten your passphrase?
            </button>
          ) : (
            <div className="nr-rise">
              <p className="text-[13px] leading-5 text-paper-300">
                Nobody can recover it, NeuroReflect included. If you kept an export, you can erase this journal and import the file afterwards. Type <span className="font-medium text-paper-100">erase</span> to confirm.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  aria-label="Type erase to confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-32 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-paper-50 focus:border-rose-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={erase}
                  disabled={confirmText.trim().toLowerCase() !== 'erase' || busy !== null}
                  className="rounded-lg bg-rose-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-rose-300 disabled:opacity-40"
                >
                  {busy === 'erase' ? 'Erasing...' : 'Erase this journal'}
                </button>
                <button type="button" onClick={() => setForgot(false)} className="rounded-lg px-3 py-2 text-[13px] text-paper-300 hover:bg-ink-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
