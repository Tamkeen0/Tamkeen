// Standard spoken prompts for the student flow, so the UI and the tests use
// the same wording. English only (demo language).
//
// Design rules: say what the student can do next (no silent dead ends), but
// keep it short and do not repeat instructions the student has already heard.
// Question text comes from the professor-approved `accessible_text` and is
// spoken verbatim. Dictated answers are read back with readBackText(); the
// stored answer stays literal. Progress and time come only from real exam state.

import type { Question } from '../../../contracts/types';
import type { EditResult } from './editing';
import { VoiceError } from './errors';
import { readBackText } from './readback';

export const COMMAND_SUMMARY =
  'You can say: next, previous, or go to question 2; repeat that; read the question; answer, to dictate; ' +
  'save; read my answer; explore, then a question about the diagram; where am I; and submit. ' +
  'To fix an answer, say replace, then the old words, with, then the new words.';

const KEYBOARD_HINT = 'You can continue with the keyboard: type commands such as next, answer, or submit.';

function sentence(text: string): string {
  const t = String(text ?? '').trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

export type AnswerState = 'none' | 'draft' | 'saved';

export interface QuestionSpeechOptions {
  /** First time the student reaches this question: include how to answer and explore (default true). */
  firstVisit?: boolean;
  /** Announce an existing saved answer or unsaved draft on arrival. */
  status?: AnswerState;
}

function optionsText(q: Question): string | null {
  return q.type === 'mcq' && q.options.length ? `Options: ${q.options.join('; ')}.` : null;
}

/**
 * Read a question in logical order: number, approved accessible text, options,
 * diagram note, answer status, and (first visit only) how to answer.
 */
export function questionSpeech(q: Question, index: number, total: number, options: QuestionSpeechOptions = {}): string {
  const firstVisit = options.firstVisit ?? true;
  const parts = [`Question ${index + 1} of ${total}.`, sentence(q.accessible_text)];
  const opts = optionsText(q);
  if (opts) parts.push(opts);
  if (q.diagram) {
    parts.push(
      firstVisit
        ? 'This question has a circuit diagram. Say explore, then your question, for example: explore R1.'
        : 'This question has a circuit diagram.',
    );
  }
  if (options.status === 'saved') parts.push('You have a saved answer for this question.');
  if (options.status === 'draft') parts.push('You have an unsaved draft for this question. Say save to keep it.');
  if (firstVisit && options.status !== 'saved' && options.status !== 'draft') {
    parts.push(q.type === 'mcq' ? 'Say option, then a letter, or say answer to dictate.' : 'Say answer to dictate your answer.');
  }
  return parts.join(' ');
}

export const prompts = {
  welcome: 'Say help at any time to hear what you can say.',
  help: COMMAND_SUMMARY,
  dictationStart: 'Dictate your answer now.',
  readBack: (literal: string) => `You said: ${readBackText(literal)}. Say save to keep it, or try again.`,
  optionChosen: (option: string) => `You chose: ${readBackText(option)}. Say save to keep it, or choose another option.`,
  confirmAnswerReminder: 'Say save to keep this answer, try again to dictate it again, or discard to delete this draft.',
  saved: (index: number) => `Answer saved for question ${index + 1}.`,
  draftKept: 'Stopped. Your draft is kept but not saved yet. Say save to keep it.',
  draftKeptOnLeave: (index: number) => `Your unsaved draft for question ${index + 1} is kept.`,
  draftDiscarded: 'Draft discarded. Your saved answer is unchanged. Say undo to bring the draft back.',
  draftRestored: (text: string) => `Draft restored: ${readBackText(text)}. Say save to keep it.`,
  answerCancelled: 'Cancelled. Your saved answer is unchanged.',
  notUnderstood: "Sorry, I didn't catch that. Say help to hear what you can say.",
  firstQuestion: 'This is the first question.',
  lastQuestion: 'This is the last question. Say submit when you are ready.',
  nothingToConfirm: 'There is no new answer to save. Say answer to dictate one.',
  nothingToCancel: 'There is nothing to cancel.',
  submitConfirm: (answered: number, total: number, unsavedDrafts: number[] = []) => {
    const drafts = unsavedDrafts.length
      ? ` You have an unsaved draft for ${unsavedDrafts.length === 1 ? 'question' : 'questions'} ${joinNumbers(unsavedDrafts)}; drafts are not submitted.`
      : '';
    return `You answered ${answered} of ${total} questions.${drafts} Say confirm to submit the exam, or cancel to keep working. You cannot change answers after submitting.`;
  },
  submitReminder: 'Say confirm to submit the exam, or cancel to keep working.',
  submitCancelled: 'Submission cancelled. You can keep working.',
  submitted: 'Your exam has been submitted.',
  alreadySubmitted: 'The exam is already submitted. Answers can no longer be changed.',
  keyboardMode: `Speech recognition is not available. ${KEYBOARD_HINT}`,
  noSuchQuestion: (n: number, total: number) =>
    `There is no question ${n}. The exam has ${total} questions. Say a number from 1 to ${total}.`,
  noOptions: 'This question has no options to choose from. Say answer to dictate your answer.',
  noSuchOption: (choice: string | number, q: Question) => {
    const label = typeof choice === 'number' ? String(choice) : choice.toUpperCase();
    return `There is no option ${label}. ${optionsText(q) ?? ''}`.trim();
  },
  options: (q: Question) => optionsText(q) ?? 'This question has no options.',
  nothingToRepeat: 'There is nothing to repeat yet.',
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
  /** "Is my answer saved?" — distinguishes saved, unsaved draft, none, and submitted. */
  answerStatus: (index: number, state: AnswerState, submitted = false) => {
    if (submitted) return `Your exam has been submitted. Your answer for question ${index + 1} can no longer be changed.`;
    if (state === 'saved') return `Your answer for question ${index + 1} is saved.`;
    if (state === 'draft') return `Question ${index + 1} has an unsaved draft. Say save to keep it, or read my answer to hear it.`;
    return `Question ${index + 1} has no answer yet.`;
  },
  /** "Read my previous answer" — the saved answer, verbalised for listening. */
  savedAnswer: (index: number, literal: string | undefined) =>
    literal === undefined || literal === ''
      ? `You have not saved an answer for question ${index + 1} yet. Say answer to dictate one.`
      : `Your saved answer for question ${index + 1} is: ${readBackText(literal)}.`,
  draftAnswer: (index: number, literal: string) =>
    `Your unsaved draft for question ${index + 1} is: ${readBackText(literal)}. Say save to keep it.`,
  /** Remaining time, only from authoritative exam data. */
  timeRemaining: (ms: number) => {
    if (ms <= 0) return 'The exam time is over.';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return 'Less than one minute remaining.';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const parts = [h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '', m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : ''].filter(Boolean);
    return `${parts.join(' and ')} remaining.`;
  },
  timeUnavailable: 'The remaining time is not available in this system yet. Please ask the invigilator.',
  navigationBlocked: 'Finish this step first.',
  // --- answer editing ---
  editHelp:
    'To edit your answer, say: add, then the words; replace, then the old words, with, then the new words; delete, then the words; delete the last word; insert, then the words, before or after other words; undo; or clear. Then say save.',
  edited: (text: string) =>
    text
      ? `Changed. Your answer is now: ${readBackText(text)}. Say save to keep it, or keep editing.`
      : 'Your draft is now empty. Say undo to bring it back, or answer to dictate again.',
  editUnchanged: (text: string) => `Nothing changed. Your answer is: ${readBackText(text)}.`,
  editNotFound: (target: string) => `I could not find ${target} in your answer. Nothing was changed.`,
  editAmbiguous: (target: string, count: number) =>
    `${target} appears ${count} times in your answer, so nothing was changed. Say replace every ${target} with the new words, or delete every ${target}.`,
  editEmpty: 'There is no answer to edit yet. Say answer to dictate one, or add followed by words.',
  nothingToUndo: 'There is nothing to undo.',
} as const;

/** Spoken result of an edit attempt (see editing.ts). */
export function editResultPrompt(result: EditResult): string {
  if (result.ok) return result.changed ? prompts.edited(result.text) : prompts.editUnchanged(result.text);
  switch (result.reason) {
    case 'notFound':
      return prompts.editNotFound(result.target);
    case 'ambiguous':
      return prompts.editAmbiguous(result.target, result.count);
    case 'empty':
      return prompts.editEmpty;
    case 'nothingToUndo':
      return prompts.nothingToUndo;
  }
}

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
