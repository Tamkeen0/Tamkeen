// Deterministic, approved-data-only diagram lookup.
//
// Answers only visible facts stored in the approved Diagram: the description,
// node names, component ids, kinds, values and terminal nodes. It never
// calculates, infers topology (series/parallel, loops, equivalents) or gives
// hints; such requests get a fixed refusal. Output text is built only from
// fixed templates plus strings copied verbatim from the diagram.

import type { Component, Diagram } from '../../../contracts/types';
import { getLanguage } from './language';
import type { VoiceLanguage } from './language';
import { ALL_PACKS, PACKS } from './lang';
import type { Example, LanguagePack } from './lang/types';
import { hasArabic, normalizeAndStem, normalizeText, stemToken } from './normalize';

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
  };
  for (const p of packs) {
    for (const [w, n] of Object.entries(p.numberWords)) v.numbers.set(stemToken(normalizeText(w)), n);
    for (const [w, l] of Object.entries(p.letterAliases)) v.letters.set(stemToken(normalizeText(w)), l);
    stemmedSet(p.refusalWords).forEach((t) => v.refusal.add(t));
    for (const ph of p.refusalPhrases) v.refusalPhrases.push(normalizeAndStem(ph));
    stemmedSet(p.helpWords).forEach((t) => v.help.add(t));
    stemmedSet(p.nodeWords).forEach((t) => v.nodeWords.add(t));
    stemmedSet(p.componentWords).forEach((t) => v.componentWords.add(t));
    stemmedSet(p.overviewWords).forEach((t) => v.overview.add(t));
    stemmedSet(p.stopWords).forEach((t) => v.stop.add(t));
    stemmedSet(p.betweenWords).forEach((t) => v.between.add(t));
    stemmedSet(p.andWords).forEach((t) => v.and.add(t));
  }
  return v;
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

function toNumber(token: string | undefined): string | null {
  if (token === undefined) return null;
  if (/^\d+$/.test(token)) return String(Number(token));
  return VOCAB.numbers.get(token) ?? null;
}

function trailingNumber(id: string): string | null {
  const m = /(\d+)$/.exec(id);
  return m ? String(Number(m[1])) : null;
}

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
  return VOCAB.refusalPhrases.some((ph) => tokens.some((_, i) => matchAt(tokens, i, ph)));
}

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
          out.push(normalizeText(c.id).replace(/ /g, ''));
          i += ph.length + 1;
          replaced = true;
          break;
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
      if (j === i + 1 && !VOCAB.stop.has(t) && !VOCAB.overview.has(t)) missing = t.toUpperCase();
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

function example(index: Index): Example {
  return {
    component: index.components[0]?.id ?? 'R1',
    node: index.nodes[0] ?? 'A',
    otherNode: index.nodes[1] ?? index.nodes[0] ?? 'B',
  };
}

/**
 * Answer a factual question about an approved diagram.
 * Reply language: Arabic if the query contains Arabic script, otherwise the
 * explicit `language` argument, otherwise the active voice language.
 */
export function describeDiagram(diagram: Diagram, query: string, language?: VoiceLanguage): string {
  const raw = String(query ?? '');
  const lang: VoiceLanguage = hasArabic(raw) ? 'ar' : (language ?? getLanguage());
  const r = (PACKS[lang] ?? PACKS.en).responses;
  if (!isDiagram(diagram)) return r.noDiagram;

  const index = buildIndex(diagram);
  const stemmed = normalizeAndStem(raw);

  if (isRefusal(withoutKindNames(stemmed, index))) return r.refusal;

  const tokens = canonicalize(stemmed, index);
  if (tokens.some((t) => VOCAB.help.has(t))) return r.help(example(index));

  const between = findBetween(tokens, index);
  if (between) {
    const [a, b] = between;
    return r.between(a, b, index.components.filter((c) => connects(c, a, b)));
  }

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
  const scan = scanNodes(tokens, index);
  const content = tokens.filter((t) => !VOCAB.stop.has(t));
  if (!comps.length && !scan.nodes.length && content.length === 1) {
    const n = index.nodeByKey.get(content[0]);
    if (n) scan.nodes.push(n);
  }

  if (comps.length || scan.nodes.length) {
    return [
      ...comps.map((c) => r.component(c)),
      ...scan.nodes.map((n) => r.node(n, index.components.filter((c) => c.terminals.includes(n)))),
    ].join(' ');
  }
  if (missingComponent) return r.componentNotFound(missingComponent, index.components);
  if (scan.missing) return r.nodeNotFound(scan.missing, index.nodes);

  const kinds = index.kinds.filter((k) => k.aliases.some((a) => tokens.some((_, i) => matchAt(tokens, i, a))));
  if (kinds.length) {
    return kinds.map((k) => r.kindList(k.kind, k.components)).join(' ');
  }

  if (content.some((t) => VOCAB.nodeWords.has(t))) return r.nodeList(index.nodes);
  if (content.some((t) => VOCAB.componentWords.has(t))) return r.componentList(index.components);
  if (content.every((t) => VOCAB.overview.has(t))) return r.overview(diagram, index.nodes, index.components);
  return r.unknown(example(index));
}
