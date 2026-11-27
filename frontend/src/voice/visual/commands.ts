// Voice commands for universal visual exploration (English and Arabic, from the language packs).
// Deterministic: whole-phrase matches, or a leading phrase followed by a name.
// Negated requests and solution requests ("follow the current through R1") return null,
// so the existing refusal path handles them.
import { ALL_PACKS } from '../lang';
import type { ExploreSimpleAction } from '../lang/types';
import { normalizeText, tokenize } from '../normalize';

export type ExploreAction =
  | { type: ExploreSimpleAction }
  | { type: 'goTo'; ref: string }
  | { type: 'follow'; ref: string | null };

const FILLERS = new Set(['please', 'ok', 'okay', 'um', 'uh', 'so', 'now', 'just', 'can', 'could', 'would', 'you', 'lets', 'فضلك', 'سمحت', 'رجاء', 'رجاءا', 'الان', 'طيب']);
const NEGATIONS = new Set(['not', 'dont', 'never', 'cant', 'wont', 'no', 'without', 'لا', 'لن', 'مش', 'ليس', 'بدون']);
/** Phrases after which a goTo is exam navigation, not a diagram part. */
const NOT_A_PART = new Set(['question', 'questions', 'السوال', 'سوال']);

const tokensOf = (text: string) =>
  tokenize(normalizeText(String(text ?? '').replace(/من فضلك|لو سمحت/g, ' '))).filter((t) => !FILLERS.has(t));

const SIMPLE = new Map<string, ExploreSimpleAction>();
const PREFIXES: { tokens: string[]; kind: 'goTo' | 'follow' }[] = [];
const UNSUPPORTED = new Set<string>();
const UNSUPPORTED_PHRASES: string[][] = [];

for (const pack of ALL_PACKS) {
  for (const [action, phrases] of Object.entries(pack.visual.commands) as [ExploreSimpleAction, string[]][]) {
    for (const p of phrases) {
      const key = tokensOf(p).join(' ');
      const existing = SIMPLE.get(key);
      if (existing && existing !== action) throw new Error(`Exploration phrase "${p}" maps to both ${existing} and ${action}`);
      SIMPLE.set(key, action);
    }
  }
  for (const p of pack.visual.goTo) PREFIXES.push({ tokens: tokensOf(p), kind: 'goTo' });
  for (const p of pack.visual.follow) PREFIXES.push({ tokens: tokensOf(p), kind: 'follow' });
  for (const w of pack.unsupportedWords) UNSUPPORTED.add(normalizeText(w));
  for (const p of pack.unsupportedPhrases) UNSUPPORTED_PHRASES.push(tokenize(normalizeText(p)));
}
PREFIXES.sort((a, b) => b.tokens.length - a.tokens.length); // "take me to" before "take"

const startsWith = (tokens: string[], prefix: string[]) => prefix.length > 0 && prefix.every((p, i) => tokens[i] === p);

function isSolutionRequest(tokens: string[]): boolean {
  if (tokens.some((t) => UNSUPPORTED.has(t))) return true;
  return UNSUPPORTED_PHRASES.some((p) => tokens.some((_, i) => p.length > 0 && p.every((w, k) => tokens[i + k] === w)));
}

/** Recognise an exploration command, or null. Never used in dictation mode. */
export function parseExploreAction(text: string): ExploreAction | null {
  const tokens = tokensOf(text);
  if (!tokens.length) return null;
  if (isSolutionRequest(tokens)) return null;
  // "no"/"لا" may be a printed branch label inside a follow/goTo name ("take the no branch");
  // anywhere else, a negation means the student is not asking for this action.
  const prefix = PREFIXES.find((p) => startsWith(tokens, p.tokens));
  const negationScope = prefix ? tokens.slice(prefix.tokens.length).filter((t) => t !== 'no' && t !== 'لا') : tokens;
  if (negationScope.some((t) => NEGATIONS.has(t)) || (prefix && tokens.slice(0, prefix.tokens.length).some((t) => NEGATIONS.has(t)))) return null;

  const simple = SIMPLE.get(tokens.join(' '));
  if (simple) return { type: simple };

  for (const p of PREFIXES) {
    if (!startsWith(tokens, p.tokens)) continue;
    const rest = tokens.slice(p.tokens.length);
    if (p.kind === 'follow') {
      if (!rest.length || (rest.length === 1 && (rest[0] === 'it' || rest[0] === 'that' || rest[0] === 'on'))) return { type: 'follow', ref: null };
      return { type: 'follow', ref: rest.join(' ') };
    }
    if (!rest.length || rest.some((t) => NOT_A_PART.has(t)) || rest[0] === 'next' || rest[0] === 'previous') return null;
    return { type: 'goTo', ref: rest.join(' ') };
  }
  return null;
}
