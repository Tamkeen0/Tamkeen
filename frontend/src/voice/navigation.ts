// Voice-guided exam navigation beyond the contract's VoiceCommand:
//   "go back to question two", "question 3", "the second question" -> goto
//   "how many questions are remaining", "where am I"                -> progress
//   "read my previous answer", "what was my answer to question 2"   -> readAnswer
//
// SCOPED ADAPTER (pending lead approval): contracts/types.ts VoiceCommand has no
// type for these, so they live here instead of in parseCommand(). The UI calls
// parseNavigation(text) first and falls back to parseCommand(text). Proposed
// contract addition is in README.md ("Contract requests").
//
// English only (demo language). Deterministic; never used in dictation mode.

import { normalizeText, tokenize } from './normalize';

export type NavigationCommand =
  | { type: 'goto'; question: number } // 1-based; -1 = final question
  | { type: 'progress' }
  | { type: 'readAnswer'; question?: number }; // omitted = current question

const NUMBERS: Record<string, number> = {
  one: 1, won: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
// Only after "question": Chrome often hears "question two" as "question to/too" and "four" as "for".
const AFTER_QUESTION_HOMOPHONES: Record<string, number> = { to: 2, too: 2, for: 4 };
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, final: -1,
};

const FILLERS = new Set(['please', 'ok', 'okay', 'um', 'uh', 'so', 'now', 'just', 'can', 'could', 'would', 'you', 'lets', 'like']);
const NEGATIONS = new Set(['not', 'dont', 'never', 'cant', 'wont', 'no']);
/** Words allowed around a "question N" jump; anything else means it is not a pure jump. */
const GOTO_WORDS = new Set([
  'go', 'jump', 'move', 'skip', 'switch', 'open', 'take', 'me', 'back', 'return', 'to', 'the', 'question', 'number',
  'read', 'show', 'i', 'want', 'need',
]);
const QUESTION_WORDS = new Set(['question', 'number']);

function questionNumber(token: string | undefined, afterQuestionWord: boolean): number | null {
  if (token === undefined) return null;
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (token in NUMBERS) return NUMBERS[token];
  if (afterQuestionWord && token in AFTER_QUESTION_HOMOPHONES) return AFTER_QUESTION_HOMOPHONES[token];
  return null;
}

/** "question two" / "number 3" anywhere in the tokens. */
function numberedQuestion(tokens: string[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!QUESTION_WORDS.has(tokens[i])) continue;
    const n = questionNumber(tokens[i + 1], true);
    if (n !== null) return n;
  }
  return null;
}

const has = (s: string, re: RegExp) => re.test(s);

/**
 * Recognise a navigation request in command mode, or return null so the
 * caller falls back to parseCommand(). Negated requests return null.
 */
export function parseNavigation(text: string): NavigationCommand | null {
  const tokens = tokenize(normalizeText(text)).filter((t) => !FILLERS.has(t));
  if (!tokens.length || tokens.some((t) => NEGATIONS.has(t))) return null;
  const s = ` ${tokens.join(' ')} `;

  // --- read the student's own saved answer ---
  // Needs "my"/"I" so "what is the answer" (a solution request) never matches,
  // and anything asking for judgement ("is my answer correct") is left to the refusal path.
  const aboutOwnAnswer = has(s, / (my|i) /) && has(s, / answers? /) && !has(s, / (correct|right|wrong|check|verify) /);
  const readVerb = has(s, / (read|repeat|say|tell|hear|what|whats|replay) /);
  if (aboutOwnAnswer && readVerb && !has(s, / (dictate|record|change|edit|new) /)) {
    const q = numberedQuestion(tokens);
    return q !== null ? { type: 'readAnswer', question: q } : { type: 'readAnswer' };
  }

  // --- progress ---
  if (
    has(s, / how many (questions? )?(are )?(remaining|left) /) ||
    has(s, / how many questions /) ||
    has(s, / questions? (remaining|left) /) ||
    has(s, / where am i /) ||
    has(s, / (which|what) question (am i on|is this|are we on) /) ||
    has(s, / how many (have|did) i answer(ed)? /) ||
    has(s, / (how many )?unanswered( questions?)? /) ||
    has(s, / (my )?progress /)
  ) {
    return { type: 'progress' };
  }

  // --- jump to a question ---
  const onlyGotoWords = (extra: Set<string>) => tokens.every((t) => GOTO_WORDS.has(t) || extra.has(t));
  const n = numberedQuestion(tokens);
  if (n !== null) {
    const numberToken = tokens[tokens.findIndex((t) => QUESTION_WORDS.has(t)) + 1];
    if (onlyGotoWords(new Set([numberToken]))) return { type: 'goto', question: n };
    return null;
  }
  // "the second question", "go to the final question"
  for (let i = 0; i + 1 < tokens.length; i++) {
    const ord = ORDINALS[tokens[i]];
    if (ord !== undefined && tokens[i + 1] === 'question' && onlyGotoWords(new Set([tokens[i]]))) {
      return { type: 'goto', question: ord };
    }
  }
  return null;
}
