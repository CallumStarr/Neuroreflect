'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Lock, ShieldCheck } from 'lucide-react';
import {
  AUTO_LOCK_CHOICES,
  AUTO_LOCK_DEFAULT,
  MIN_PASSPHRASE_LENGTH,
  changePassphrase,
  disableLock,
  enableLock,
  lockNow,
  readLockMeta,
  setAutoLockMinutes,
} from '@/lib/lock';
import { useLockState } from '../useLockState';
import { Message, Section, fieldCls, inputCls, primaryButton, quietButton } from './ui';

type Msg = { ok: boolean; text: string } | null;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function validate(pass: string, confirm: string): string | null {
  if (pass.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (pass !== confirm) return 'The two passphrases do not match.';
  return null;
}

export default function LockSection() {
  const lock = useLockState();
  const meta = useLiveQuery(() => readLockMeta(), [lock]);
  const [busy, setBusy] = useState<'enable' | 'change' | 'disable' | null>(null);
  const [message, setMessage] = useState<Msg>(null);

  // Turning on
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  // Changing
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [nextConfirm, setNextConfirm] = useState('');
  // Turning off
  const [offPass, setOffPass] = useState('');

  const turnOn = async () => {
    const problem = validate(pass, confirm) ?? (understood ? null : 'Tick the box to confirm you understand.');
    if (problem) return setMessage({ ok: false, text: problem });
    setBusy('enable');
    setMessage(null);
    try {
      await enableLock(pass, AUTO_LOCK_DEFAULT);
      setPass('');
      setConfirm('');
      setUnderstood(false);
      setMessage({ ok: true, text: `Encryption is on. The journal locks after ${AUTO_LOCK_DEFAULT} minutes without input, or when you choose Lock.` });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const change = async () => {
    const problem = validate(next, nextConfirm);
    if (problem) return setMessage({ ok: false, text: problem });
    setBusy('change');
    setMessage(null);
    try {
      await changePassphrase(current, next);
      setCurrent('');
      setNext('');
      setNextConfirm('');
      setMessage({ ok: true, text: 'Passphrase changed. Every record is now sealed with the new one.' });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const turnOff = async () => {
    setBusy('disable');
    setMessage(null);
    try {
      await disableLock(offPass);
      setOffPass('');
      setMessage({ ok: true, text: 'Encryption is off. Your journal is stored readable on this device again.' });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const enabledOn = meta?.enabledAt ? new Date(meta.enabledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <Section title="Passphrase lock" description="Encrypts your journal on this device. Anyone who opens NeuroReflect's storage without the passphrase sees only sealed data.">
      {lock === 'off' ? (
        <div className="space-y-4" data-testid="lock-off">
          <div className="grid gap-3 text-[13px] leading-5 text-paper-300 sm:grid-cols-2">
            <p>
              <span className="text-paper-100">Encrypted:</span> entry text and titles, co-pilot prompts, syntheses, people, themes, values, forecasts, scores, and settings including API keys.
            </p>
            <p>
              <span className="text-paper-100">Still readable:</span> dates, how many records there are, and which records link together. The browser needs these to sort and look things up.
            </p>
          </div>
          <div className="grid max-w-[560px] grid-cols-2 gap-3">
            <div>
              <label htmlFor="lock-new" className="text-[13px] text-paper-100">
                New passphrase
              </label>
              <input id="lock-new" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={`${fieldCls} mt-1`} />
            </div>
            <div>
              <label htmlFor="lock-confirm" className="text-[13px] text-paper-100">
                Type it again
              </label>
              <input id="lock-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${fieldCls} mt-1`} />
            </div>
          </div>
          <p className="text-[12px] text-paper-500">Longer is stronger: four or five unrelated words work well.</p>
          <label className="flex max-w-[560px] items-start gap-2 text-[12.5px] leading-5 text-paper-300">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 accent-[#e0aa4a]" />
            <span>I understand that nobody can recover a forgotten passphrase, and that an export is my backup.</span>
          </label>
          <button type="button" onClick={turnOn} disabled={busy !== null} className={`${primaryButton} inline-flex items-center gap-1.5`}>
            <Lock size={14} /> {busy === 'enable' ? 'Encrypting your journal...' : 'Turn on encryption'}
          </button>
          <Message value={message} />
        </div>
      ) : (
        <div className="space-y-5" data-testid="lock-on">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="inline-flex items-center gap-2 text-[14px] text-paper-50">
              <ShieldCheck size={17} className="text-sage-300" aria-hidden /> Encryption is on{enabledOn ? ` since ${enabledOn}` : ''}
            </p>
            <button type="button" onClick={() => void lockNow()} className={`${quietButton} inline-flex items-center gap-1.5 py-1.5`}>
              <Lock size={13} /> Lock now
            </button>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="lock-after" className="text-[13px] text-paper-100">
              Lock after
            </label>
            <select
              id="lock-after"
              value={meta?.autoLockMinutes ?? AUTO_LOCK_DEFAULT}
              onChange={(e) => void setAutoLockMinutes(Number(e.target.value))}
              className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-[13px] text-paper-50 focus:border-ember-400 focus:outline-none"
            >
              {AUTO_LOCK_CHOICES.map((c) => (
                <option key={c.minutes} value={c.minutes}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="text-[12.5px] text-paper-500">without typing, clicking or scrolling</span>
          </div>

          <details className="group max-w-[620px] rounded-xl border border-ink-800 bg-ink-900">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] text-paper-50">
              Change passphrase
              <ChevronDown size={16} className="text-paper-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-3 gap-3 border-t border-ink-800 px-4 py-4">
              <div>
                <label htmlFor="lock-cur" className="text-[12.5px] text-paper-100">
                  Current
                </label>
                <input id="lock-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={`${fieldCls} mt-1`} />
              </div>
              <div>
                <label htmlFor="lock-next" className="text-[12.5px] text-paper-100">
                  New
                </label>
                <input id="lock-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={`${fieldCls} mt-1`} />
              </div>
              <div>
                <label htmlFor="lock-next2" className="text-[12.5px] text-paper-100">
                  New, again
                </label>
                <input id="lock-next2" type="password" autoComplete="new-password" value={nextConfirm} onChange={(e) => setNextConfirm(e.target.value)} className={`${fieldCls} mt-1`} />
              </div>
              <div className="col-span-3">
                <button type="button" onClick={change} disabled={busy !== null || !current} className={primaryButton}>
                  {busy === 'change' ? 'Re-sealing...' : 'Change passphrase'}
                </button>
              </div>
            </div>
          </details>

          <details className="group max-w-[620px] rounded-xl border border-ink-800 bg-ink-900">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] text-paper-50">
              Turn off encryption
              <ChevronDown size={16} className="text-paper-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink-800 px-4 py-4">
              <p className="text-[12.5px] leading-5 text-paper-300">Every record is decrypted and stored readable on this device again. Enter your passphrase to confirm.</p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="password"
                  aria-label="Current passphrase"
                  autoComplete="current-password"
                  value={offPass}
                  onChange={(e) => setOffPass(e.target.value)}
                  className={`${inputCls} w-56`}
                />
                <button
                  type="button"
                  onClick={turnOff}
                  disabled={busy !== null || !offPass}
                  className="rounded-lg border border-rose-400/50 px-3 py-2 text-[13px] text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"
                >
                  {busy === 'disable' ? 'Decrypting...' : 'Turn off encryption'}
                </button>
              </div>
            </div>
          </details>
          <Message value={message} />
        </div>
      )}
    </Section>
  );
}
