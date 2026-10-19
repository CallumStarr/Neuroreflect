// Original word lists authored for NeuroReflect. They are deliberately small and
// transparent: every term that moves a metric can be read here. Entries ending in
// '*' match any word starting with that stem.

export const FIRST_PERSON_SINGULAR = ['i', 'me', 'my', 'mine', 'myself', "i'm", "i've", "i'd", "i'll"];

export const NEGATIVE_AFFECT = [
  'afraid', 'alone', 'angry', 'anguish*', 'annoyed', 'anxious', 'anxiety', 'ashamed', 'awful',
  'bad', 'bitter*', 'broken', 'burnt', 'burned', 'crap', 'cried', 'cry', 'crying', 'cruel',
  'defeated', 'depress*', 'despair*', 'desperate', 'devastat*', 'disappoint*', 'disaster', 'disgust*',
  'dread*', 'drained', 'dreadful', 'embarrass*', 'empty', 'exhausted', 'fail*', 'fear*', 'frantic',
  'frustrat*', 'furious', 'grief', 'grim', 'guilt*', 'hate*', 'heartbroken', 'helpless', 'hopeless*',
  'horrible', 'hostile', 'humiliat*', 'hurt*', 'idiot*', 'inadequate', 'insecure', 'irritat*',
  'jealous*', 'lonely', 'loser', 'lost', 'mess', 'miserable', 'misery', 'mortified', 'nervous',
  'numb', 'overwhelm*', 'pain*', 'panic*', 'pathetic', 'pointless', 'regret*', 'rejected', 'resent*',
  'ruin*', 'sad', 'sadness', 'scared', 'shame*', 'sick', 'sorrow*', 'stressed', 'stress', 'stuck',
  'stupid', 'suffer*', 'tense', 'terrible', 'terrified', 'threat*', 'tired', 'trapped', 'ugly',
  'unbearable', 'uneasy', 'unhappy', 'upset', 'useless', 'weak', 'weary', 'worried', 'worry*',
  'worse', 'worst', 'worthless', 'wrong',
];

export const POSITIVE_AFFECT = [
  'accomplish*', 'alive', 'amused', 'appreciat*', 'brave', 'calm*', 'capable', 'cheer*', 'comfort*',
  'confident', 'connected', 'content', 'curious', 'delight*', 'eager', 'energi*', 'enjoy*',
  'excit*', 'fun', 'glad', 'good', 'grateful', 'great', 'happy', 'happiness', 'hope', 'hopeful',
  'inspired', 'joy*', 'kind*', 'laugh*', 'light', 'lovely', 'love*', 'motivated', 'optimis*',
  'peace*', 'playful', 'pleased', 'proud', 'refreshed', 'relax*', 'relief', 'relieved', 'rested',
  'safe', 'satisf*', 'secure', 'steady', 'strong', 'thank*', 'thrill*', 'warm*', 'wonderful',
];

// Causal, insight and tentative markers: the language of making sense of things.
export const COGNITIVE_PROCESSING = [
  'because', 'since', 'therefore', 'hence', 'thus', 'reason*', 'cause*', 'caused', 'realis*', 'realiz*',
  'understand*', 'understood', 'perspective', 'although', 'though', 'whereas', 'however', 'could',
  'might', 'perhaps', 'maybe', 'learn*', 'notice*', 'meaning*', 'means', 'consider*', 'wonder*',
  'insight*', 'figure*', 'explain*', 'suppose', 'probably', 'possibly', 'pattern*', 'reflect*',
  'curious', 'question*', 'differently', 'alternativ*', 'balance*',
];
export const COGNITIVE_PHRASES = ['makes sense', 'so that', 'in hindsight', 'looking back', 'on the other hand'];

// Experiential avoidance: escaping, numbing or suppressing an internal state.
export const AVOIDANCE_PHRASES = [
  'avoid', 'avoided', 'avoiding', 'put it off', 'put off', 'putting off', 'procrastinat',
  'distract', 'scrolled', 'scrolling', 'doomscroll', 'numb myself', 'numbed', 'ignored it',
  'ignore it', 'push it down', 'pushed it down', 'bottle it', 'bottled', "didn't want to think",
  "don't want to think", 'rather not think', 'escape', 'binge', 'kept myself busy', 'keep busy',
  'pretend', 'pretended', 'shut down', 'shut off', 'suppress', 'stayed in bed', 'cancelled',
  'skipped', 'hid from', 'hiding from', 'zoned out', 'switched off', 'drank to', 'just to forget',
];

// Low-granularity affect labels (Feldman Barrett): broad, undifferentiated words.
export const COARSE_LABELS = [
  'stressed', 'fine', 'bad', 'annoyed', 'good', 'okay', 'ok', 'upset', 'sad', 'happy', 'angry',
  'tired', 'meh', 'off', 'down', 'great', 'awful', 'terrible',
];

export interface EmotionFamily {
  id: string;
  label: string;
  hue: 'ember' | 'rose' | 'dusk' | 'sage' | 'paper';
  terms: string[];
}

// Affective differentiation wheel. Terms are fine-grained concepts, including
// interoceptive ones. Families are an original grouping for this app.
export const EMOTION_FAMILIES: EmotionFamily[] = [
  {
    id: 'threat',
    label: 'Threat',
    hue: 'ember',
    terms: [
      'anticipatory dread', 'apprehension', 'unease', 'foreboding', 'jitteriness', 'performance anxiety',
      'social anxiety', 'vigilance', 'tight chest', 'restless stomach',
    ],
  },
  {
    id: 'overload',
    label: 'Overload',
    hue: 'ember',
    terms: [
      'cognitive overload', 'decision fatigue', 'scatteredness', 'time pressure', 'overstimulation',
      'mental fog', 'depletion', 'brittleness',
    ],
  },
  {
    id: 'friction',
    label: 'Friction',
    hue: 'rose',
    terms: [
      'boundary resentment', 'indignation', 'exasperation', 'irritability', 'contempt', 'defensiveness',
      'righteous anger', 'impatience', 'jaw tension',
    ],
  },
  {
    id: 'loss',
    label: 'Loss',
    hue: 'dusk',
    terms: [
      'grief', 'wistfulness', 'disappointment', 'loneliness', 'homesickness', 'melancholy', 'emptiness',
      'heaviness', 'disillusionment',
    ],
  },
  {
    id: 'self',
    label: 'Self-conscious',
    hue: 'dusk',
    terms: [
      'shame', 'guilt', 'embarrassment', 'inadequacy', 'self-doubt', 'exposure', 'regret', 'imposter feeling',
    ],
  },
  {
    id: 'flat',
    label: 'Flat',
    hue: 'paper',
    terms: [
      'under-stimulated restlessness', 'boredom', 'apathy', 'numbness', 'listlessness', 'ennui',
      'disconnection', 'low energy',
    ],
  },
  {
    id: 'warmth',
    label: 'Warmth',
    hue: 'sage',
    terms: [
      'tenderness', 'belonging', 'gratitude', 'affection', 'compassion', 'being understood', 'trust',
      'quiet contentment',
    ],
  },
  {
    id: 'vitality',
    label: 'Vitality',
    hue: 'sage',
    terms: [
      'anticipation', 'eagerness', 'flow', 'pride', 'relief', 'awe', 'playfulness', 'groundedness',
      'momentum', 'curiosity',
    ],
  },
];

// Which families to offer first when a coarse label is found.
export const COARSE_TO_FAMILIES: Record<string, string[]> = {
  stressed: ['threat', 'overload', 'friction'],
  fine: ['flat', 'warmth', 'self'],
  bad: ['self', 'loss', 'threat'],
  annoyed: ['friction', 'overload'],
  good: ['warmth', 'vitality'],
  okay: ['flat', 'warmth'],
  ok: ['flat', 'warmth'],
  upset: ['loss', 'friction', 'self'],
  sad: ['loss', 'self'],
  happy: ['vitality', 'warmth'],
  angry: ['friction'],
  tired: ['overload', 'flat'],
  meh: ['flat'],
  off: ['flat', 'threat'],
  down: ['loss', 'flat'],
  great: ['vitality', 'warmth'],
  awful: ['loss', 'self', 'threat'],
  terrible: ['self', 'loss', 'threat'],
};

export const FINE_LABELS: string[] = EMOTION_FAMILIES.flatMap((f) => f.terms);

// Cognitive fusion patterns. Each has a type used for distortion nodes and reframes.
export type FusionPattern = 'absolutist' | 'overgeneralise' | 'catastrophise' | 'mind_read';

// Order matters: earlier rules claim overlapping text first, so the more specific
// mind-reading pattern runs before the global self-label it often contains.
export const FUSION_RULES: { pattern: FusionPattern; regex: RegExp }[] = [
  {
    pattern: 'mind_read',
    regex: /\b(?:they|everyone|everybody|she|he|people) (?:all )?(?:must |probably |definitely )?(?:think|thinks|hate|hates|judge|judges|see|sees) (?:me|i'm|i am)(?: (?:a |an |so |such )?[a-z']+)?/gi,
  },
  {
    pattern: 'overgeneralise',
    regex: /\bi(?:'m| am) (?:such )?(?:a |an )?(?:total |complete |utter )?(?:failure|useless|worthless|hopeless|stupid|idiot|loser|mess|disaster|fraud|burden|broken)\b/gi,
  },
  {
    pattern: 'overgeneralise',
    regex: /\bi (?:can't|cannot|never) do anything right\b|\bi ruin everything\b|\bi always mess (?:it|things|everything) up\b/gi,
  },
  {
    pattern: 'catastrophise',
    regex: /\b(?:everything is|it's all|it is all|my life is|this is) (?:ruined|over|falling apart|a disaster|hopeless|pointless)\b|\b(?:i can't|i cannot) cope\b|\bthe worst thing\b|\bend of the world\b/gi,
  },
  {
    pattern: 'absolutist',
    regex: /\b(?:i|they|he|she|everyone|nobody|no one|people|it|things|this) (?:always|never) [a-z']+(?: [a-z']+)?/gi,
  },
  {
    pattern: 'absolutist',
    regex: /\b(?:nothing ever|everything always|nobody ever|no one ever|nothing will ever|nothing i do)\b[a-z' ]{0,24}/gi,
  },
];

// Metacognitive, defused framing.
export const DEFUSION_PHRASES = [
  "i'm noticing", 'i notice', 'i noticed', 'the thought that', "i'm having the thought", 'i am having the thought',
  'my mind is telling me', 'my mind says', 'part of me', 'a story that', 'the story that', 'i can observe',
  "i'm aware that", 'i am aware that', 'a feeling of', 'the urge to',
];

// Words that pull an entry toward a theme node when no explicit #tag is present.
export const THEME_KEYWORDS: Record<string, string[]> = {
  Work: ['work', 'job', 'boss', 'manager', 'deadline', 'meeting', 'office', 'project', 'presentation', 'colleague', 'client', 'shift'],
  Sleep: ['sleep', 'slept', 'insomnia', 'tired', 'exhausted', 'nap', 'awake', 'bed'],
  Health: ['run', 'gym', 'walk', 'exercise', 'doctor', 'ate', 'eating', 'body', 'headache', 'workout'],
  Money: ['money', 'rent', 'bills', 'debt', 'pay', 'salary', 'budget', 'savings'],
  Family: ['mum', 'mom', 'dad', 'sister', 'brother', 'family', 'parents', 'son', 'daughter', 'kids'],
  Relationships: ['partner', 'boyfriend', 'girlfriend', 'husband', 'wife', 'date', 'relationship', 'friend', 'friends'],
  Creativity: ['write', 'writing', 'draw', 'paint', 'music', 'guitar', 'create', 'design', 'build', 'making'],
  Study: ['study', 'exam', 'essay', 'lecture', 'dissertation', 'university', 'course', 'revision'],
};

export const RELATIONAL_PEOPLE = [
  'mum', 'mom', 'dad', 'partner', 'boss', 'manager', 'sister', 'brother', 'son', 'daughter', 'wife',
  'husband', 'therapist', 'friend', 'colleague', 'grandma', 'grandad',
];

// Approach vs avoidance verbs for heuristic values alignment.
export const APPROACH_MARKERS = [
  'did', 'made', 'went', 'practised', 'practiced', 'chose', 'choose', 'spent time', 'finished', 'helped',
  'showed up', 'started', 'kept', 'called', 'told', 'asked', 'tried', 'shared', 'committed', 'completed',
  'wrote', 'ran', 'cooked', 'listened', 'spoke up', 'said no', 'rested',
];
export const DRIFT_MARKERS = [
  "didn't", 'did not', 'skipped', 'avoided', 'put off', 'cancelled', 'neglected', 'no time', "couldn't",
  'forgot', 'ignored', 'lied', 'hid', 'gave up', 'stayed quiet', 'pretended', "haven't", 'missed',
];

// Seeds for matching a user's core value against entry text.
export const VALUE_SYNONYMS: Record<string, string[]> = {
  growth: ['learn', 'learning', 'grow', 'growth', 'practise', 'practice', 'improve', 'skill', 'challenge', 'study', 'progress'],
  connection: ['friend', 'partner', 'family', 'call', 'together', 'talked', 'connect', 'mum', 'dad', 'sam', 'listen', 'hug'],
  honesty: ['honest', 'truth', 'told', 'admit', 'lied', 'pretend', 'said no', 'spoke up', 'open'],
  health: ['sleep', 'run', 'walk', 'gym', 'ate', 'water', 'rest', 'exercise', 'cook', 'body', 'yoga'],
  creativity: ['write', 'draw', 'music', 'make', 'create', 'build', 'design', 'play'],
  courage: ['brave', 'scared', 'tried', 'risk', 'asked', 'spoke up', 'faced'],
  calm: ['calm', 'breathe', 'slow', 'rest', 'quiet', 'meditate', 'meditation'],
  kindness: ['kind', 'help', 'helped', 'care', 'gentle', 'thank'],
};

export const FUTURE_EVENT_CUES =
  /\b(tomorrow|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (?:weekend|friday)|coming up|upcoming|interview|presentation|exam|appointment|deadline|viva|meeting with|first day)\b/i;
