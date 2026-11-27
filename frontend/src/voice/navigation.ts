// Natural-language exam navigation and answer actions beyond the contract's VoiceCommand:
//   "go back to question two", "question 3", "the second question"   -> goto
//   "move to the next question", "next one", "skip this question"      -> next
//   "go to the previous one", "back one"                               -> previous
//   "repeat that", "say that again", "what did you say"                -> repeatLast
//   "read the question again", "what was the question"                 -> repeatQuestion
//   "read the options", "what are the choices"                         -> readOptions
//   "how many questions are remaining", "where am I"                   -> progress
//   "read my previous answer", "what was my answer to question 2"      -> readAnswer
//   "is my answer saved", "have I answered this question"              -> answerStatus
//   "how much time is left"                                            -> time
//   "help", "what can I say"                                           -> help
//   "try again", "dictate again"                                       -> redictate
//   "save it", "yes", "keep it"                                        -> saveAnswer (UI: only when an answer awaits saving)
//   "option C", "I choose B", "select option 2"                        -> selectOption
//
// Safety: only NON-destructive actions get tolerant matching. Anything that
// commits or deletes (submit, confirm a submission, clear, discard) stays in
// the strict parsers (parseCommand / parseEditCommand). Negated requests return null.
//
// SCOPED ADAPTER (pending lead approval): contracts/types.ts VoiceCommand has no
// type for these, so they live here. The UI calls parseNavigation(text) first and
// falls back to parseCommand(text). English only (demo). Never used in dictation mode.

import type { Question } from '../../../contracts/types';
import { normalizeText, tokenize } from './normalize';

export type NavigationCommand =
  | { type: 'goto'; question: number } // 1-based; -1 = final question
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'repeatLast' }
  | { type: 'repeatQuestion' }
  | { type: 'readOptions' }
  | { type: 'progress' }
  | { type: 'readAnswer'; question?: number } // omitted = current question
  | { type: 'answerStatus' }
  | { type: 'time' }
  | { type: 'help' }
  | { type: 'redictate' }
  | { type: 'saveAnswer' }
  | { type: 'selectOption'; choice: string | number }; // letter ('c') or 1-based number

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
/** Spoken letter names for option letters. */
const LETTERS: Record<string, string> = {
  a: 'a', ay: 'a', eh: 'a', b: 'b', be: 'b', bee: 'b', c: 'c', see: 'c', sea: 'c', si: 'c', d: 'd', dee: 'd',
  e: 'e', f: 'f', ef: 'f', g: 'g', gee: 'g', h: 'h',
};

const FILLERS = new Set(['please', 'ok', 'okay', 'um', 'uh', 'so', 'now', 'just', 'can', 'could', 'would', 'you', 'lets', 'like']);
const NEGATIONS = new Set(['not', 'dont', 'never', 'cant', 'wont', 'no', 'without']);
/** Harmless words that may surround a navigation request. */
const POLITE = new Set([
  'i', 'want', 'wanna', 'to', 'the', 'a', 'go', 'move', 'take', 'me', 'on', 'onto', 'one', 'question', 'this',
  'let', 'us', 'please', 'now', 'lets', 'can', 'you', 'could', 'would', 'like', 'id',
]);
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
const only = (tokens: string[], ...allowed: string[]) => tokens.every((t) => POLITE.has(t) || allowed.includes(t));
const any = (tokens: string[], ...words: string[]) => tokens.some((t) => words.includes(t));

const SAVE_PHRASES = new Set([
  'yes', 'yes please', 'yeah', 'yep', 'yes save it', 'save it', 'save this', 'save that', 'save my answer',
  'save this answer', 'keep it', 'keep that', 'that is correct', 'thats correct', 'correct', 'thats right',
  'that is right', 'yes thats right', 'yes that is right', 'yes correct', 'yes save', 'save it please',
]);

/** "option C", "I choose B", "select option 2", "the answer is option D". */
function parseOptionChoice(tokens: string[]): string | number | null {
  const lead = [
    ['option'], ['choice'], ['choose'], ['select'], ['pick'], ['answer'], ['i', 'choose'], ['i', 'pick'], ['i', 'select'],
    ['my', 'answer', 'is'], ['the', 'answer', 'is'], ['i', 'think', 'its'], ['its'],
  ];
  for (const l of lead) {
    if (!l.every((w, i) => tokens[i] === w)) continue;
    let rest = tokens.slice(l.length);
    if (rest[0] === 'option' || rest[0] === 'letter' || rest[0] === 'choice' || rest[0] === 'number') rest = rest.slice(1);
    if (rest.length !== 1) continue;
    // A bare "answer"/"its" lead needs the word "option" to avoid catching dictation-like phrases.
    if ((l.join(' ') === 'answer' || l.join(' ') === 'its') && tokens[l.length] !== 'option') continue;
    const t = rest[0];
    if (t in LETTERS) return LETTERS[t];
    const n = questionNumber(t, false);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Recognise a navigation or answer-action request in command mode, or return
 * null so the caller falls back to parseCommand(). Negated requests return null.
 */
export function parseNavigation(text: string): NavigationCommand | null {
  const all = tokenize(normalizeText(text));
  const tokens = all.filter((t) => !FILLERS.has(t));
  if (!tokens.length || tokens.some((t) => NEGATIONS.has(t))) return null;
  const s = ` ${tokens.join(' ')} `;
  const joined = tokens.join(' ');
  /** Unfiltered text, for phrases that contain filler words ("what can I say", "what did you say"). */
  const raw = ` ${all.join(' ')} `;

  // --- save the answer just read back (UI applies it only when an answer awaits saving) ---
  if (SAVE_PHRASES.has(joined)) return { type: 'saveAnswer' };

  // --- choose a multiple-choice option ---
  const choice = parseOptionChoice(tokens);
  if (choice !== null) return { type: 'selectOption', choice };

  // --- read the student's own saved answer ---
  // Needs "my"/"I", so "what is the answer" (a solution request) never matches,
  // and anything asking for judgement ("is my answer correct") is left to the refusal path.
  const aboutOwnAnswer = has(s, / (my|i) /) && has(s, / answers? /) && !has(s, / (correct|right|wrong|check|verify) /);
  const readVerb = has(s, / (read|repeat|say|tell|hear|what|whats|replay) /);
  if (aboutOwnAnswer && readVerb && !has(s, / (dictate|record|change|edit|new) /) && !/^(is|was|has|have|did)\b/.test(joined)) {
    const q = numberedQuestion(tokens);
    return q !== null ? { type: 'readAnswer', question: q } : { type: 'readAnswer' };
  }

  // --- is my answer saved? ---
  if (
    /^(is|was|has|have|did|does|am)\b/.test(joined) &&
    has(s, / (saved|save|answered|recorded|stored) /) &&
    !has(s, / (correct|right|wrong) /)
  ) {
    return { type: 'answerStatus' };
  }

  // --- remaining time (answered only from authoritative exam data) ---
  if (has(s, / time /) && has(s, / (left|remaining|much|is it|have i|do i have) /)) return { type: 'time' };
  if (has(raw, / how (long|much longer) (do|have|can) i /)) return { type: 'time' };

  // --- help ---
  if (
    any(tokens, 'help', 'commands', 'command', 'instructions') && only(tokens, 'help', 'commands', 'command', 'instructions', 'what', 'are', 'list', 'of', 'say', 'the', 'give', 'need', 'some') ||
    has(raw, / what can i (say|do) /) || has(raw, / how does this work /) || joined === 'im lost'
  ) {
    return { type: 'help' };
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

  // --- read options ---
  if (any(tokens, 'options', 'choices') && only(tokens, 'options', 'choices', 'read', 'repeat', 'say', 'list', 'what', 'are', 'the', 'my', 'again', 'all', 'tell')) {
    return { type: 'readOptions' };
  }

  // --- re-read the question ---
  if (
    any(tokens, 'question') &&
    any(tokens, 'read', 'repeat', 'again', 'what', 'say') &&
    only(tokens, 'read', 'repeat', 'again', 'what', 'was', 'is', 'current', 'say', 'that', 'it', 'out', 'whole')
  ) {
    return { type: 'repeatQuestion' };
  }

  // --- repeat the last message ---
  if (
    (any(tokens, 'repeat', 'again', 'pardon', 'sorry') || has(raw, / what (did you say|was that) /) || has(s, / one more time /)) &&
    only(tokens, 'repeat', 'that', 'say', 'again', 'come', 'pardon', 'sorry', 'what', 'did', 'was', 'more', 'time', 'it', 'last', 'bit', 'message')
  ) {
    return { type: 'repeatLast' };
  }

  // --- dictate the answer again (non-destructive: the old draft stays undoable) ---
  if (
    (has(s, / try (it )?again /) || has(s, / (dictate|record|say) (it |my answer |the answer )?again /) || any(tokens, 'redo', 'rerecord') ||
      has(s, / start (the answer )?again /)) &&
    only(tokens, 'try', 'it', 'again', 'dictate', 'record', 'say', 'my', 'answer', 'the', 'redo', 'rerecord', 'start', 'that')
  ) {
    return { type: 'redictate' };
  }

  // --- next / previous (tolerant: harmless and easily undone) ---
  const NEXT = ['next', 'forward', 'ahead', 'skip', 'onward', 'onwards'];
  if ((any(tokens, ...NEXT) || has(s, / move on /)) && only(tokens, ...NEXT)) return { type: 'next' };
  const PREV = ['previous', 'back', 'prior', 'before', 'last'];
  if (any(tokens, 'previous', 'back', 'prior') && only(tokens, ...PREV)) return { type: 'previous' };

  return null;
}

/**
 * Index of the option a choice refers to, or null. A letter matches the option
 * label ("c" -> "C. 17"). A number first matches an option's own text
 * ("17" -> "C. 17"), otherwise its position ("2" -> the second option).
 */
export function matchOption(question: Question | undefined, choice: string | number): number | null {
  if (!question || question.type !== 'mcq' || !question.options.length) return null;
  if (typeof choice === 'number') {
    const byText = question.options.findIndex((o) => o.replace(/^\s*\(?[A-Za-z][).:]\s*/, '').trim() === String(choice));
    if (byText >= 0) return byText;
    return choice >= 1 && choice <= question.options.length ? choice - 1 : null;
  }
  const idx = question.options.findIndex((o) => {
    const m = /^\s*\(?([A-Za-z])[).:\s]/.exec(o);
    return m !== null && m[1].toLowerCase() === choice.toLowerCase();
  });
  return idx >= 0 ? idx : null;
}
