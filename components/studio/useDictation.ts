'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typing for the Web Speech API, which TypeScript's DOM lib omits.
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => setSupported(getCtor() !== null), []);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current(r[0].transcript.trim());
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech') return;
      setError(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the address bar to dictate.' : `Dictation stopped (${e.error}).`);
      wantRef.current = false;
    };
    rec.onend = () => {
      // Browsers end sessions after silence; keep going while the user wants it.
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      } else {
        setListening(false);
        setInterim('');
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    rec.start();
    setListening(true);
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  return { supported, listening, interim, error, start, stop };
}
