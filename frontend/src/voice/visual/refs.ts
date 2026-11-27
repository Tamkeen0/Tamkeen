// Match a spoken name ("node bee", "are one", "check stock", "العقدة ب") to approved elements.
// Only exact or whole-word matches against approved labels and ids; several matches are
// returned so the engine can ask, never guess.
import { ALL_PACKS } from '../lang';
import { normalizeAndStem, normalizeText, stemToken } from '../normalize';
import type { VisualDocument, VisualElement } from './model';

const NUMBERS = new Map<string, string>();
const LETTERS = new Map<string, string>();
const FILLERS = new Set<string>();
const CATEGORY_WORDS = new Set<string>();

for (const p of ALL_PACKS) {
  for (const [w, n] of Object.entries(p.numberWords)) NUMBERS.set(stemToken(normalizeText(w)), n);
  for (const [w, l] of Object.entries(p.letterAliases)) LETTERS.set(stemToken(normalizeText(w)), l);
  for (const w of p.visual.refFillers) for (const t of normalizeAndStem(w)) FILLERS.add(t);
  for (const [key, names] of Object.entries(p.visual.categories)) {
    for (const t of normalizeAndStem(key)) CATEGORY_WORDS.add(t);
    for (const n of names) for (const t of normalizeAndStem(n)) CATEGORY_WORDS.add(t);
  }
  for (const w of p.nodeWords) for (const t of normalizeAndStem(w)) CATEGORY_WORDS.add(t);
}

const num = (t: string) => (/^\d+$/.test(t) ? t : NUMBERS.get(t) ?? null);

/** Spoken-form keys for a name: with/without fillers and category words, numbers and letter names folded. */
export function refKeys(text: string): Set<string> {
  const base = normalizeAndStem(text);
  const variants = [
    base,
    base.filter((t) => !FILLERS.has(t)),
    base.filter((t) => !CATEGORY_WORDS.has(t)),
    base.filter((t) => !FILLERS.has(t) && !CATEGORY_WORDS.has(t)),
  ].filter((v) => v.length);
  const keys = new Set<string>();
  for (const v of variants) {
    keys.add(v.join(''));
    const numbered = v.map((t) => num(t) ?? t);
    keys.add(numbered.join(''));
    // "are one" -> "r1", "bee" -> "b", "ب" -> "b"
    if (numbered.length && LETTERS.has(numbered[0])) keys.add([LETTERS.get(numbered[0])!, ...numbered.slice(1)].join(''));
  }
  return keys;
}

function elementKeys(e: VisualElement): Set<string> {
  const keys = new Set<string>();
  for (const k of refKeys(e.label)) keys.add(k);
  for (const k of refKeys(e.id.replace(/^node:/, ''))) keys.add(k);
  return keys;
}

const words = (text: string) => normalizeAndStem(text).filter((t) => !FILLERS.has(t) && !CATEGORY_WORDS.has(t));

/** Elements a spoken name refers to: exact key matches first, then whole-word matches on multi-word labels. */
export function resolveRef(doc: VisualDocument, ref: string, candidates: VisualElement[] = doc.elements): VisualElement[] {
  const keys = refKeys(ref);
  const exact = candidates.filter((e) => [...elementKeys(e)].some((k) => keys.has(k)));
  if (exact.length) return exact;
  const want = words(ref);
  if (!want.length) return [];
  return candidates.filter((e) => {
    const have = words(e.label);
    return have.length > 1 && want.every((w) => have.includes(w));
  });
}

/** True if a spoken text names this printed label exactly ("yes" for the "yes" arrow). */
export function matchesLabel(ref: string, label: string | undefined): boolean {
  if (!label) return false;
  const a = refKeys(ref);
  return [...refKeys(label)].some((k) => a.has(k));
}
