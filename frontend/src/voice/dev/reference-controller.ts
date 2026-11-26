// Reference student-flow controller — DEVELOPER/TEST USE ONLY, not product UI.
//
// It stands in for the UI (owned by the frontend role) to show how the voice
// API is meant to be wired, and is shared by the end-to-end tests, the
// terminal simulator (try-session.mjs) and the Chrome test page (harness.ts).
// The integration rules it encodes are listed in ../README.md.
//
//   command mode  -> parseNavigation() then parseCommand(); dictation -> literal text, never parsed
//   dictation     -> read back with readBackText(), save only on explicit confirm
//   submit        -> explicit confirm required; anything else keeps the exam active
//   every turn    -> spoken and announced (aria-live) feedback; no silent dead ends
//   mic errors    -> spoken recovery; blocked/unavailable mic -> keyboard mode

import type { Exam, Question } from '../../../../contracts/types';
import {
  createDiagramExplorer,
  isRecognitionSupported,
  listenOnce,
  needsKeyboardFallback,
  parseCommand,
  parseNavigation,
  prompts,
  questionSpeech,
  recoveryPrompt,
  speak,
  stopListening,
  stopSpeaking,
} from '../index';
import type { DiagramExplorer, NavigationCommand } from '../index';

export type FlowMode = 'command' | 'dictation' | 'confirmAnswer' | 'confirmSubmit' | 'submitted';

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
  listenTimeoutMs?: number;
  /** Called with every message (for an aria-live region). */
  onAnnounce?: (text: string) => void;
  /** Called whenever mode/question/keyboard state may have changed. */
  onChange?: () => void;
  /** Called with each literal transcript from the microphone (debug logging). */
  onHeard?: (text: string) => void;
}

export class ReferenceController {
  readonly exam: Exam;
  readonly api: SessionApi;
  listenTimeoutMs: number;
  index = 0;
  mode: FlowMode = 'command';
  pending: string | null = null;
  keyboardOnly = false;
  listening = false;
  readonly live: string[] = [];
  private explorer: DiagramExplorer;
  private onAnnounce?: (text: string) => void;
  private onChange?: () => void;
  private onHeard?: (text: string) => void;

  constructor({ exam, api, listenTimeoutMs = 8000, onAnnounce, onChange, onHeard }: ControllerOptions) {
    this.exam = exam;
    this.api = api;
    this.listenTimeoutMs = listenTimeoutMs;
    this.onAnnounce = onAnnounce;
    this.onChange = onChange;
    this.onHeard = onHeard;
    this.explorer = createDiagramExplorer(this.question.diagram);
  }

  get question(): Question {
    return this.exam.questions[this.index];
  }

  get total(): number {
    return this.exam.questions.length;
  }

  /** Announce (aria-live) and speak. Speech failure never hides the message. */
  async say(text: string): Promise<void> {
    this.live.push(text);
    this.onAnnounce?.(text);
    this.onChange?.();
    try {
      await speak(text);
    } catch {
      /* screen reader still gets the announcement */
    }
  }

  async start(): Promise<void> {
    if (!isRecognitionSupported()) this.keyboardOnly = true;
    await this.say(questionSpeech(this.question, this.index, this.total));
    if (this.keyboardOnly) await this.say(prompts.keyboardMode);
  }

  /** One microphone turn (the student pressed the talk key). */
  async turn(): Promise<void> {
    if (this.keyboardOnly) throw new Error('microphone unavailable: use type()');
    let text: string;
    this.listening = true;
    this.onChange?.();
    try {
      text = await listenOnce({ timeoutMs: this.listenTimeoutMs });
    } catch (err) {
      this.listening = false;
      return this.onListenError(err);
    }
    this.listening = false;
    this.onHeard?.(text);
    return this.handle(text);
  }

  /** Keyboard fallback: a typed command, or a typed answer while dictating. */
  async type(text: string): Promise<void> {
    return this.handle(text);
  }

  /** Escape key: stop listening/speaking and back out of dictation or confirmation. */
  async escape(): Promise<void> {
    stopListening();
    stopSpeaking();
    if (this.mode === 'dictation' || this.mode === 'confirmAnswer') {
      this.pending = null;
      this.mode = 'command';
      return this.say(prompts.answerCancelled);
    }
    if (this.mode === 'confirmSubmit') {
      this.mode = 'command';
      return this.say(prompts.submitCancelled);
    }
    this.onChange?.();
  }

  private async onListenError(err: unknown): Promise<void> {
    if (needsKeyboardFallback(err)) this.keyboardOnly = true;
    const base = recoveryPrompt(err);
    if (this.mode === 'dictation') {
      this.mode = 'command';
      return this.say(`${base} Say answer to dictate again.`);
    }
    if (this.mode === 'confirmAnswer') return this.say(`${base} ${prompts.confirmAnswerReminder}`);
    if (this.mode === 'confirmSubmit') return this.say(`${base} ${prompts.submitReminder}`);
    return this.say(base);
  }

  private async goTo(index: number): Promise<void> {
    this.index = index;
    this.explorer = createDiagramExplorer(this.question.diagram); // references never carry across questions
    return this.say(questionSpeech(this.question, this.index, this.total));
  }

  private answeredFlags(): boolean[] {
    return this.exam.questions.map((q) => this.api.session.answers[q.id] !== undefined);
  }

  private async navigate(nav: NavigationCommand): Promise<void> {
    if (nav.type === 'progress') return this.say(prompts.progress(this.index, this.total, this.answeredFlags()));
    if (nav.type === 'readAnswer') {
      const n = nav.question ?? this.index + 1;
      if (n < 1 || n > this.total) return this.say(prompts.noSuchQuestion(n, this.total));
      return this.say(prompts.savedAnswer(n - 1, this.api.session.answers[this.exam.questions[n - 1].id]));
    }
    const n = nav.question === -1 ? this.total : nav.question;
    if (n < 1 || n > this.total) return this.say(prompts.noSuchQuestion(n, this.total));
    return this.goTo(n - 1);
  }

  async handle(text: string): Promise<void> {
    if (this.mode === 'submitted') return this.say(prompts.alreadySubmitted);

    if (this.mode === 'dictation') {
      // Literal answer: never interpreted as a command.
      this.pending = text;
      this.mode = 'confirmAnswer';
      return this.say(prompts.readBack(text));
    }

    // Navigation extensions first (scoped adapter; see navigation.ts).
    const nav = parseNavigation(text);
    const cmd = parseCommand(text);

    if (nav && (this.mode === 'confirmAnswer' || this.mode === 'confirmSubmit')) {
      // Never leave an unconfirmed answer or a pending submission behind silently.
      const reminder = this.mode === 'confirmAnswer' ? prompts.confirmAnswerReminder : prompts.submitReminder;
      return this.say(`${prompts.navigationBlocked} ${reminder}`);
    }
    if (nav) return this.navigate(nav);

    if (this.mode === 'confirmAnswer') {
      if (cmd.type === 'confirm') {
        await this.api.putAnswer(this.question.id, this.pending ?? '');
        this.pending = null;
        this.mode = 'command';
        return this.say(prompts.saved(this.index));
      }
      if (cmd.type === 'dictate') {
        this.mode = 'dictation';
        return this.say(prompts.dictationStart);
      }
      if (cmd.type === 'cancel') {
        this.pending = null;
        this.mode = 'command';
        return this.say(prompts.answerCancelled);
      }
      return this.say(prompts.confirmAnswerReminder);
    }

    if (this.mode === 'confirmSubmit') {
      if (cmd.type === 'confirm') {
        await this.api.submit();
        this.mode = 'submitted';
        return this.say(prompts.submitted);
      }
      if (cmd.type === 'cancel') {
        this.mode = 'command';
        return this.say(prompts.submitCancelled);
      }
      return this.say(prompts.submitReminder);
    }

    switch (cmd.type) {
      case 'next':
        return this.index + 1 < this.total ? this.goTo(this.index + 1) : this.say(prompts.lastQuestion);
      case 'previous':
        return this.index > 0 ? this.goTo(this.index - 1) : this.say(prompts.firstQuestion);
      case 'repeat':
        return this.say(questionSpeech(this.question, this.index, this.total));
      case 'dictate':
        this.mode = 'dictation';
        return this.say(prompts.dictationStart);
      case 'explore':
        // Always ask, even without a diagram: solution requests must be refused on every question.
        return this.say(this.explorer.ask(cmd.query));
      case 'submit': {
        this.mode = 'confirmSubmit';
        const answered = this.answeredFlags().filter(Boolean).length;
        return this.say(prompts.submitConfirm(answered, this.total));
      }
      case 'confirm':
        return this.say(prompts.nothingToConfirm);
      case 'cancel':
        return this.say(prompts.nothingToCancel);
      default:
        return this.say(prompts.notUnderstood);
    }
  }
}
