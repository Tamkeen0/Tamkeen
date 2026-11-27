import { getLanguage } from './language';
import { PACKS } from './lang';
import type { ErrorKey } from './lang/types';

export type VoiceErrorCode =
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'timeout'
  | 'cancelled'
  | 'audio-capture'
  | 'network'
  | 'busy'
  | 'language-unavailable'
  | 'unknown';

/** Every listenOnce()/speak() failure rejects with a VoiceError; message is in the active language. */
export class VoiceError extends Error {
  readonly code: VoiceErrorCode;
  readonly detail: string | undefined;
  /** Words recognised before listening failed or was stopped; keep them as a draft. */
  partialTranscript?: string;

  constructor(code: VoiceErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
    this.detail = detail;
  }
}

export function voiceError(code: VoiceErrorCode, key: ErrorKey, detail?: string): VoiceError {
  return new VoiceError(code, PACKS[getLanguage()].errors[key], detail);
}

export function isVoiceError(value: unknown): value is VoiceError {
  return value instanceof VoiceError;
}
