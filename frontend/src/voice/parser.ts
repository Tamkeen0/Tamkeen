// Deterministic voice command interpreter. No model calls, no fuzzy matching
// for state-changing commands: a command is recognised only when the whole
// utterance (minus filler words) is one of the listed phrases.
//
// The UI must NOT call parseCommand() in dictation mode; dictated text is the
// student's literal answer.

import type { VoiceCommand } from '../../../contracts/types';
import { ALL_PACKS } from './lang';
import type { SimpleCommandType } from './lang/types';
import { normalizeText, tokenize } from './normalize';
import { parseExploreAction } from './visual/commands';

const MAX_EXPLORE_TOKENS = 30;
const COMPONENT_ID_PATTERN = /(^|\s)[a-z]{1,3} ?\d{1,3}(\s|$)/;

const FILLERS = new Set<string>();
const NEGATIONS = new Set<string>();
const COMMAND_KEYWORDS = new Set<string>();
const EXPLORE_STARTERS = new Set<string>();
const EXPLORE_STRIP: string[][] = [];
const COMMAND_PHRASES = new Map<string, SimpleCommandType>();
const UNSUPPORTED_WORDS = new Set<string>();
const UNSUPPORTED_PHRASES: string[][] = [];

for (const pack of ALL_PACKS) {
  for (const w of pack.unsupportedWords) UNSUPPORTED_WORDS.add(normalizeText(w));
  for (const p of pack.unsupportedPhrases) UNSUPPORTED_PHRASES.push(tokenize(normalizeText(p)));
}

for (const pack of ALL_PACKS) {
  for (const w of pack.fillers) FILLERS.add(normalizeText(w));
  for (const w of pack.negations) NEGATIONS.add(normalizeText(w));
  for (const w of pack.commandKeywords) COMMAND_KEYWORDS.add(normalizeText(w));
  for (const w of pack.exploreStarters) EXPLORE_STARTERS.add(normalizeText(w));
  for (const p of pack.exploreStrip) EXPLORE_STRIP.push(tokenize(normalizeText(p)));
}
for (const pack of ALL_PACKS) {
  for (const [type, phrases] of Object.entries(pack.commands) as [SimpleCommandType, string[]][]) {
    for (const phrase of phrases) {
      const key = stripFillers(tokenize(normalizeText(phrase))).join(' ');
      const existing = COMMAND_PHRASES.get(key);
      if (existing && existing !== type) {
        throw new Error(`Voice phrase "${phrase}" maps to both ${existing} and ${type}`);
      }
      COMMAND_PHRASES.set(key, type);
    }
  }
}

function stripFillers(tokens: string[]): string[] {
  return tokens.filter((t) => !FILLERS.has(t));
}

function startsWith(tokens: string[], prefix: string[]): boolean {
  return prefix.length > 0 && prefix.length <= tokens.length && prefix.every((p, i) => tokens[i] === p);
}

function isExplore(tokens: string[], normalized: string): boolean {
  if (EXPLORE_STARTERS.has(tokens[0])) return true;
  if (EXPLORE_STRIP.some((p) => startsWith(tokens, p))) return true;
  return COMPONENT_ID_PATTERN.test(normalized);
}

function isUnsupportedRequest(tokens: string[]): boolean {
  if (tokens.some((t) => UNSUPPORTED_WORDS.has(t))) return true;
  return UNSUPPORTED_PHRASES.some((p) => tokens.some((_, i) => p.length > 0 && p.every((w, k) => tokens[i + k] === w)));
}

function exploreQuery(tokens: string[]): string {
  for (const p of EXPLORE_STRIP) {
    if (startsWith(tokens, p)) return tokens.slice(p.length).join(' ');
  }
  return tokens.join(' ');
}

/** Interpret one recognised utterance in command mode. Ambiguous input returns {type:'unknown'}. */
export function parseCommand(text: string): VoiceCommand {
  const normalized = normalizeText(text);
  if (!normalized) return { type: 'unknown' };
  const tokens = tokenize(normalized);

  const exact = COMMAND_PHRASES.get(stripFillers(tokens).join(' '));
  if (exact) return { type: exact };

  // "don't submit", "not next": never act on a negated command.
  if (tokens.some((t) => NEGATIONS.has(t)) && tokens.some((t) => COMMAND_KEYWORDS.has(t))) {
    return { type: 'unknown' };
  }

  // Guided tour and relationship exploration ("start the tour", "next part", "follow R1"):
  // route to explore so describeDiagram() handles them (it keeps the tour state).
  if (parseExploreAction(text)) return { type: 'explore', query: tokens.join(' ') };

  // "Solve this circuit", "give me a hint": the contract has no "unsupported" command,
  // so route to explore; describeDiagram() answers with the fixed refusal (even with no diagram).
  if (isUnsupportedRequest(tokens)) return { type: 'explore', query: tokens.join(' ') };

  if (tokens.length <= MAX_EXPLORE_TOKENS && isExplore(tokens, normalized)) {
    return { type: 'explore', query: exploreQuery(tokens) };
  }
  return { type: 'unknown' };
}
