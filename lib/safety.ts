// Safety rails that sit outside every guidance level and never switch off.
// Everything here works offline and with no AI provider: the help contacts
// are plain data, and crisis signposting is a local phrase check whose result
// is never stored, scored or sent anywhere. It signposts; it does not assess.
//
// Contacts checked on 19 October 2026 against nhs.uk, gov.wales, NHS inform,
// nidirect, samaritans.org and giveusashout.org.

export interface HelpContact {
  id: string;
  name: string;
  /** What to dial or text, exactly as the person should enter it. */
  action: string;
  /** tel: or sms: link, for devices that can use one. */
  href: string;
  detail: string;
  region: 'uk' | 'england' | 'wales' | 'scotland' | 'ni' | 'anywhere';
}

export const EMERGENCY: HelpContact = {
  id: '999',
  name: 'Emergency services',
  action: 'Call 999',
  href: 'tel:999',
  detail: 'If you or someone else is in danger right now, call 999 or go to A&E.',
  region: 'uk',
};

export const HELP_CONTACTS: HelpContact[] = [
  {
    id: 'samaritans',
    name: 'Samaritans',
    action: 'Call 116 123',
    href: 'tel:116123',
    detail: 'Free from any phone, any time, day or night. Someone will listen, whatever you are going through.',
    region: 'uk',
  },
  {
    id: 'shout',
    name: 'Shout',
    action: 'Text SHOUT to 85258',
    href: 'sms:85258?&body=SHOUT',
    detail: 'Free, confidential text support, 24 hours a day, if talking out loud is too much.',
    region: 'uk',
  },
  {
    id: 'nhs111-england',
    name: 'NHS 111, England',
    action: 'Call 111, option 2',
    href: 'tel:111',
    detail: 'Urgent mental health support from the NHS, 24 hours a day.',
    region: 'england',
  },
  {
    id: 'nhs111-wales',
    name: 'NHS 111 Wales',
    action: 'Call 111, press 2',
    href: 'tel:111',
    detail: 'Urgent mental health support, 24 hours a day, for all ages.',
    region: 'wales',
  },
  {
    id: 'nhs24-scotland',
    name: 'NHS 24, Scotland',
    action: 'Call 111, mental health option',
    href: 'tel:111',
    detail: 'Connects you to the NHS 24 Mental Health Hub.',
    region: 'scotland',
  },
  {
    id: 'lifeline-ni',
    name: 'Lifeline, Northern Ireland',
    action: 'Call 0808 808 8000',
    href: 'tel:08088088000',
    detail: 'Free crisis support, 24 hours a day. Textphone 18001 0808 808 8000.',
    region: 'ni',
  },
];

export const OUTSIDE_UK =
  'Outside the UK, call your local emergency number. findahelpline.com lists free, confidential helplines in over 175 countries.';

// ---------- crisis signposting ----------

// Explicit phrases only. Words like "exhausted" or "can't face it" are left
// alone: signposting everyone who has a hard day would be patronising and
// would teach people to ignore it.
const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid(?:e|al)\b/,
  /\bkill(?:ing)? myself\b/,
  /\bend(?:ing)? (?:my|it all|my own) life\b/,
  /\bend(?:ing)? it all\b/,
  /\btake my (?:own )?life\b/,
  /\bwant(?:ed)? to die\b/,
  /\bwish i (?:was|were) dead\b/,
  /\bbetter off (?:dead|without me)\b/,
  /\bno (?:reason|point) (?:in )?(?:living|to live|being alive)\b/,
  /\b(?:don'?t|do not) want to (?:be alive|live any ?more|be here any ?more)\b/,
  /\bself[- ]harm(?:ing)?\b/,
  /\b(?:harm|hurt|cut|cutting|burn|burning) myself\b/,
  /\boverdos(?:e|ed|ing)\b/,
];

// "I don't want to die" or "I'm not suicidal" is not a crisis phrase.
const NEGATION_BEFORE = /\b(?:not|never|no longer|don'?t|do not|didn'?t|wouldn'?t|won'?t)\s+(?:\w+\s+){0,2}$/;
// Phrases that only need negating directly ("not suicidal") are covered by the
// lookbehind window; "don't want to be alive" is itself the crisis phrase.
const SELF_NEGATING = /^(?:don'?t|do not) want/;

function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * True when the text contains explicit crisis language about the writer.
 * The answer is used only to show help contacts; it is never stored.
 */
export function mentionsCrisis(text: string): boolean {
  const lower = normalise(text);
  for (const re of CRISIS_PATTERNS) {
    const global = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(lower)) !== null) {
      if (SELF_NEGATING.test(m[0])) return true;
      const before = lower.slice(Math.max(0, m.index - 28), m.index);
      if (!NEGATION_BEFORE.test(before)) return true;
    }
  }
  return false;
}
