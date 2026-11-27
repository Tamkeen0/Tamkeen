// Reference student-flow controller — DEVELOPER/TEST USE ONLY, not product UI.
//
// It stands in for the UI (owned by the frontend role) to show how the voice
// API is meant to be wired, and is shared by the end-to-end tests, the
// terminal simulator (try-session.mjs) and the Chrome test page (harness.ts).
// The integration rules it encodes are listed in ../README.md.
//
//   reading       -> each question is read on arrival; instructions only on the first visit
//   command mode  -> parseNavigation(), parseEditCommand(), then parseCommand()
//   dictation     -> literal text, never parsed; keeps listening across pauses
//   drafts        -> kept per question until saved or explicitly discarded (undoable);
//                    never lost by Escape, navigation or a recognition error
//   saving        -> "save"/"yes"/"confirm" only when a draft awaits saving
//   submit        -> strict "confirm" after "submit"; anything else keeps the exam active
//   output        -> 'voice' (app TTS), 'screenReader' (aria-live only) or 'both'; never silent
//   mic errors    -> spoken recovery; blocked/unavailable mic -> keyboard mode

import type { Exam, Question } from '../../../../contracts/types';
import {
  AnswerDraft,
  createDiagramExplorer,
  editResultPrompt,
  isRecognitionSupported,
  isVoiceError,
  listenOnce,
  matchOption,
  needsKeyboardFallback,
  parseCommand,
  parseEditCommand,
  parseNavigation,
  prompts,
  questionSpeech,
  recoveryPrompt,
  speak,
  stopListening,
  stopSpeaking,
} from '../index';
import type { AnswerState, DiagramExplorer, NavigationCommand } from '../index';
import { normalizeText as normalizeForMatch } from '../normalize';

export type FlowMode = 'command' | 'dictation' | 'confirmAnswer' | 'confirmSubmit' | 'submitted';

/** Where spoken feedback goes. 'voice': app TTS; 'screenReader': aria-live only (no app TTS); 'both'. */
export type OutputMode = 'voice' | 'screenReader' | 'both';

export interface ExamSession {
  answers: Record<string, string>;
  status: 'active' | 'submitted';
}

/** Minimal stand-in for the session API (contracts/API.md semantics). */
export interface SessionApi {
  session: ExamSession;
  putAnswer(questionId: string, text: string): void | Promise<void>;
  submit(): void | Promise<void>;
}

/** In-memory session: verbatim answers, idempotent overwrite, locked after submit (409). */
export function createMemorySession(): SessionApi {
  const session: ExamSession = { answers: {}, status: 'active' };
  const conflict = () => Object.assign(new Error('409 illegal state'), { status: 409 });
  return {
    session,
    putAnswer(questionId, text) {
      if (session.status === 'submitted') throw conflict();
      session.answers[questionId] = text;
    },
    submit() {
      if (session.status === 'submitted') throw conflict();
      session.status = 'submitted';
    },
  };
}

export interface ControllerOptions {
  exam: Exam;
  api: SessionApi;
  /** No-speech timeout per listen (time spent speaking never counts). */
  listenTimeoutMs?: number;
  /** Dictation ends after this much silence. */
  dictationEndSilenceMs?: number;
  /** After "answer" by voice, open the mic for dictation right away (no extra key press). */
  autoListenAfterAnswer?: boolean;
  output?: OutputMode;
  /** Remaining exam time from authoritative data, or null when unknown. Never estimated. */
  timeRemainingMs?: () => number | null;
  /** Every message, for visible text / logs (not a live region). */
  onMessage?: (text: string) => void;
  /** Messages for an aria-live region, according to the output mode. */
  onAnnounce?: (text: string) => void;
  /** Called whenever mode/question/keyboard state may have changed. */
  onChange?: () => void;
  /** Called with each literal transcript from the microphone (debug logging). */
  onHeard?: (text: string) => void;
}

const READ_ONLY_AFTER_SUBMIT = new Set(['repeatLast', 'repeatQuestion', 'readOptions', 'readAnswer', 'answerStatus', 'progress', 'time', 'help']);

export class ReferenceController {
  readonly exam: Exam;
  readonly api: SessionApi;
  listenTimeoutMs: number;
  dictationEndSilenceMs: number;
  autoListenAfterAnswer: boolean;
  output: OutputMode;
  index = 0;
  keyboardOnly = false;
  listening = false;
  /** Everything said, in order (transcript for tests/logs). */
  readonly live: string[] = [];
  /** What went to the aria-live region. */
  readonly announced: string[] = [];
  private dictating = false;
  private confirmingSubmit = false;
  private lastMessage: string | null = null;
  private readonly drafts = new Map<string, AnswerDraft>();
  private readonly discarded = new Map<string, AnswerDraft>();
  private readonly visited = new Set<number>();
  private explorer: DiagramExplorer;
  private readonly opts: ControllerOptions;

  constructor(options: ControllerOptions) {
    this.opts = options;
    this.exam = options.exam;
    this.api = options.api;
    this.listenTimeoutMs = options.listenTimeoutMs ?? 8000;
    this.dictationEndSilenceMs = options.dictationEndSilenceMs ?? 2500;
    this.autoListenAfterAnswer = options.autoListenAfterAnswer ?? true;
    this.output = options.output ?? 'voice';
    this.explorer = createDiagramExplorer(this.question.diagram);
  }

  get question(): Question {
    return this.exam.questions[this.index];
  }

  get total(): number {
    return this.exam.questions.length;
  }

  get mode(): FlowMode {
    if (this.api.session.status === 'submitted') return 'submitted';
    if (this.dictating) return 'dictation';
    if (this.confirmingSubmit) return 'confirmSubmit';
    if (this.drafts.has(this.question.id)) return 'confirmAnswer';
    return 'command';
  }

  /** The unsaved draft for the current question, if any. */
  get pending(): string | null {
    return this.drafts.get(this.question.id)?.text ?? null;
  }

  private stateOf(index: number): AnswerState {
    const q = this.exam.questions[index];
    if (this.drafts.has(q.id)) return 'draft';
    return this.api.session.answers[q.id] !== undefined ? 'saved' : 'none';
  }

  /** Speak and/or announce, per output mode. Never silent: if TTS fails, the live region gets it. */
  async say(text: string, { remember = true }: { remember?: boolean } = {}): Promise<void> {
    if (remember) this.lastMessage = text;
    this.live.push(text);
    this.opts.onMessage?.(text);
    this.opts.onChange?.();
    const announce = () => {
      this.announced.push(text);
      this.opts.onAnnounce?.(text);
    };
    if (this.output !== 'voice') announce();
    if (this.output === 'screenReader') return;
    try {
      await speak(text);
    } catch {
      if (this.output === 'voice') announce(); // no app voice: fall back to the screen reader
    }
  }

  async start(): Promise<void> {
    if (!isRecognitionSupported()) this.keyboardOnly = true;
    this.visited.add(this.index);
    const first = questionSpeech(this.question, this.index, this.total, { firstVisit: true, status: this.stateOf(this.index) });
    await this.say(`${first} ${prompts.welcome}`);
    if (this.keyboardOnly) await this.say(prompts.keyboardMode);
  }

  /** One microphone turn (the student pressed the talk key). */
  async turn(): Promise<void> {
    if (this.keyboardOnly) throw new Error('microphone unavailable: use type()');
    const dictation = this.dictating;
    let text: string;
    this.listening = true;
    this.opts.onChange?.();
    try {
      text = await listenOnce(
        dictation
          ? { mode: 'dictation', timeoutMs: this.listenTimeoutMs, endSilenceMs: this.dictationEndSilenceMs }
          : { timeoutMs: this.listenTimeoutMs },
      );
    } catch (err) {
      this.listening = false;
      return this.onListenError(err, dictation);
    }
    this.listening = false;
    this.opts.onHeard?.(text);
    await this.handle(text);
    // "answer" said by voice: listen for the dictation straight after the prompt.
    if (!dictation && this.dictating && this.autoListenAfterAnswer && !this.keyboardOnly) return this.turn();
  }

  /** Keyboard fallback: a typed command, or a typed answer while dictating. */
  async type(text: string): Promise<void> {
    return this.handle(text);
  }

  /** Escape key: stop speech and listening. Never discards a draft; cancels a pending submission. */
  async escape(): Promise<void> {
    const wasListening = this.listening;
    stopListening(); // an active turn reports what happens (and keeps any words heard)
    stopSpeaking();
    if (wasListening) return;
    if (this.confirmingSubmit) {
      this.confirmingSubmit = false;
      return this.say(prompts.submitCancelled);
    }
    this.opts.onChange?.();
  }

  private async onListenError(err: unknown, wasDictating: boolean): Promise<void> {
    if (needsKeyboardFallback(err)) this.keyboardOnly = true;
    const partial = isVoiceError(err) ? err.partialTranscript : undefined;
    if (wasDictating) {
      this.dictating = false;
      if (partial) {
        // Never lose words already heard: keep them as a draft and read them back.
        this.setDraft(partial);
        return this.say(`${recoveryPrompt(err)} ${prompts.readBack(partial)}`);
      }
      return this.say(`${recoveryPrompt(err)} Say answer to dictate again.`);
    }
    const base = recoveryPrompt(err);
    if (this.confirmingSubmit) return this.say(`${base} ${prompts.submitReminder}`);
    if (this.drafts.has(this.question.id)) return this.say(`${base} ${prompts.confirmAnswerReminder}`);
    return this.say(base);
  }

  /** Replace the current question's draft (previous version stays undoable). */
  private setDraft(text: string): AnswerDraft {
    const id = this.question.id;
    const existing = this.drafts.get(id);
    const draft = existing ?? new AnswerDraft(text);
    if (existing) draft.replaceAll(text);
    this.drafts.set(id, draft);
    this.discarded.delete(id);
    return draft;
  }

  private async saveDraft(): Promise<void> {
    const id = this.question.id;
    const draft = this.drafts.get(id);
    if (!draft) return this.say(prompts.nothingToConfirm);
    // An answer edited down to nothing is not saved as an empty answer.
    if (!draft.text.trim()) return this.say(prompts.edited(''));
    await this.api.putAnswer(id, draft.text);
    this.drafts.delete(id);
    this.discarded.delete(id);
    return this.say(prompts.saved(this.index));
  }

  private discardDraft(): Promise<void> {
    const id = this.question.id;
    const draft = this.drafts.get(id);
    if (!draft) return this.say(prompts.nothingToCancel);
    this.drafts.delete(id);
    this.discarded.set(id, draft); // "undo" brings it back
    return this.say(prompts.draftDiscarded);
  }

  private async goTo(index: number): Promise<void> {
    const leaving = this.index !== index && this.drafts.has(this.question.id) ? prompts.draftKeptOnLeave(this.index) : '';
    this.index = index;
    this.explorer = createDiagramExplorer(this.question.diagram); // references never carry across questions
    const firstVisit = !this.visited.has(index);
    this.visited.add(index);
    const reading = questionSpeech(this.question, index, this.total, { firstVisit, status: this.stateOf(index) });
    return this.say(leaving ? `${leaving} ${reading}` : reading);
  }

  private answeredFlags(): boolean[] {
    return this.exam.questions.map((q) => this.api.session.answers[q.id] !== undefined);
  }

  private async navigate(nav: NavigationCommand): Promise<void> {
    const q = this.question;
    switch (nav.type) {
      case 'next':
        return this.index + 1 < this.total ? this.goTo(this.index + 1) : this.say(prompts.lastQuestion);
      case 'previous':
        return this.index > 0 ? this.goTo(this.index - 1) : this.say(prompts.firstQuestion);
      case 'goto': {
        const n = nav.question === -1 ? this.total : nav.question;
        if (n < 1 || n > this.total) return this.say(prompts.noSuchQuestion(n, this.total));
        return this.goTo(n - 1);
      }
      case 'repeatLast':
        return this.lastMessage ? this.say(this.lastMessage) : this.say(prompts.nothingToRepeat);
      case 'repeatQuestion':
        return this.say(questionSpeech(q, this.index, this.total, { firstVisit: false, status: this.stateOf(this.index) }));
      case 'readOptions':
        return this.say(q.type === 'mcq' ? prompts.options(q) : prompts.noOptions);
      case 'progress':
        return this.say(prompts.progress(this.index, this.total, this.answeredFlags()));
      case 'answerStatus':
        return this.say(prompts.answerStatus(this.index, this.stateOf(this.index), this.mode === 'submitted'));
      case 'readAnswer': {
        const n = nav.question ?? this.index + 1;
        if (n < 1 || n > this.total) return this.say(prompts.noSuchQuestion(n, this.total));
        const target = this.exam.questions[n - 1];
        const draft = this.drafts.get(target.id);
        if (draft && this.mode !== 'submitted') return this.say(prompts.draftAnswer(n - 1, draft.text));
        return this.say(prompts.savedAnswer(n - 1, this.api.session.answers[target.id]));
      }
      case 'time': {
        const ms = this.opts.timeRemainingMs?.() ?? null;
        return this.say(ms === null ? prompts.timeUnavailable : prompts.timeRemaining(ms));
      }
      case 'help':
        return this.say(prompts.help);
      case 'redictate':
        this.dictating = true;
        return this.say(prompts.dictationStart);
      case 'saveAnswer':
        return this.saveDraft();
      case 'selectOption': {
        if (q.type !== 'mcq') return this.say(prompts.noOptions);
        const i = matchOption(q, nav.choice);
        if (i === null) return this.say(prompts.noSuchOption(nav.choice, q));
        this.setDraft(q.options[i]);
        return this.say(prompts.optionChosen(q.options[i]));
      }
    }
  }

  async handle(text: string): Promise<void> {
    const nav = parseNavigation(text);

    if (this.mode === 'submitted') {
      if (nav && READ_ONLY_AFTER_SUBMIT.has(nav.type)) return this.navigate(nav);
      return this.say(prompts.alreadySubmitted);
    }

    if (this.dictating) {
      // Literal answer: never interpreted as a command.
      this.dictating = false;
      this.setDraft(text);
      return this.say(prompts.readBack(text));
    }

    const edit = parseEditCommand(text);
    const cmd = parseCommand(text);

    // Submitting stays strict: only "confirm" submits; "cancel"/"no" backs out; anything else reminds.
    if (this.confirmingSubmit) {
      if (cmd.type === 'confirm') {
        this.confirmingSubmit = false;
        await this.api.submit();
        this.drafts.clear();
        return this.say(prompts.submitted);
      }
      if (cmd.type === 'cancel') {
        this.confirmingSubmit = false;
        return this.say(prompts.submitCancelled);
      }
      return this.say(prompts.submitReminder);
    }

    if (nav) return this.navigate(nav);

    if (edit) return this.applyEditCommand(edit);

    switch (cmd.type) {
      case 'next':
        return this.navigate({ type: 'next' });
      case 'previous':
        return this.navigate({ type: 'previous' });
      case 'repeat':
        return this.navigate({ type: 'repeatQuestion' });
      case 'dictate':
        this.dictating = true;
        return this.say(prompts.dictationStart);
      case 'explore':
        // Always ask, even without a diagram: solution requests must be refused on every question.
        return this.say(this.explorer.ask(cmd.query));
      case 'submit': {
        this.confirmingSubmit = true;
        const answered = this.answeredFlags().filter(Boolean).length;
        const unsaved = this.exam.questions.map((qq, i) => (this.drafts.has(qq.id) ? i + 1 : null)).filter((n): n is number => n !== null);
        return this.say(prompts.submitConfirm(answered, this.total, unsaved));
      }
      case 'confirm':
        return this.saveDraft();
      case 'cancel':
        if (!this.drafts.has(this.question.id)) return this.say(prompts.nothingToCancel);
        // "no"/"stop" are too uncertain to delete dictated content: keep the draft.
        if (/^(no|nope|stop|no thanks|never mind)$/.test(normalizeForMatch(text))) return this.say(prompts.draftKept);
        return this.discardDraft();
      default:
        return this.say(prompts.notUnderstood);
    }
  }

  private async applyEditCommand(edit: NonNullable<ReturnType<typeof parseEditCommand>>): Promise<void> {
    const id = this.question.id;
    if (edit.type === 'help') {
      return this.say(this.drafts.has(id) ? `${prompts.editHelp} ${prompts.confirmAnswerReminder}` : prompts.editHelp);
    }
    // "undo" right after discarding brings the draft back.
    if (edit.type === 'undo' && !this.drafts.has(id) && this.discarded.has(id)) {
      const restored = this.discarded.get(id)!;
      this.discarded.delete(id);
      this.drafts.set(id, restored);
      return this.say(prompts.draftRestored(restored.text));
    }
    const existing = this.drafts.get(id);
    // Editing a saved answer starts a draft; it still needs an explicit save.
    const draft = existing ?? new AnswerDraft(this.api.session.answers[id] ?? '');
    const result = draft.apply(edit);
    if (result.ok && result.changed) {
      this.drafts.set(id, draft);
      this.discarded.delete(id);
      return this.say(prompts.edited(draft.text));
    }
    const reminder = existing ? ` ${prompts.confirmAnswerReminder}` : '';
    return this.say(`${editResultPrompt(result)}${reminder}`);
  }
}
