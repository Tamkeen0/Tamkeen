import type { Component, Diagram } from '../../../../contracts/types';

export type SimpleCommandType = 'next' | 'previous' | 'repeat' | 'dictate' | 'confirm' | 'cancel' | 'submit';

export type ErrorKey =
  | 'recognitionUnsupported'
  | 'speechUnsupported'
  | 'permissionDenied'
  | 'speechBlocked'
  | 'noSpeech'
  | 'timeout'
  | 'cancelled'
  | 'audioCapture'
  | 'network'
  | 'busy'
  | 'languageUnavailable'
  | 'startFailed'
  | 'speechFailed'
  | 'unknown';

export interface Example {
  component: string;
  node: string;
  otherNode: string;
}

export interface Responses {
  noDiagram: string;
  refusal: string;
  help(ex: Example): string;
  unknown(ex: Example): string;
  componentNotFound(label: string, components: Component[]): string;
  nodeNotFound(label: string, nodes: string[]): string;
  component(c: Component): string;
  node(node: string, components: Component[]): string;
  between(a: string, b: string, components: Component[]): string;
  nodeList(nodes: string[]): string;
  componentList(components: Component[]): string;
  kindList(kind: string, components: Component[]): string;
  overview(diagram: Diagram, nodes: string[], components: Component[]): string;
}

/** Vocabulary and phrasing for one language. Phrases are written naturally and normalised at load time. */
export interface LanguagePack {
  // --- command parser ---
  commands: Record<SimpleCommandType, string[]>;
  /** Tokens ignored when matching a command phrase ("please", "the"). */
  fillers: string[];
  negations: string[];
  /** Tokens that signal a command intent; negation + keyword => unknown. */
  commandKeywords: string[];
  /** First tokens that mark an explore request. */
  exploreStarters: string[];
  /** Leading phrases removed from the explore query ("explore"). */
  exploreStrip: string[];
  // --- diagram lookup ---
  numberWords: Record<string, string>;
  /** Spoken letter names -> letter ("bee" -> "b"). */
  letterAliases: Record<string, string>;
  refusalWords: string[];
  refusalPhrases: string[];
  helpWords: string[];
  nodeWords: string[];
  componentWords: string[];
  overviewWords: string[];
  stopWords: string[];
  betweenWords: string[];
  andWords: string[];
  /** English component kind -> localised kind name (singular, plural). */
  kindNames: Record<string, [string, string]>;
  responses: Responses;
  errors: Record<ErrorKey, string>;
}
