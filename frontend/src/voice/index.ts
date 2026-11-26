// Public voice API (contracts/API.md). The UI imports only from this file.
//
// Contract functions: speak, stopSpeaking, listenOnce, stopListening,
// parseCommand, describeDiagram. Everything else is an additive helper.

export {
  speak,
  stopSpeaking,
  listenOnce,
  stopListening,
  isSpeechSupported,
  isRecognitionSupported,
  isSpeaking,
  isListening,
  setSpeechEnvironment,
  DEFAULT_LISTEN_TIMEOUT_MS,
} from './speech';
export type { ListenOptions, SpeechEnvironment } from './speech';

export { parseCommand } from './parser';
export { parseNavigation } from './navigation';
export type { NavigationCommand } from './navigation';
export { describeDiagram, createDiagramExplorer } from './diagram';
export type { DiagramExplorer, DiagramFocus } from './diagram';
export { readBackText } from './readback';
export { questionSpeech, prompts, recoveryPrompt, needsKeyboardFallback, COMMAND_SUMMARY } from './prompts';

export { VoiceError, isVoiceError } from './errors';
export type { VoiceErrorCode } from './errors';

export { setLanguage, getLanguage, languageTag, SUPPORTED_LANGUAGES } from './language';
export type { VoiceLanguage } from './language';
