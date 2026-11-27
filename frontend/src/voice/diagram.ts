// Deterministic, approved-data-only diagram lookup.
//
// Answers only visible facts stored in the approved Diagram: the description,
// node names, component ids, kinds, values and terminal nodes. It never
// calculates, infers topology (series/parallel, loops, equivalents) or gives
// hints; such requests get a fixed refusal. Output text is built only from
// fixed templates plus strings copied verbatim from the diagram.
//
// Component reference resolution:
//   explicit      "R2", "are two", "resistor 2"           -> that id, if it exists
//   by value      "the 4 ohm resistor", "12 volt source"   -> value has that number + unit
//   by order      "the first resistor", "last component"   -> position in the approved list
//   by place      "the resistor at node C", "between A and B"
//   contextual    "it", "its value", "that one", "the other resistor"
//                 (only via createDiagramExplorer, which remembers the last focus)
// Several matches are listed, never guessed. Nothing is inferred from how
// components relate to each other.

import type { Component, Diagram } from '../../../contracts/types';
import { getLanguage } from './language';
import type { VoiceLanguage } from './language';
import { ALL_PACKS, PACKS } from './lang';
import type { Example, LanguagePack, Responses } from './lang/types';
import { hasArabic, normalizeAndStem, normalizeText, stemToken } from './normalize';
import { circuitToVisual } from './visual/adapters/circuit';
import { parseExploreAction } from './visual/commands';
import { VisualExplorer } from './visual/engine';

type Vocab = {
  numbers: Map<string, string>;
  letters: Map<string, string>;
  refusal: Set<string>;
  refusalPhrases: string[][];
  help: Set<string>;
  nodeWords: Set<string>;
  componentWords: Set<string>;
  overview: Set<string>;
  stop: Set<string>;
  between: Set<string>;
  and: Set<string>;
  ordinals: Map<string, number>;
  pronouns: Set<string>;
  other: Set<string>;
  place: Set<string>;
  existential: Set<string>;
  terminal: Set<string>;
  attribute: Set<string>;
  units: Map<string, string>;
};

function stemmedSet(words: string[]): Set<string> {
  const s = new Set<string>();
  for (const w of words) for (const t of normalizeAndStem(w)) s.add(t);
  return s;
}

function buildVocab(packs: LanguagePack[]): Vocab {
  const v: Vocab = {
    numbers: new Map(),
    letters: new Map(),
    refusal: new Set(),
    refusalPhrases: [],
    help: new Set(),
    nodeWords: new Set(),
    componentWords: new Set(),
    overview: new Set(),
    stop: new Set(),
    between: new Set(),
    and: new Set(),
    ordinals: new Map(),
    pronouns: new Set(),
    other: new Set(),
    place: new Set(),
    existential: new Set(),
    terminal: new Set(),
    attribute: new Set(),
    units: new Map(),
  };
  for (const p of packs) {
    for (const [w, n] of Object.entries(p.numberWords)) v.numbers.set(stemToken(normalizeText(w)), n);
    for (const [w, l] of Object.entries(p.letterAliases)) v.letters.set(stemToken(normalizeText(w)), l);
    for (const [w, n] of Object.entries(p.ordinals)) v.ordinals.set(stemToken(normalizeText(w)), n);
    for (const [w, u] of Object.entries(p.unitWords)) v.units.set(valueTokens(w)[0] ?? w, u);
    stemmedSet(p.refusalWords).forEach((t) => v.refusal.add(t));
    for (const ph of p.refusalPhrases) v.refusalPhrases.push(normalizeAndStem(ph));
    stemmedSet(p.helpWords).forEach((t) => v.help.add(t));
    stemmedSet(p.nodeWords).forEach((t) => v.nodeWords.add(t));
    stemmedSet(p.componentWords).forEach((t) => v.componentWords.add(t));
    stemmedSet(p.overviewWords).forEach((t) => v.overview.add(t));
    stemmedSet(p.stopWords).forEach((t) => v.stop.add(t));
    stemmedSet(p.betweenWords).forEach((t) => v.between.add(t));
    stemmedSet(p.andWords).forEach((t) => v.and.add(t));
    stemmedSet(p.pronouns).forEach((t) => v.pronouns.add(t));
    stemmedSet(p.otherWords).forEach((t) => v.other.add(t));
    stemmedSet(p.placePronouns).forEach((t) => v.place.add(t));
    stemmedSet(p.existentialWords).forEach((t) => v.existential.add(t));
    stemmedSet(p.terminalWords).forEach((t) => v.terminal.add(t));
    stemmedSet(p.attributeWords).forEach((t) => v.attribute.add(t));
  }
  return v;
}

/** Light tokenisation that keeps decimals ("2.2") for value matching. */
function valueTokens(s: string): string[] {
  const folded = String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return folded.match(/\d+(?:\.\d+)?|\p{L}+/gu) ?? [];
}

const VOCAB = buildVocab(ALL_PACKS);

type KindEntry = { kind: string; full: string[][]; aliases: string[][]; components: Component[] };

type Index = {
  components: Component[];
  nodes: string[];
  componentById: Map<string, Component>;
  nodeByKey: Map<string, string>;
  kinds: KindEntry[];
};

export type DiagramFocus = { type: 'component'; id: string } | { type: 'node'; id: string };

type Answer = { text: string; focus: DiagramFocus | null };

function isDiagram(d: unknown): d is Diagram {
  if (!d || typeof d !== 'object') return false;
  const x = d as Partial<Diagram>;
  return typeof x.description === 'string' && Array.isArray(x.nodes) && Array.isArray(x.components);
}

function kindPhrases(kind: string): { full: string[][]; aliases: string[][] } {
  const full: string[][] = [];
  const aliases: string[][] = [];
  const base = normalizeAndStem(kind);
  if (base.length) {
    full.push(base);
    aliases.push(base, [...base.slice(0, -1), `${base[base.length - 1]}s`]);
    if (base.length > 1) aliases.push([base[0]]);
  }
  for (const p of ALL_PACKS) {
    const names = p.kindNames[kind.toLowerCase()];
    if (!names) continue;
    for (const name of names) {
      const t = normalizeAndStem(name);
      if (!t.length) continue;
      full.push(t);
      aliases.push(t);
      if (t.length > 1) aliases.push([t[0]]);
    }
  }
  return { full, aliases };
}

function buildIndex(d: Diagram): Index {
  const components = d.components.filter(
    (c): c is Component => !!c && typeof c.id === 'string' && Array.isArray(c.terminals) && c.terminals.length === 2,
  );
  const nodes = d.nodes.filter((n): n is string => typeof n === 'string' && n.length > 0);
  const componentById = new Map(components.map((c) => [normalizeText(c.id).replace(/ /g, ''), c] as const));
  const nodeByKey = new Map(nodes.map((n) => [normalizeText(n).replace(/ /g, ''), n] as const));
  const kindMap = new Map<string, KindEntry>();
  for (const c of components) {
    const key = c.kind.toLowerCase();
    let entry = kindMap.get(key);
    if (!entry) {
      entry = { kind: c.kind, ...kindPhrases(c.kind), components: [] };
      kindMap.set(key, entry);
    }
    entry.components.push(c);
  }
  return { components, nodes, componentById, nodeByKey, kinds: [...kindMap.values()] };
}

function matchAt(tokens: string[], i: number, phrase: string[]): boolean {
  return phrase.length > 0 && i + phrase.length <= tokens.length && phrase.every((p, k) => tokens[i + k] === p);
}

function containsPhrase(tokens: string[], phrase: string[]): boolean {
  return tokens.some((_, i) => matchAt(tokens, i, phrase));
}

function toNumber(token: string | undefined): string | null {
  if (token === undefined) return null;
  if (/^\d+$/.test(token)) return String(Number(token));
  return VOCAB.numbers.get(token) ?? null;
}

function trailingNumber(id: string): string | null {
  const m = /(\d+)$/.exec(id);
  return m ? String(Number(m[1])) : null;
}

const idKey = (c: Component) => normalizeText(c.id).replace(/ /g, '');

// ---------- value references ("the 4 ohm resistor") ----------

type ValuePair = { num: number; unit: string };

function valuePairs(text: string): ValuePair[] {
  const t = valueTokens(text);
  const pairs: ValuePair[] = [];
  for (let i = 0; i + 1 < t.length; i++) {
    const unit = VOCAB.units.get(t[i + 1]);
    if (/^\d/.test(t[i]) && unit) pairs.push({ num: Number(t[i]), unit });
  }
  return pairs;
}

function componentsWithValue(index: Index, wanted: ValuePair[]): Component[] {
  return index.components.filter((c) => {
    const have = valuePairs(c.value);
    return wanted.every((w) => have.some((h) => h.num === w.num && h.unit === w.unit));
  });
}

/** Unit words that are part of a real component value ("3 mA" of a current source) are not refusal triggers. */
function valueUnitTokens(raw: string, index: Index): Set<string> {
  const pairs = valuePairs(raw);
  if (!pairs.length || !componentsWithValue(index, pairs).length) return new Set();
  const unitTokens = new Set<string>();
  const t = valueTokens(raw);
  for (let i = 0; i + 1 < t.length; i++) if (/^\d/.test(t[i]) && VOCAB.units.has(t[i + 1])) unitTokens.add(stemToken(t[i + 1]));
  return unitTokens;
}

// ---------- refusal ----------

/** Remove full kind names ("current source") so they don't trigger refusal words ("current"). */
function withoutKindNames(tokens: string[], index: Index): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = index.kinds.flatMap((k) => k.full).find((ph) => matchAt(tokens, i, ph));
    if (hit) {
      i += hit.length;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out;
}

function isRefusal(tokens: string[]): boolean {
  if (tokens.some((t) => VOCAB.refusal.has(t))) return true;
  return VOCAB.refusalPhrases.some((ph) => containsPhrase(tokens, ph));
}

// ---------- explicit ids and nodes ----------

/** Merge spoken forms like "are two", "r 2", "resistor 2" into component ids that exist. */
function canonicalize(tokens: string[], index: Index): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    let replaced = false;
    for (const k of index.kinds) {
      const ph = k.aliases.find((a) => matchAt(tokens, i, a));
      const n = ph ? toNumber(tokens[i + ph.length]) : null;
      if (ph && n !== null) {
        const c = k.components.find((x) => trailingNumber(x.id) === n);
        if (c) {
          out.push(idKey(c));
          i += ph.length + 1;
          replaced = true;
          break;
        }
        // "resistor 4" when only R1, R2 exist -> "r4" so it is reported as not found.
        const prefixes = new Set(k.components.map((x) => idKey(x).replace(/\d+$/, '')));
        if (prefixes.size === 1) {
          const [prefix] = prefixes;
          if (/^[a-z]{1,3}$/.test(prefix)) {
            out.push(`${prefix}${n}`);
            i += ph.length + 1;
            replaced = true;
            break;
          }
        }
      }
    }
    if (replaced) continue;
    const letter = VOCAB.letters.get(tokens[i]) ?? (/^[a-z]{1,3}$/.test(tokens[i]) ? tokens[i] : null);
    const n = toNumber(tokens[i + 1]);
    if (letter && n !== null && index.componentById.has(`${letter}${n}`)) {
      out.push(`${letter}${n}`);
      i += 2;
      continue;
    }
    out.push(tokens[i]);
    i += 1;
  }
  return out;
}

function resolveNode(token: string | undefined, index: Index): string | null {
  if (token === undefined) return null;
  const direct = index.nodeByKey.get(token);
  if (direct) return direct;
  const letter = VOCAB.letters.get(token);
  if (letter && index.nodeByKey.has(letter)) return index.nodeByKey.get(letter)!;
  const n = toNumber(token);
  if (n !== null && index.nodeByKey.has(n)) return index.nodeByKey.get(n)!;
  return null;
}

type NodeScan = { nodes: string[]; missing: string | null };

function scanNodes(tokens: string[], index: Index): NodeScan {
  const nodes: string[] = [];
  let missing: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (!VOCAB.nodeWords.has(tokens[i])) continue;
    let j = i + 1;
    while (j < tokens.length) {
      const t = tokens[j];
      if (VOCAB.and.has(t) || VOCAB.nodeWords.has(t)) {
        j++;
        continue;
      }
      const n = resolveNode(t, index);
      if (n) {
        if (!nodes.includes(n)) nodes.push(n);
        j++;
        continue;
      }
      if (j === i + 1 && !VOCAB.stop.has(t) && !VOCAB.overview.has(t) && !VOCAB.ordinals.has(t)) {
        missing = t.toUpperCase();
      }
      break;
    }
  }
  return { nodes, missing };
}

function findBetween(tokens: string[], index: Index): [string, string] | null {
  const at = tokens.findIndex((t) => VOCAB.between.has(t));
  if (at < 0) return null;
  const found: string[] = [];
  for (const t of tokens.slice(at + 1)) {
    const n = resolveNode(t, index);
    if (!n) {
      if (VOCAB.and.has(t) || VOCAB.nodeWords.has(t) || VOCAB.stop.has(t)) continue;
      break;
    }
    if (!found.includes(n)) found.push(n);
    if (found.length === 2) return [found[0], found[1]];
  }
  return null;
}

function connects(c: Component, a: string, b: string): boolean {
  return (c.terminals[0] === a && c.terminals[1] === b) || (c.terminals[0] === b && c.terminals[1] === a);
}

function mentionedKinds(tokens: string[], index: Index): KindEntry[] {
  return index.kinds.filter((k) => k.aliases.some((a) => containsPhrase(tokens, a)));
}

// ---------- contextual references ----------

type Context = { focus: DiagramFocus | null; lastComponent: string | null };

type Substitution =
  | { ok: true; tokens: string[] }
  | { ok: false; ask: 'component' }
  | { ok: false; ask: 'node' }
  | { ok: false; ask: 'componentAtNode'; node: string };

const NODE_WORD = 'node';
const key = (id: string) => normalizeText(id).replace(/ /g, '');

function componentsAt(index: Index, node: string): Component[] {
  return index.components.filter((c) => c.terminals.includes(node));
}

/**
 * Replace "it", "its", "that one", "that resistor" with the focused id and
 * "there" with the focused node. "this circuit", "components that touch…",
 * "is there", "are there" are not references.
 */
function substitutePronouns(tokens: string[], index: Index, ctx: Context): Substitution {
  const { focus } = ctx;
  const out: string[] = [];
  const focusComponent = focus?.type === 'component' ? index.componentById.get(key(focus.id)) : undefined;
  const focusKind = focusComponent ? index.kinds.find((k) => k.components.includes(focusComponent)) : undefined;
  const asksAttribute = tokens.some((t) => VOCAB.attribute.has(t));

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const prev = tokens[i - 1];

    // "there" = the node in focus; "is there", "are there" only mean "exists".
    if (VOCAB.place.has(t)) {
      if (prev !== undefined && VOCAB.existential.has(prev)) {
        out.push(t);
        continue;
      }
      if (focus?.type !== 'node') return { ok: false, ask: 'node' };
      out.push(NODE_WORD, key(focus.id));
      continue;
    }

    if (!VOCAB.pronouns.has(t)) {
      out.push(t);
      continue;
    }
    // Relative pronoun after a noun: "components that touch node B".
    const relative =
      prev !== undefined &&
      (VOCAB.componentWords.has(prev) || VOCAB.nodeWords.has(prev) || index.componentById.has(prev) ||
        index.kinds.some((k) => k.aliases.some((a) => a[a.length - 1] === prev)));
    // "it"/"its" always refer. Bare "that"/"this" refer only at the end, before "one",
    // a kind name, or a predicate word ("is that connected…"); otherwise they start a clause.
    const isDemonstrative = t === 'that' || t === 'this';
    const predicate = next !== undefined && ['is', 'connected', 'attached', 'value', 'values', 'kind', 'type'].includes(next);
    const beforeKind = next !== undefined && index.kinds.some((k) => k.aliases.some((a) => matchAt(tokens, i + 1, a)));
    const clause = isDemonstrative && next !== undefined && next !== 'one' && !predicate && !beforeKind &&
      !VOCAB.overview.has(next) && !VOCAB.nodeWords.has(next) && !VOCAB.componentWords.has(next);
    if (relative || clause) {
      out.push(t);
      continue;
    }
    const determinerOfOther =
      next !== undefined &&
      (VOCAB.overview.has(next) || VOCAB.nodeWords.has(next) || VOCAB.componentWords.has(next) ||
        index.kinds.some((k) => k !== focusKind && k.aliases.some((a) => a[0] === next)));
    if (determinerOfOther) {
      out.push(t);
      continue;
    }
    if (!focus) return { ok: false, ask: 'component' };

    const focusAlias = focusKind?.aliases
      .filter((a) => matchAt(tokens, i + 1, a))
      .sort((x, y) => y.length - x.length)[0];
    const skip = next === 'one' ? 1 : (focusAlias?.length ?? 0);

    if (focus.type === 'component') {
      out.push(key(focus.id));
    } else if (asksAttribute) {
      // A node has no value or kind: "its value" means one of its components.
      const cs = componentsAt(index, focus.id);
      if (cs.length !== 1) return { ok: false, ask: 'componentAtNode', node: focus.id };
      out.push(idKey(cs[0]));
    } else {
      out.push(NODE_WORD, key(focus.id));
    }
    i += skip; // "that one", "that resistor", "that voltage source"
  }
  return { ok: true, tokens: out };
}

type TerminalRef = { node: string } | 'ask' | 'none' | undefined;

/** "its first node", "the second terminal of R2", "the other end of R2" (relative to the node in focus). */
function terminalReference(tokens: string[], c: Component, focus: DiagramFocus | null): TerminalRef {
  for (let j = 1; j < tokens.length; j++) {
    if (!(VOCAB.terminal.has(tokens[j]) || VOCAB.nodeWords.has(tokens[j]))) continue;
    const before = tokens[j - 1];
    const ord = VOCAB.ordinals.get(before);
    if (ord !== undefined) {
      if (ord === 1) return { node: c.terminals[0] };
      if (ord === 2 || ord === -1) return { node: c.terminals[1] };
      return 'none'; // a component has exactly two terminals
    }
    if (VOCAB.other.has(before)) {
      if (focus?.type === 'node' && c.terminals.includes(focus.id)) {
        return { node: c.terminals[0] === focus.id ? c.terminals[1] : c.terminals[0] };
      }
      return 'ask';
    }
  }
  return undefined;
}

function example(index: Index): Example {
  return {
    component: index.components[0]?.id ?? 'R1',
    node: index.nodes[0] ?? 'A',
    otherNode: index.nodes[1] ?? index.nodes[0] ?? 'B',
  };
}

// ---------- resolver ----------

function single(r: Responses, c: Component): Answer {
  return { text: r.component(c), focus: { type: 'component', id: c.id } };
}

function pick(r: Responses, cands: Component[], index: Index, prev: DiagramFocus | null): Answer {
  if (cands.length === 1) return single(r, cands[0]);
  if (cands.length === 0) return { text: r.noMatch(index.components), focus: prev };
  return { text: r.matches(cands), focus: prev };
}

function nodeAnswer(r: Responses, index: Index, node: string): Answer {
  return { text: r.node(node, componentsAt(index, node)), focus: { type: 'node', id: node } };
}

function resolve(diagram: Diagram, raw: string, language: VoiceLanguage | undefined, ctx: Context): Answer {
  const { focus } = ctx;
  const lang: VoiceLanguage = hasArabic(raw) ? 'ar' : (language ?? getLanguage());
  const r = (PACKS[lang] ?? PACKS.en).responses;
  const keep = (text: string): Answer => ({ text, focus });
  // Solution requests are refused even when the question has no diagram.
  if (!isDiagram(diagram)) return { text: isRefusal(normalizeAndStem(raw)) ? r.refusal : r.noDiagram, focus: null };

  const index = buildIndex(diagram);
  const stemmed = normalizeAndStem(raw);

  const exemptUnits = valueUnitTokens(raw, index);
  if (isRefusal(withoutKindNames(stemmed, index).filter((t) => !exemptUnits.has(t)))) return keep(r.refusal);

  const sub = substitutePronouns(canonicalize(stemmed, index), index, ctx);
  if (!sub.ok) {
    if (sub.ask === 'node') return keep(r.whichNode(example(index)));
    if (sub.ask === 'componentAtNode') return keep(r.whichAtNode(sub.node, componentsAt(index, sub.node)));
    return keep(r.whichOne(example(index)));
  }
  const tokens = sub.tokens;
  if (tokens.some((t) => VOCAB.help.has(t))) return keep(r.help(example(index)));

  const kinds = mentionedKinds(tokens, index);
  const ofKinds = (cs: Component[]) => (kinds.length ? cs.filter((c) => kinds.some((k) => k.components.includes(c))) : cs);

  // "between node A and node B" (optionally "the resistor between …")
  const between = findBetween(tokens, index);
  if (between) {
    const [a, b] = between;
    const cands = ofKinds(index.components.filter((c) => connects(c, a, b)));
    if (cands.length === 1 && kinds.length) return single(r, cands[0]);
    return keep(r.between(a, b, cands));
  }

  // explicit ids
  const comps: Component[] = [];
  let missingComponent: string | null = null;
  for (const t of tokens) {
    const c = index.componentById.get(t);
    if (c) {
      if (!comps.includes(c)) comps.push(c);
    } else if (/^[a-z]{1,3}\d{1,3}$/.test(t) && !missingComponent) {
      missingComponent = t.toUpperCase();
    }
  }

  // "its first node", "the other end of R2"
  if (comps.length === 1) {
    const term = terminalReference(tokens, comps[0], focus);
    if (term === 'ask') return keep(r.whichNode(example(index)));
    if (term === 'none') return keep(r.noMatch(index.components));
    if (term) return nodeAnswer(r, index, term.node);
  }

  const scan = scanNodes(tokens, index);
  const content = tokens.filter((t) => !VOCAB.stop.has(t));
  if (!comps.length && !scan.nodes.length && content.length === 1) {
    const n = index.nodeByKey.get(content[0]);
    if (n) scan.nodes.push(n);
  }

  const saysOther = tokens.some((t) => VOCAB.other.has(t));
  const last = ctx.lastComponent ? index.components.find((c) => c.id === ctx.lastComponent) : undefined;

  // "what other components are connected there" -> node in focus, minus the last component discussed
  if (saysOther && !comps.length && scan.nodes.length === 1) {
    const n = scan.nodes[0];
    const excluded = last && last.terminals.includes(n) ? last : undefined;
    const cands = ofKinds(componentsAt(index, n)).filter((c) => c !== excluded);
    return { text: r.othersAtNode(n, excluded?.id ?? null, cands), focus: { type: 'node', id: n } };
  }

  // "the other resistor", "the other one"
  if (saysOther && !comps.length) {
    const base = focus?.type === 'component' ? index.components.find((c) => c.id === focus.id) : last;
    const kind = kinds[0] ?? (base ? index.kinds.find((k) => k.components.includes(base)) : undefined);
    if (!kind) return keep(r.whichOne(example(index)));
    const cands = kind.components.filter((c) => c !== base);
    if (!cands.length) return keep(r.noOther(kind.kind));
    if (!base && cands.length > 1) return keep(r.matches(cands));
    return pick(r, cands, index, focus);
  }

  if (comps.length) {
    const parts = [...comps.map((c) => r.component(c)), ...scan.nodes.map((n) => r.node(n, componentsAt(index, n)))];
    return { text: parts.join(' '), focus: comps.length === 1 ? { type: 'component', id: comps[0].id } : focus };
  }
  if (missingComponent) return keep(r.componentNotFound(missingComponent, index.components));
  if (scan.missing && !scan.nodes.length) return keep(r.nodeNotFound(scan.missing, index.nodes));

  // "the 4 ohm resistor", "the 12 volt source"
  const wanted = valuePairs(raw);
  if (wanted.length) return pick(r, ofKinds(componentsWithValue(index, wanted)), index, focus);

  // "the first resistor", "the last component", "the second node"
  const ordinal = tokens.map((t) => VOCAB.ordinals.get(t)).find((n) => n !== undefined);
  if (ordinal !== undefined) {
    const wantsNodes = !kinds.length && tokens.some((t) => VOCAB.nodeWords.has(t)) && !scan.nodes.length;
    const list = wantsNodes ? index.nodes : kinds.length === 1 ? kinds[0].components : index.components;
    const item = ordinal === -1 ? list[list.length - 1] : list[ordinal - 1];
    if (item === undefined) return keep(r.noMatch(index.components));
    if (typeof item === 'string') return nodeAnswer(r, index, item);
    return single(r, item);
  }

  if (scan.nodes.length) {
    // "the resistor at node C", "which resistors touch node B"
    if (kinds.length) {
      const cands = ofKinds(index.components.filter((c) => scan.nodes.some((n) => c.terminals.includes(n))));
      if (!cands.length) return keep(r.noneAtNode(kinds[0].kind, scan.nodes[0]));
      return pick(r, cands, index, focus);
    }
    if (scan.nodes.length === 1) return nodeAnswer(r, index, scan.nodes[0]);
    return keep(scan.nodes.map((n) => r.node(n, componentsAt(index, n))).join(' '));
  }

  if (kinds.length) {
    const text = kinds.map((k) => r.kindList(k.kind, k.components)).join(' ');
    const all = kinds.flatMap((k) => k.components);
    return { text, focus: all.length === 1 ? { type: 'component', id: all[0].id } : focus };
  }

  if (content.some((t) => VOCAB.nodeWords.has(t))) return keep(r.nodeList(index.nodes));
  if (content.some((t) => VOCAB.componentWords.has(t))) return keep(r.componentList(index.components));
  if (content.every((t) => VOCAB.overview.has(t) || VOCAB.pronouns.has(t))) {
    return keep(r.overview(diagram, index.nodes, index.components));
  }
  return keep(r.unknown(example(index)));
}

/** Refusal check shared by lookups and exploration names ("follow the current through R1"). */
function refuses(diagram: Diagram | null, raw: string): boolean {
  const stemmed = normalizeAndStem(raw);
  if (!isDiagram(diagram)) return isRefusal(stemmed);
  const index = buildIndex(diagram);
  const exempt = valueUnitTokens(raw, index);
  return isRefusal(withoutKindNames(stemmed, index).filter((t) => !exempt.has(t)));
}

function replyLanguage(raw: string, language?: VoiceLanguage): VoiceLanguage {
  return hasArabic(raw) ? 'ar' : (language ?? getLanguage());
}

/**
 * Answer a factual question about an approved diagram.
 * Reply language: Arabic if the query contains Arabic script, otherwise the
 * explicit `language` argument, otherwise the active voice language.
 * Solution/hint requests are refused even when `diagram` is null.
 *
 * Lookups are stateless (contract). Guided-tour and relationship-exploration
 * commands ("start the tour", "next part", "follow R1") keep a small per-diagram
 * session so they also work through this function (one session per diagram object).
 */
export function describeDiagram(diagram: Diagram | null, query: string, language?: VoiceLanguage): string {
  const raw = String(query ?? '');
  if (isDiagram(diagram) && parseExploreAction(raw)) {
    let session = sessions.get(diagram);
    if (!session) sessions.set(diagram, (session = createDiagramExplorer(diagram, language)));
    return session.ask(raw);
  }
  return resolve(diagram as Diagram, raw, language, { focus: null, lastComponent: null }).text;
}

const sessions = new WeakMap<Diagram, DiagramExplorer>();

export interface DiagramExplorer {
  /** Same answers as describeDiagram, plus "it", "there", "that one", "the other resistor", tours and "follow R1". */
  ask(query: string): string;
  /** Forget the focus, the last component, the tour, the exploration position and the detail level. */
  reset(): void;
  /** Component or node the last answer was about, if exactly one. */
  readonly focus: DiagramFocus | null;
  /** True while a guided tour runs or an exploration position is set. */
  readonly exploring: boolean;
  /** "Where am I?" for the diagram: tour part and/or exploration position. */
  where(language?: VoiceLanguage): string;
}

/**
 * Stateful explorer for one question's diagram. Create a new one per
 * question (or call reset()) so references never carry across questions.
 */
export function createDiagramExplorer(diagram: Diagram | null, language?: VoiceLanguage): DiagramExplorer {
  const ctx: Context = { focus: null, lastComponent: null };
  // Inconsistent data disables exploration only; ordinary lookups keep working.
  const makeVisual = () => {
    if (!isDiagram(diagram)) return null;
    try {
      return new VisualExplorer(circuitToVisual(diagram));
    } catch {
      return null;
    }
  };
  let visual = makeVisual();

  /** Keep "it"/"its value" pointing at what exploration just described. */
  const syncFocus = () => {
    const id = visual?.lastElement;
    if (!id) return;
    if (id.startsWith('node:')) ctx.focus = { type: 'node', id: id.slice('node:'.length) };
    else {
      ctx.focus = { type: 'component', id };
      ctx.lastComponent = id;
    }
  };

  return {
    ask(query: string): string {
      const raw = String(query ?? '');
      const action = visual ? parseExploreAction(raw) : null;
      if (visual && action) {
        // Names inside exploration commands get the same refusal check as lookups.
        const name = action.type === 'goTo' || action.type === 'follow' ? action.ref ?? '' : '';
        if (name && refuses(diagram, name)) return (PACKS[replyLanguage(raw, language)] ?? PACKS.en).responses.refusal;
        const text = visual.act(action, language, raw);
        syncFocus();
        return text;
      }
      const answer = resolve(diagram as Diagram, raw, language, ctx);
      ctx.focus = answer.focus;
      if (answer.focus?.type === 'component') ctx.lastComponent = answer.focus.id;
      return answer.text;
    },
    reset(): void {
      ctx.focus = null;
      ctx.lastComponent = null;
      visual = makeVisual();
    },
    get focus(): DiagramFocus | null {
      return ctx.focus;
    },
    get exploring(): boolean {
      return visual?.isActive ?? false;
    },
    where(lang?: VoiceLanguage): string {
      return visual ? visual.act({ type: 'where' }, lang ?? language) : (PACKS[lang ?? language ?? getLanguage()] ?? PACKS.en).responses.noDiagram;
    },
  };
}
