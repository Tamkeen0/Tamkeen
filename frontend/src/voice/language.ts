// Active language for speech recognition, text-to-speech and diagram replies.
// English is the default. parseCommand() always accepts every supported
// language, so it does not depend on this setting.

export type VoiceLanguage = 'en' | 'ar';

export const SUPPORTED_LANGUAGES: readonly VoiceLanguage[] = ['en', 'ar'];

// ar-SA (Modern Standard Arabic) is the widest-supported Arabic tag in Chrome;
// pass e.g. 'ar-EG' or 'ar-JO' to setLanguage() for a regional recogniser.
const DEFAULT_TAGS: Record<VoiceLanguage, string> = { en: 'en-US', ar: 'ar-SA' };

let current: VoiceLanguage = 'en';
let tagOverride: string | null = null;

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Select the language used by listenOnce(), speak() and describeDiagram().
 * Optional BCP-47 tag overrides the default regional variant (e.g. 'en-GB').
 */
export function setLanguage(language: VoiceLanguage, bcp47Tag?: string): void {
  if (!isVoiceLanguage(language)) {
    throw new RangeError(`Unsupported voice language: ${String(language)}`);
  }
  current = language;
  tagOverride = bcp47Tag && bcp47Tag.trim() ? bcp47Tag.trim() : null;
}

export function getLanguage(): VoiceLanguage {
  return current;
}

/** BCP-47 tag passed to the browser speech APIs. */
export function languageTag(): string {
  return tagOverride ?? DEFAULT_TAGS[current];
}
