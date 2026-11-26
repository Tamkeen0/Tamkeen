// Standard spoken prompts for the student flow, so the UI and the tests use
// the same wording. English only (demo language). Every prompt says what the
// student can do next, so no state is a silent dead end.
//
// Question text comes from the professor-approved `accessible_text` and is
// spoken verbatim. Dictated answers are read back with readBackText(); the
// stored answer stays literal.

import type { Question } from '../../../contracts/types';
import { VoiceError } from './errors';
import { readBackText } from './readback';

export const COMMAND_SUMMARY =
  'Commands: next, previous, repeat, answer, explore followed by a question about the diagram, and submit.';

const KEYBOARD_HINT = 'You can continue with the keyboard: type commands such as next, answer, or submit.';

function sentence(text: string): string {
  const t = String(text ?? '').trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Read a question: number, approved accessible text, options, diagram hint, how to answer. */
export function questionSpeech(q: Question, index: number, total: number): string {
  const parts = [`Question ${index + 1} of ${total}.`, sentence(q.accessible_text)];
  if (q.type === 'mcq' && q.options.length) parts.push(`Options: ${q.options.join('; ')}.`);
  if (q.diagram) parts.push('This question has a circuit diagram. Say explore, then your question, for example: explore R1.');
  parts.push('Say answer to dictate your answer.');
  return parts.join(' ');
}

export const prompts = {
  dictationStart: 'Dictate your answer now.',
  readBack: (literal: string) =>
    `You said: ${readBackText(literal)}. Say confirm to save, answer to try again, or cancel.`,
  confirmAnswerReminder: 'Say confirm to save this answer, answer to try again, or cancel.',
  saved: (index: number) => `Answer saved for question ${index + 1}.`,
  answerCancelled: 'Cancelled. Your saved answer is unchanged.',
  notUnderstood: `Sorry, I did not understand. ${COMMAND_SUMMARY}`,
  firstQuestion: 'This is the first question.',
  lastQuestion: 'This is the last question. Say submit when you are ready.',
  nothingToConfirm: 'There is nothing to confirm. Say answer to dictate an answer.',
  nothingToCancel: 'There is nothing to cancel.',
  submitConfirm: (answered: number, total: number) =>
    `You answered ${answered} of ${total} questions. Say confirm to submit the exam, or cancel to keep working. You cannot change answers after submitting.`,
  submitReminder: 'Say confirm to submit the exam, or cancel to keep working.',
  submitCancelled: 'Submission cancelled. You can keep working.',
  submitted: 'Your exam has been submitted.',
  alreadySubmitted: 'The exam is already submitted. Answers can no longer be changed.',
  keyboardMode: `Speech recognition is not available. ${KEYBOARD_HINT}`,
  noSuchQuestion: (n: number, total: number) =>
    `There is no question ${n}. The exam has ${total} questions. Say a number from 1 to ${total}.`,
  /** "How many questions are remaining?" — position, how many follow, what is unanswered. */
  progress: (index: number, total: number, answered: boolean[]) => {
    const after = total - index - 1;
    const done = answered.filter(Boolean).length;
    const open = answered.map((a, i) => (a ? null : i + 1)).filter((n): n is number => n !== null);
    const openText = !open.length
      ? 'All questions have a saved answer.'
      : `Unanswered: ${open.length === 1 ? 'question' : 'questions'} ${joinNumbers(open)}.`;
    const afterText = after === 0 ? 'This is the last question.' : `${after} more ${after === 1 ? 'question' : 'questions'} after this one.`;
    return `You are on question ${index + 1} of ${total}. ${afterText} You have answered ${done} of ${total}. ${openText}`;
  },
  /** "Read my previous answer" — the saved answer, verbalised for listening. */
  savedAnswer: (index: number, literal: string | undefined) =>
    literal === undefined || literal === ''
      ? `You have not saved an answer for question ${index + 1} yet. Say answer to dictate one.`
      : `Your saved answer for question ${index + 1} is: ${readBackText(literal)}.`,
  navigationBlocked: 'Finish this step first.',
} as const;

function joinNumbers(ns: number[]): string {
  return ns.length <= 1 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** Spoken recovery after a failed listenOnce(); always tells the student what to do next. */
export function recoveryPrompt(error: unknown): string {
  const code = error instanceof VoiceError ? error.code : 'unknown';
  switch (code) {
    case 'no-speech':
    case 'timeout':
      return "I didn't hear anything. Please try again.";
    case 'cancelled':
      return 'Stopped listening.';
    case 'busy':
      return 'Already listening.';
    case 'permission-denied':
      return `The microphone is blocked. ${KEYBOARD_HINT}`;
    case 'unsupported':
    case 'audio-capture':
      return `No microphone is available. ${KEYBOARD_HINT}`;
    case 'network':
      return `The speech service could not be reached. Please try again, or continue with the keyboard.`;
    case 'language-unavailable':
      return `Speech for this language is not available. ${KEYBOARD_HINT}`;
    default:
      return 'Something went wrong with the microphone. Please try again, or continue with the keyboard.';
  }
}

/** Errors after which the microphone should not be retried automatically. */
export function needsKeyboardFallback(error: unknown): boolean {
  const code = error instanceof VoiceError ? error.code : 'unknown';
  return code === 'permission-denied' || code === 'unsupported' || code === 'audio-capture' || code === 'language-unavailable';
}
