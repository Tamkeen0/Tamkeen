// Browser speech adapter: SpeechSynthesis for TTS, (webkit)SpeechRecognition
// for one-shot literal transcription. The microphone is never open while TTS
// is speaking: speak() cancels any active listen, and listenOnce() waits for
// speech to finish before starting. Every failure rejects with a VoiceError.

import { VoiceError, voiceError } from './errors';
import { languageTag } from './language';

export interface VoiceLike {
  lang: string;
  name: string;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  onend: ((ev?: unknown) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

export interface SynthesisLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  speaking?: boolean;
  pending?: boolean;
}

export interface RecognitionAlternativeLike {
  transcript: string;
}

export interface RecognitionEventLike {
  results: ArrayLike<ArrayLike<RecognitionAlternativeLike> & { isFinal?: boolean }>;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: RecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
  onend: ((ev?: unknown) => void) | null;
  start(): void;
  abort(): void;
}

/** Injectable browser surface; defaults to the real window APIs. */
export interface SpeechEnvironment {
  synthesis: SynthesisLike | null;
  createUtterance: ((text: string) => UtteranceLike) | null;
  createRecognition: (() => RecognitionLike) | null;
}

export interface ListenOptions {
  /** Give up if nothing is recognised within this many ms (default 10000). */
  timeoutMs?: number;
}

export const DEFAULT_LISTEN_TIMEOUT_MS = 10_000;
const MAX_CHUNK = 180;

function browserEnvironment(): SpeechEnvironment {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const synthesis: SynthesisLike | null = g.speechSynthesis ?? null;
  const Utterance = g.SpeechSynthesisUtterance;
  const Recognition = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return {
    synthesis,
    createUtterance: synthesis && typeof Utterance === 'function' ? (t: string) => new Utterance(t) : null,
    createRecognition: typeof Recognition === 'function' ? () => new Recognition() : null,
  };
}

let override: SpeechEnvironment | null = null;

function env(): SpeechEnvironment {
  return override ?? browserEnvironment();
}

type ActiveSpeech = { promise: Promise<void>; finish: (err?: VoiceError) => void };
type Outcome = { ok: true; text: string } | { ok: false; error: VoiceError };
type PendingListen = { settled: boolean; recognition: RecognitionLike | null; settle: (o: Outcome) => void };

let activeSpeech: ActiveSpeech | null = null;
let pendingListen: PendingListen | null = null;

/** Replace the browser speech APIs (tests, mocks, demos). Pass null to restore. Resets internal state. */
export function setSpeechEnvironment(environment: SpeechEnvironment | null): void {
  stopListening();
  if (activeSpeech) activeSpeech.finish();
  activeSpeech = null;
  pendingListen = null;
  override = environment;
}

export function isSpeechSupported(): boolean {
  const e = env();
  return !!(e.synthesis && e.createUtterance);
}

export function isRecognitionSupported(): boolean {
  return !!env().createRecognition;
}

export function isSpeaking(): boolean {
  return activeSpeech !== null;
}

export function isListening(): boolean {
  return pendingListen !== null;
}

/** Split into sentence-sized chunks; Chrome may cut off long single utterances. */
export function splitForSpeech(text: string): string[] {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?؟;]+[.!?؟;]*/g) ?? [clean];
  const chunks: string[] = [];
  let buf = '';
  const push = (s: string) => {
    if (s.trim()) chunks.push(s.trim());
  };
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > MAX_CHUNK) {
      const cut = Math.max(s.lastIndexOf(',', MAX_CHUNK), s.lastIndexOf('،', MAX_CHUNK), s.lastIndexOf(' ', MAX_CHUNK));
      const at = cut > 0 ? cut + 1 : MAX_CHUNK;
      push(buf);
      buf = '';
      push(s.slice(0, at));
      s = s.slice(at).trim();
    }
    if ((buf + ' ' + s).trim().length > MAX_CHUNK) {
      push(buf);
      buf = s;
    } else {
      buf = (buf + ' ' + s).trim();
    }
  }
  push(buf);
  return chunks;
}

function pickVoice(synthesis: SynthesisLike, tag: string): VoiceLike | null | 'missing' {
  let voices: VoiceLike[] = [];
  try {
    voices = synthesis.getVoices() ?? [];
  } catch {
    voices = [];
  }
  // Chrome loads voices asynchronously; with an empty list let the browser choose by utterance.lang.
  if (!voices.length) return null;
  const norm = (l: string) => String(l ?? '').toLowerCase().replace('_', '-');
  const want = norm(tag);
  const base = want.split('-')[0];
  return (
    voices.find((v) => norm(v.lang) === want) ??
    voices.find((v) => norm(v.lang) === base || norm(v.lang).startsWith(`${base}-`)) ??
    'missing'
  );
}

function synthesisError(code: string | undefined): VoiceError {
  switch (code) {
    case 'not-allowed':
      return voiceError('permission-denied', 'speechBlocked', code);
    case 'language-unavailable':
    case 'voice-unavailable':
      return voiceError('language-unavailable', 'languageUnavailable', code);
    case 'network':
      return voiceError('network', 'network', code);
    default:
      return voiceError('unknown', 'speechFailed', code);
  }
}

function interruptSpeech(e: SpeechEnvironment): void {
  const current = activeSpeech;
  if (!current) return;
  activeSpeech = null;
  try {
    e.synthesis?.cancel();
  } catch {
    /* ignore */
  }
  current.finish();
}

/**
 * Speak text in the active language. Resolves when finished or when
 * stopSpeaking()/another speak() interrupts it. Stops any active listening first.
 */
export function speak(text: string): Promise<void> {
  const e = env();
  const synthesis = e.synthesis;
  const createUtterance = e.createUtterance;
  if (!synthesis || !createUtterance) return Promise.reject(voiceError('unsupported', 'speechUnsupported'));

  stopListening();
  interruptSpeech(e);

  const chunks = splitForSpeech(text);
  if (!chunks.length) return Promise.resolve();

  const tag = languageTag();
  const voice = pickVoice(synthesis, tag);
  if (voice === 'missing') return Promise.reject(voiceError('language-unavailable', 'languageUnavailable', tag));

  let resolveFn!: () => void;
  let rejectFn!: (err: VoiceError) => void;
  const promise = new Promise<void>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  let settled = false;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const entry: ActiveSpeech = {
    promise,
    finish: (err) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      if (activeSpeech === entry) activeSpeech = null;
      if (err) rejectFn(err);
      else resolveFn();
    },
  };
  activeSpeech = entry;

  try {
    chunks.forEach((chunk, i) => {
      const u = createUtterance(chunk);
      u.lang = tag;
      if (voice) u.voice = voice;
      const last = i === chunks.length - 1;
      u.onend = () => {
        if (last) entry.finish();
      };
      u.onerror = (ev) => {
        const code = ev?.error;
        if (code === 'interrupted' || code === 'canceled') {
          entry.finish();
          return;
        }
        // Settle first so the 'interrupted' events caused by cancel() are ignored.
        entry.finish(synthesisError(code));
        try {
          synthesis.cancel();
        } catch {
          /* ignore */
        }
      };
      synthesis.speak(u);
    });
  } catch (err) {
    entry.finish(voiceError('unknown', 'speechFailed', String(err)));
    return promise;
  }

  // Chrome occasionally never fires onend; resolve once the engine reports idle twice in a row.
  if (typeof synthesis.speaking === 'boolean') {
    let idleTicks = 0;
    watchdog = setInterval(() => {
      idleTicks = !synthesis.speaking && !synthesis.pending ? idleTicks + 1 : 0;
      if (idleTicks >= 2) entry.finish();
    }, 500);
  }
  return promise;
}

/** Stop speaking immediately; a pending speak() resolves. */
export function stopSpeaking(): void {
  const e = env();
  if (activeSpeech) {
    interruptSpeech(e);
    return;
  }
  try {
    e.synthesis?.cancel();
  } catch {
    /* ignore */
  }
}

function recognitionError(code: string | undefined): VoiceError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return voiceError('permission-denied', 'permissionDenied', code);
    case 'no-speech':
      return voiceError('no-speech', 'noSpeech', code);
    case 'audio-capture':
      return voiceError('audio-capture', 'audioCapture', code);
    case 'network':
      return voiceError('network', 'network', code);
    case 'aborted':
      return voiceError('cancelled', 'cancelled', code);
    case 'language-not-supported':
      return voiceError('language-unavailable', 'languageUnavailable', code);
    default:
      return voiceError('unknown', 'unknown', code);
  }
}

function transcriptOf(ev: RecognitionEventLike): string {
  const parts: string[] = [];
  const results = ev?.results ?? [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && r.isFinal !== false && r.length > 0 && typeof r[0]?.transcript === 'string') parts.push(r[0].transcript);
  }
  return parts.join(' ').trim();
}

/**
 * Listen for one utterance and resolve with the literal transcript (only
 * surrounding whitespace trimmed). Rejects with VoiceError: unsupported,
 * permission-denied, no-speech, timeout, cancelled, audio-capture, network,
 * busy, language-unavailable or unknown. Never resolves with an empty string.
 */
export function listenOnce(options: ListenOptions = {}): Promise<string> {
  const e = env();
  const createRecognition = e.createRecognition;
  if (!createRecognition) return Promise.reject(voiceError('unsupported', 'recognitionUnsupported'));
  if (pendingListen) return Promise.reject(voiceError('busy', 'busy'));
  const timeoutMs = options.timeoutMs ?? DEFAULT_LISTEN_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending: PendingListen = {
      settled: false,
      recognition: null,
      settle: (outcome) => {
        if (pending.settled) return;
        pending.settled = true;
        if (timer) clearTimeout(timer);
        const rec = pending.recognition;
        pending.recognition = null;
        if (rec) {
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          if (!outcome.ok) {
            try {
              rec.abort();
            } catch {
              /* ignore */
            }
          }
        }
        if (pendingListen === pending) pendingListen = null;
        if (outcome.ok) resolve(outcome.text);
        else reject(outcome.error);
      },
    };
    pendingListen = pending;
    const fail = (error: VoiceError) => pending.settle({ ok: false, error });

    const start = () => {
      if (pending.settled) return;
      let rec: RecognitionLike;
      try {
        rec = createRecognition();
        rec.lang = languageTag();
        rec.continuous = false;
        rec.interimResults = false;
        rec.maxAlternatives = 1;
      } catch (err) {
        fail(voiceError('unknown', 'startFailed', String(err)));
        return;
      }
      rec.onresult = (ev) => {
        const text = transcriptOf(ev);
        if (text) pending.settle({ ok: true, text });
        else fail(voiceError('no-speech', 'noSpeech'));
      };
      rec.onerror = (ev) => fail(recognitionError(ev?.error));
      rec.onend = () => fail(voiceError('no-speech', 'noSpeech', 'ended'));
      pending.recognition = rec;
      timer = setTimeout(() => fail(voiceError('timeout', 'timeout')), timeoutMs);
      try {
        rec.start();
      } catch (err) {
        fail(voiceError('unknown', 'startFailed', String(err)));
      }
    };

    // Never open the microphone while TTS is speaking.
    if (activeSpeech) activeSpeech.promise.then(start, start);
    else start();
  });
}

/** Cancel an active or waiting listenOnce(); it rejects with code 'cancelled'. */
export function stopListening(): void {
  pendingListen?.settle({ ok: false, error: voiceError('cancelled', 'cancelled') });
}
