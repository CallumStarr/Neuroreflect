// Every word a nudge can say, in one file, so the wellbeing wording review
// covers all of them. Nudges name what is waiting, never what was lost or
// noticed: no "Don't lose your progress", no "We noticed something", no
// feelings or conditions. Event names appear only if the person turns that on.

export interface NudgeText {
  title: string;
  body: string;
}

/** Shown while the journal is locked, or whenever the text could say something personal. */
export const NUDGE_LOCKED: NudgeText = { title: 'Your writing time', body: 'NeuroReflect is ready when you are.' };

export const NUDGE_PLAIN: NudgeText = { title: 'Your writing time', body: 'A few minutes now, if you have them.' };

/** After an entry that circled: nothing that reopens a topic. */
export const NUDGE_NEUTRAL: NudgeText = { title: 'Your writing time', body: 'A fresh page is ready whenever you want it.' };

export function nudgeQuestion(question: string): NudgeText {
  return { title: "Today's question", body: question };
}

export const NUDGE_REALITY_CHECK: NudgeText = {
  title: 'A reality check is ready',
  body: 'A day you made a forecast for has passed. See how it compared.',
};

export function nudgeAfterEvent(eventName: string | null): NudgeText {
  return eventName
    ? { title: 'How did it go?', body: `How did ${eventName} go?` }
    : { title: 'How did it go?', body: 'Something you planned has happened. How did it go?' };
}

export const NUDGE_NEXT_QUESTION: NudgeText = { title: 'You left yourself a question', body: 'Pick up where you left off.' };

export function nudgeWeek(entries: number): NudgeText {
  return {
    title: 'Your week is ready',
    body: entries === 1 ? '1 entry this week. Your chapter is ready to read.' : `${entries} entries this week. Your chapter is ready to read.`,
  };
}

// In-app wording around the nudge.
export const NUDGE_BACKOFF_OFFER = {
  title: 'Your nudge has paused',
  body: "The last three nudges didn't seem to fit your day, so it has stopped rather than nag. Move it to a better time, pause it for a while, or keep it as it is.",
};

export const NUDGE_FADE_OFFER = {
  title: 'You have been writing before your nudge',
  body: 'For three weeks now, your writing has come before the nudge did. Writing time may be becoming a habit of its own. Switch the nudge off, keep it for your review day only, or leave it as it is.',
};
