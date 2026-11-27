// Answer-editing helpers: let a student fix a dictated answer by voice
// without re-dictating it, e.g. "replace three with four", "add through R2",
// "delete the last word", "undo".
//
// Rules:
//  - Edits are explicit commands parsed in command/confirm mode, never inferred
//    from dictation. Inserted text (after "add", "with", …) is kept as spoken.
//  - A target that is not found, or found more than once, changes nothing and
//    says so ("replace every …" changes all matches).
//  - Edits never save: the UI reads the new text back and requires confirm.
//  - Pure and deterministic; no browser APIs. English only (demo language).

export type EditCommand =
  | { type: 'append'; text: string }
  | { type: 'replace'; target: string; replacement: string; all: boolean }
  | { type: 'delete'; target: string; all: boolean }
  | { type: 'deleteLastWords'; count: number }
  | { type: 'insert'; text: string; position: 'before' | 'after'; anchor: string }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'help' };

export type EditFailure =
  | { ok: false; reason: 'notFound'; target: string }
  | { ok: false; reason: 'ambiguous'; target: string; count: number }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'nothingToUndo' };

export type EditResult = { ok: true; text: string; changed: boolean } | EditFailure;

// ---------- parsing ----------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Chrome often appends a full stop or question mark to a whole command; strip one. */
function cleanUtterance(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .replace(/^(?:please|ok|okay|now)[, ]+/i, '')
    .trim();
}

/** Remove a trailing "to my answer" / "at the end" from an append payload. */
function stripAnswerSuffix(payload: string): string {
  return payload.replace(/\s+(?:to|at the end of|onto)\s+(?:my|the)\s+answer$/i, '').replace(/\s+at the end$/i, '').trim();
}

function unquote(s: string): string {
  return s.trim().replace(/^["“'](.*)["”']$/, '$1').trim();
}

/**
 * Recognise an edit command, or return null so the caller can try other
 * parsers. Payload text keeps the speaker's wording and case.
 */
export function parseEditCommand(text: string): EditCommand | null {
  const s = cleanUtterance(text);
  if (!s) return null;
  let m: RegExpMatchArray | null;

  if (/^(?:edit|edit (?:my |the )?answer|editing|edit commands|how (?:can|do) i edit(?: (?:my|the) answer)?)$/i.test(s)) {
    return { type: 'help' };
  }
  if (/^(?:undo|undo that|undo (?:the )?last (?:change|edit)|undo the change)$/i.test(s)) return { type: 'undo' };
  if (
    /^(?:clear|clear (?:my |the )?answer|clear everything|start over|erase everything|(?:delete|remove|erase) (?:everything|all of it|(?:my|the) (?:whole )?answer))$/i.test(s)
  ) {
    return { type: 'clear' };
  }

  // "delete the last word", "remove the last three words"
  if ((m = s.match(/^(?:delete|remove|erase|cut)\s+(?:the\s+)?last\s+(?:(\w+)\s+)?words?$/i))) {
    const raw = m[1]?.toLowerCase();
    const count = raw === undefined ? 1 : /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    return count && count > 0 ? { type: 'deleteLastWords', count } : null;
  }

  // "replace three with four", "change x to y", "replace every x with y"
  if ((m = s.match(/^(?:replace|change|substitute|swap)\s+(every|all|each)?\s*(.+?)\s+(?:with|to|by|for)\s+(.+)$/i))) {
    const target = unquote(m[2]);
    const replacement = unquote(m[3]);
    if (!target || !replacement || /^(?:my|the)\s+answer$/i.test(target)) return null;
    return { type: 'replace', target, replacement, all: !!m[1] };
  }

  // "insert about before 3", "put plus C after 3"
  if ((m = s.match(/^(?:insert|put|add)\s+(.+?)\s+(before|after)\s+(.+)$/i))) {
    const t = unquote(m[1]);
    const anchor = unquote(m[3]);
    if (t && anchor) return { type: 'insert', text: t, position: m[2].toLowerCase() as 'before' | 'after', anchor };
  }

  // "add through R2", "append plus C to my answer"
  if ((m = s.match(/^(?:add|append|continue with|type)\s+(.+)$/i))) {
    const t = unquote(stripAnswerSuffix(m[1]));
    return t ? { type: 'append', text: t } : null;
  }

  // "delete amps", "remove every comma"
  if ((m = s.match(/^(?:delete|remove|erase|cut)\s+(every|all|each)?\s*(?:the\s+word\s+)?(.+)$/i))) {
    const target = unquote(m[2]);
    return target ? { type: 'delete', target, all: !!m[1] } : null;
  }
  return null;
}

// ---------- matching ----------

type Word = { start: number; end: number; core: string; canon: string };

const SYMBOL_CANON: Record<string, string> = {
  plus: '+', '+': '+', minus: '-', '-': '-', '−': '-', times: '*', '*': '*', '×': '*', equals: '=', '=': '=',
  over: '/', '/': '/', point: '.',
};
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', twenty: '20',
};
const EDGE_PUNCT = /^[("'“‘[]+|[)"'”’\].,;:!?]+$/g;

function canonical(word: string): string {
  const w = word.toLowerCase();
  return SYMBOL_CANON[w] ?? DIGIT_WORDS[w] ?? w;
}

/** Words of `text` with their character spans; the core excludes edge punctuation. */
function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const raw = m[0];
    const lead = raw.length - raw.replace(/^[("'“‘[]+/, '').length;
    const trail = raw.length - raw.replace(/[)"'”’\].,;:!?]+$/, '').length;
    const start = (m.index ?? 0) + lead;
    const end = (m.index ?? 0) + raw.length - trail;
    const core = text.slice(start, end);
    if (!core) continue;
    out.push({ start, end, core, canon: canonical(core) });
  }
  return out;
}

type Span = { start: number; end: number };

/** Every place `target` occurs: by spoken-equivalent words first, then as plain text. */
function findTarget(text: string, target: string): Span[] {
  const hay = words(text);
  const needle = words(target).map((w) => w.canon);
  const spans: Span[] = [];
  if (needle.length) {
    for (let i = 0; i + needle.length <= hay.length; i++) {
      if (needle.every((n, k) => hay[i + k].canon === n)) {
        spans.push({ start: hay[i].start, end: hay[i + needle.length - 1].end });
        i += needle.length - 1;
      }
    }
  }
  if (spans.length) return spans;
  // Fallback: case-insensitive text match ("2x" inside "2x+3"), not inside a longer word.
  const t = target.replace(EDGE_PUNCT, '').trim();
  if (!t) return [];
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return spans;
}

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim();
}

function spliceAll(text: string, spans: Span[], insert: string): string {
  let out = text;
  for (const sp of [...spans].sort((a, b) => b.start - a.start)) out = out.slice(0, sp.start) + insert + out.slice(sp.end);
  return tidy(out);
}

function pickSpans(text: string, target: string, all: boolean): Span[] | EditFailure {
  const spans = findTarget(text, target);
  if (!spans.length) return { ok: false, reason: 'notFound', target };
  if (spans.length > 1 && !all) return { ok: false, reason: 'ambiguous', target, count: spans.length };
  return spans;
}

// ---------- applying ----------

/** Apply one edit to an answer. Never changes the text on failure. "undo" needs an AnswerDraft. */
export function applyEdit(answer: string, cmd: EditCommand): EditResult {
  const text = String(answer ?? '');
  const ok = (next: string): EditResult => ({ ok: true, text: next, changed: next !== text });

  switch (cmd.type) {
    case 'help':
      return ok(text);
    case 'undo':
      return { ok: false, reason: 'nothingToUndo' };
    case 'clear':
      return ok('');
    case 'append':
      return ok(tidy(text ? `${text} ${cmd.text}` : cmd.text));
  }
  if (!text.trim()) return { ok: false, reason: 'empty' };

  switch (cmd.type) {
    case 'deleteLastWords': {
      const ws = words(text);
      if (cmd.count >= ws.length) return ok('');
      return ok(tidy(text.slice(0, ws[ws.length - cmd.count].start)));
    }
    case 'replace': {
      const spans = pickSpans(text, cmd.target, cmd.all);
      return Array.isArray(spans) ? ok(spliceAll(text, spans, cmd.replacement)) : spans;
    }
    case 'delete': {
      const spans = pickSpans(text, cmd.target, cmd.all);
      return Array.isArray(spans) ? ok(spliceAll(text, spans, '')) : spans;
    }
    case 'insert': {
      const spans = pickSpans(text, cmd.anchor, false);
      if (!Array.isArray(spans)) return spans;
      const [sp] = spans;
      const next =
        cmd.position === 'before'
          ? `${text.slice(0, sp.start)}${cmd.text} ${text.slice(sp.start)}`
          : `${text.slice(0, sp.end)} ${cmd.text}${text.slice(sp.end)}`;
      return ok(tidy(next));
    }
  }
}

/** An answer being edited, with unlimited undo back to where editing started. */
export class AnswerDraft {
  private readonly history: string[];

  constructor(initial = '') {
    this.history = [String(initial ?? '')];
  }

  get text(): string {
    return this.history[this.history.length - 1];
  }

  get canUndo(): boolean {
    return this.history.length > 1;
  }

  /** Replace the whole text (e.g. a new dictation); the previous version stays undoable. */
  replaceAll(text: string): void {
    const next = String(text ?? '');
    if (next !== this.text) this.history.push(next);
  }

  apply(cmd: EditCommand): EditResult {
    if (cmd.type === 'undo') {
      if (!this.canUndo) return { ok: false, reason: 'nothingToUndo' };
      this.history.pop();
      return { ok: true, text: this.text, changed: true };
    }
    const result = applyEdit(this.text, cmd);
    if (result.ok && result.changed) this.history.push(result.text);
    return result;
  }
}
