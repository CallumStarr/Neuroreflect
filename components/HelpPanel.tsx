'use client';

import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { EMERGENCY, HELP_CONTACTS, OUTSIDE_UK, type HelpContact } from '@/lib/safety';
import Dialog from './ui/Dialog';

// Help that never depends on an AI provider, a connection or the journal being
// unlocked. Phone and text links only work on devices that can call or text,
// so on a computer the number itself is what matters.

function useCanCall(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  }, []);
  return can;
}

function ContactRow({ c, canCall, strong }: { c: HelpContact; canCall: boolean; strong?: boolean }) {
  const action = canCall ? (
    <a href={c.href} className={`font-medium underline decoration-ink-600 underline-offset-2 ${strong ? 'text-rose-300' : 'text-paper-50'}`}>
      {c.action}
    </a>
  ) : (
    <span className={`font-medium ${strong ? 'text-rose-300' : 'text-paper-50'}`}>{c.action}</span>
  );
  return (
    <li className="py-2.5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
        <span className="text-paper-100">{c.name}</span>
        <span className="nr-num text-[15px]">{action}</span>
      </p>
      <p className="mt-0.5 text-[12.5px] leading-5 text-paper-500">{c.detail}</p>
    </li>
  );
}

export function HelpContacts({ compact }: { compact?: boolean }) {
  const canCall = useCanCall();
  const nations = HELP_CONTACTS.filter((c) => c.region !== 'uk');
  const uk = HELP_CONTACTS.filter((c) => c.region === 'uk');
  return (
    <div>
      <div className="rounded-xl border border-rose-400/40 bg-rose-400/[0.08] px-4">
        <ul>
          <ContactRow c={EMERGENCY} canCall={canCall} strong />
        </ul>
      </div>
      <ul className="mt-3 divide-y divide-ink-800">
        {uk.map((c) => (
          <ContactRow key={c.id} c={c} canCall={canCall} />
        ))}
      </ul>
      {!compact && (
        <>
          <p className="mt-4 text-[12px] font-medium text-paper-300">Urgent mental health support from the NHS</p>
          <ul className="divide-y divide-ink-800">
            {nations.map((c) => (
              <ContactRow key={c.id} c={c} canCall={canCall} />
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-[12.5px] leading-5 text-paper-500">{OUTSIDE_UK}</p>
    </div>
  );
}

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      label="Help now"
      urgent
      width="w-[480px]"
      title={
        <span className="flex items-center gap-2">
          <LifeBuoy size={18} className="text-rose-300" /> Help now
        </span>
      }
      description="If things feel like too much, you don't have to deal with it alone. These are free, and none of them need this app."
      onClose={onClose}
    >
      <HelpContacts />
      <p className="mt-4 border-t border-ink-800 pt-3 text-[12px] leading-5 text-paper-500">
        NeuroReflect is a journal, not a health service, and nothing in it is a substitute for talking to someone. Nothing you write is sent anywhere unless you set up an AI provider.
      </p>
    </Dialog>
  );
}
