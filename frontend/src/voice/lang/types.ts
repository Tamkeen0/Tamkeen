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
  /** A pronoun ("it", "that") was used but nothing has been discussed yet. */
  whichOne(ex: Example): string;
  /** Several components match a description; list them, never pick one. */
  matches(components: Component[]): string;
  /** Nothing matches a description. */
  noMatch(components: Component[]): string;
  noneAtNode(kind: string, node: string): string;
  noOther(kind: string): string;
  /** "there" was used but no node is in focus. */
  whichNode(ex: Example): string;
  /** "its value" while a node with several components is in focus. */
  whichAtNode(node: string, components: Component[]): string;
  /** "other components at node B" after discussing `excluded`. */
  othersAtNode(node: string, excluded: string | null, components: Component[]): string;
}

// ---------- universal visual exploration (visual/engine.ts) ----------

export type ExploreSimpleAction =
  | 'tourStart' | 'tourNext' | 'tourPrev' | 'tourRepeat' | 'tourRestart' | 'tourStop'
  | 'where' | 'whatHere' | 'whatNext' | 'elseHere' | 'stepBack' | 'cameFrom' | 'brief' | 'detailed';

/** A reference to an element in a view (labels and categories as approved). */
export interface ElementRef {
  id: string;
  label: string;
  category: string;
  /** First approved attribute value, if any ("2 ohms"). */
  primary?: string;
}

/** One way out of a place: via a link (circuit component) or along an arrow, to another place. */
export interface LinkView {
  to: ElementRef;
  via?: ElementRef;
  /** Printed label on the relation ("yes"). */
  label?: string;
  directed: boolean;
}

/** Everything the templates may say about one element — approved facts only. */
export interface ElementView {
  element: ElementRef & { role: 'place' | 'link'; attributes: { name: string; value: string }[]; detail?: string; uncertain?: boolean };
  docType: string;
  /** For a place: where you can go from here. */
  out: LinkView[];
  /** For a place in a directed diagram: documented arrows arriving here. */
  incoming: ElementRef[];
  /** For a link: the places it joins. */
  ends: ElementRef[];
}

export interface VisualResponses {
  /** Localised category name ("resistor", "decision"); unknown categories are spoken as given. */
  category(category: string, plural?: boolean): string;
  describe(view: ElementView, level: 'brief' | 'detailed'): string;
  /** "What is connected here?" — all ways out of a place. */
  here(view: ElementView): string;
  tourIntro(summary: string, count: number, docType: string): string;
  tourPart(position: number, count: number, body: string): string;
  tourEnd: string;
  tourAtFirst: string;
  tourNotActive: string;
  tourStopped: string;
  tourRestart(body: string): string;
  emptyDiagram: string;
  where(tour: { position: number; count: number; label: string } | null, place: string | null): string;
  noPosition: string;
  moved(body: string): string;
  followed(link: LinkView, body: string): string;
  /** Standing on a link is not possible: say what it joins and how to continue. */
  atLink(link: ElementRef, ends: ElementRef[]): string;
  chooseLink(place: ElementRef, options: LinkView[]): string;
  noSuchLink(ref: string, place: ElementRef, options: LinkView[]): string;
  deadEnd(place: ElementRef): string;
  elseHere(place: ElementRef, options: LinkView[]): string;
  nothingElse(place: ElementRef): string;
  stepBack(body: string): string;
  nothingToGoBack: string;
  cameFrom(previous: ElementRef | null, via: ElementRef | null, incoming: ElementRef[]): string;
  notFound(ref: string, examples: ElementRef[]): string;
  ambiguous(ref: string, matches: ElementRef[]): string;
  briefOn: string;
  detailedOn: string;
}

export interface VisualPack {
  /** Whole utterances (fillers ignored) that map to one action. */
  commands: Record<ExploreSimpleAction, string[]>;
  /** Leading phrases followed by an element name: "start at node A". */
  goTo: string[];
  /** Leading phrases followed by a link, branch or place: "follow R1", "take the yes branch". */
  follow: string[];
  /** Words ignored inside a name ("the", "branch"). */
  refFillers: string[];
  /** Category names: key -> [singular, plural]. */
  categories: Record<string, [string, string]>;
  responses: VisualResponses;
}

/** Vocabulary and phrasing for one language. Phrases are written naturally and normalised at load time. */
export interface LanguagePack {
  /** Universal visual exploration phrases and replies. */
  visual: VisualPack;
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
  // --- references ---
  /** Ordinal word -> 1-based position; -1 means last. */
  ordinals: Record<string, number>;
  /** Words that refer to the component last discussed ("it", "that"). */
  pronouns: string[];
  /** "other", "another". */
  otherWords: string[];
  /** Words that refer to the node in focus ("there"). */
  placePronouns: string[];
  /** Words before "there" that make it existential ("is there", "are there"). */
  existentialWords: string[];
  /** A component's ends ("terminal", "end", "side"); node words count too. */
  terminalWords: string[];
  /** Properties a component has but a node does not ("value", "kind"). */
  attributeWords: string[];
  /** Command-mode words that mark a solution/hint request, routed to the refusal. */
  unsupportedWords: string[];
  unsupportedPhrases: string[];
  /** Unit word as written in values or spoken -> unit family ("ohms" -> "ohm"). */
  unitWords: Record<string, string>;
  /** English component kind -> localised kind name (singular, plural). */
  kindNames: Record<string, [string, string]>;
  responses: Responses;
  errors: Record<ErrorKey, string>;
}
