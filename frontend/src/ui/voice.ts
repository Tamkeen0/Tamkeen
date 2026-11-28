import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Diagram, Question, VoiceCommand } from '../../../contracts/types';
import { UiError } from './errors';

type NavigationCommand =
  | { type: 'goto'; question: number }
  | { type: 'readAnswer'; question?: number }
  | { type: 'selectOption'; choice: string | number }
  | { type: 'next' | 'previous' | 'repeatLast' | 'repeatQuestion' | 'readOptions' | 'progress' |
      'answerStatus' | 'time' | 'help' | 'redictate' | 'saveAnswer' };

type EditCommand =
  | { type: 'append'; text: string }
  | { type: 'replace'; target: string; replacement: string; all: boolean }
  | { type: 'delete'; target: string; all: boolean }
  | { type: 'deleteLastWords'; count: number }
  | { type: 'insert'; text: string; position: 'before' | 'after'; anchor: string }
  | { type: 'undo' | 'clear' | 'help' };

type EditResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: 'notFound'; target: string }
  | { ok: false; reason: 'ambiguous'; target: string; count: number }
  | { ok: false; reason: 'empty' | 'nothingToUndo' };

export type AnswerState = 'draft' | 'saved' | 'none';
export type AnswerDraft = { replaceAll(text: string): void; apply(command: EditCommand): EditResult };
export type DiagramExplorer = { ask(query: string): string; readonly exploring: boolean; where(): string };
export type VoiceOutput = 'screenReader' | 'app' | 'both';

export interface VoiceApi {
  speak(text: string): Promise<void>;
  stopSpeaking(): void;
  listenOnce(options?: { mode?: 'command' | 'dictation' }): Promise<string>;
  stopListening(): void;
  parseCommand(text: string): VoiceCommand;
  isRecognitionSupported(): boolean;
  isVoiceError(error: unknown): error is Error & { code: string; partialTranscript?: string };
  needsKeyboardFallback(error: unknown): boolean;
  recoveryPrompt(error: unknown): string;
  parseNavigation(text: string): NavigationCommand | null;
  parseEditCommand(text: string): EditCommand | null;
  matchOption(question: Question | undefined, choice: string | number): number | null;
  AnswerDraft: new (initial?: string) => AnswerDraft;
  editResultPrompt(result: EditResult): string;
  createDiagramExplorer(diagram: Diagram | null): DiagramExplorer;
  questionSpeech(question: Question, index: number, total: number, options: { firstVisit: boolean; status: AnswerState }): string;
  readBackText(answer: string): string;
  prompts: {
    dictationStart: string;
    readBack(literal: string): string;
    optionChosen(option: string): string;
    draftKept: string;
    saved(index: number): string;
    draftAnswer(index: number, literal: string): string;
    savedAnswer(index: number, literal: string | undefined): string;
    answerStatus(index: number, state: AnswerState): string;
    progress(index: number, total: number, answered: boolean[]): string;
    options(question: Question): string;
    noSuchOption(choice: string | number, question: Question): string;
    noSuchQuestion(number: number, total: number): string;
    submitConfirm(answered: number, total: number, unsavedDrafts?: number[]): string;
    submitReminder: string;
    submitCancelled: string;
    nothingToConfirm: string;
    nothingToRepeat: string;
    help: string;
    timeUnavailable: string;
    firstQuestion: string;
    lastQuestion: string;
    submitted: string;
    keyboardMode: string;
  };
}

// The voice entry point is optional on the independent frontend checkout.
// This structural type covers only the public exports the UI uses.
const modules = import.meta.glob<VoiceApi>('../voice/index.ts');
const loadVoice = modules['../voice/index.ts'];

type VoiceTask = { api?: VoiceApi; stopped: boolean };
export type VoiceActivity = { phase: 'preparing' | 'listening' | 'speaking' | 'processing'; label: string };

export function useVoice(visible: boolean, output: VoiceOutput) {
  const [activity, setActivity] = useState<VoiceActivity>();
  const [result, setResult] = useState<string>();
  const [announcement, setAnnouncement] = useState<string>();
  const [error, setError] = useState<string>();
  const [keyboardOnly, setKeyboardOnly] = useState(false);
  const task = useRef<VoiceTask | undefined>(undefined);
  const lastMessage = useRef('');

  const stop = useCallback(() => {
    const current = task.current;
    if (!current || current.stopped) return false;
    current.stopped = true;
    current.api?.stopListening();
    current.api?.stopSpeaking();
    return true;
  }, []);

  const clear = useCallback(() => {
    setResult(undefined);
    setAnnouncement(undefined);
    setError(undefined);
  }, []);

  useLayoutEffect(() => {
    if (!visible) clear();
    return () => { stop(); };
  }, [visible, clear, stop]);

  async function speak(api: VoiceApi, text: string) {
    const current = task.current;
    if (!current || current.stopped) return;
    lastMessage.current = text;
    setResult(text);
    if (output === 'screenReader') {
      setAnnouncement(text);
      return;
    }

    api.stopListening();
    setAnnouncement(undefined);
    setActivity({ phase: 'speaking', label: 'Reading aloud…' });
    try {
      await api.speak(text);
      if (output === 'both' && task.current === current && !current.stopped) setAnnouncement(text);
    } catch {
      if (task.current !== current || current.stopped) return;
      setError('App speech is unavailable. The message is available to your screen reader.');
      setAnnouncement(`App speech is unavailable. ${text}`);
    }
  }

  async function run(pending: string, action: (api: VoiceApi, isCurrent: () => boolean) => Promise<void>) {
    if (!loadVoice || !visible || task.current) return;
    const current: VoiceTask = { stopped: false };
    const trigger = document.activeElement;
    const nearbyControls = trigger?.closest('.voice-panel');
    task.current = current;
    const isCurrent = () => task.current === current && !current.stopped;
    clear();
    setActivity({ phase: 'preparing', label: pending });
    try {
      const api = await loadVoice();
      if (!isCurrent()) return;
      current.api = api;
      await action(api, isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        if (current.api?.needsKeyboardFallback(failure)) setKeyboardOnly(true);
        const message = current.api?.isVoiceError(failure)
          ? current.api.recoveryPrompt(failure)
          : failure instanceof UiError ? failure.message : 'Speech is unavailable. Keyboard controls are available.';
        setError(message);
        if (current.api) await speak(current.api, message);
        else setAnnouncement(message);
      }
    } finally {
      if (task.current === current) {
        task.current = undefined;
        setActivity(undefined);
        if (trigger instanceof HTMLElement) requestAnimationFrame(() => {
          if (document.activeElement !== document.body) return;
          if (trigger.isConnected) trigger.focus();
          if (document.activeElement === document.body) nearbyControls?.querySelector('summary')?.focus();
        });
      }
    }
  }

  async function listen(api: VoiceApi, mode: 'command' | 'dictation') {
    if (!api.isRecognitionSupported()) {
      setKeyboardOnly(true);
      throw new UiError(api.prompts.keyboardMode);
    }
    const current = task.current;
    setAnnouncement(undefined);
    setActivity({ phase: 'listening', label: mode === 'dictation' ? 'Listening for your answer…' : 'Listening for a command…' });
    const text = await api.listenOnce({ mode });
    if (task.current === current && !current?.stopped) setActivity({ phase: 'processing', label: 'Processing voice input…' });
    return text;
  }

  return {
    available: Boolean(loadVoice), activity, announcement, result, error, keyboardOnly, lastMessage,
    clear, listen, run, speak, stop, retry: () => setKeyboardOnly(false),
  };
}
