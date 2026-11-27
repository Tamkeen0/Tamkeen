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
export { parseNavigation, matchOption } from './navigation';
export type { NavigationCommand } from './navigation';
export { describeDiagram, createDiagramExplorer } from './diagram';
export type { DiagramExplorer, DiagramFocus } from './diagram';
export { readBackText } from './readback';

// Universal visual exploration (guided tours, relationship navigation, detail levels).
export { VisualExplorer } from './visual/engine';
export type { DetailLevel, ExplorerSnapshot } from './visual/engine';
export { parseExploreAction } from './visual/commands';
export type { ExploreAction } from './visual/commands';
export { validateDocument, VisualDataError } from './visual/model';
export type { VisualDocument, VisualElement, VisualRelation, VisualAttribute, VisualType } from './visual/model';
export { circuitToVisual } from './visual/adapters/circuit';
export { flowchartToVisual } from './visual/adapters/flowchart';
export type { FlowchartData, FlowchartStep, FlowchartArrow, FlowchartStepKind } from './visual/adapters/flowchart';
export { questionSpeech, prompts, recoveryPrompt, needsKeyboardFallback, editResultPrompt, COMMAND_SUMMARY } from './prompts';
export type { AnswerState, QuestionSpeechOptions } from './prompts';
export { parseEditCommand, applyEdit, AnswerDraft } from './editing';
export type { EditCommand, EditResult, EditFailure } from './editing';

export { VoiceError, isVoiceError } from './errors';
export type { VoiceErrorCode } from './errors';

export { setLanguage, getLanguage, languageTag, SUPPORTED_LANGUAGES } from './language';
export type { VoiceLanguage } from './language';
