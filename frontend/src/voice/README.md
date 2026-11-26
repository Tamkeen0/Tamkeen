# Voice module (`frontend/src/voice/`)

Voice agent owns this entire directory. Public entry: `index.ts`. See `agents/voice.md`.

Browser speech adapter plus deterministic command parser and approved-diagram
lookup. **No model calls, no network calls of our own, no hints, no
calculations, no topology inference.** English first; Arabic supported.

## Public API (`import … from '../voice'`)

Contract functions (contracts/API.md):

| Function | Behaviour |
|---|---|
| `speak(text): Promise<void>` | Speaks in the active language. **Stops any active listening first** (mic is never open during TTS). Resolves when finished or interrupted by `stopSpeaking()` / another `speak()`. Rejects `VoiceError` (`unsupported`, `permission-denied` = autoplay block, `language-unavailable`, `unknown`). Long text is chunked by sentence. |
| `stopSpeaking(): void` | Cancels speech; a pending `speak()` resolves. |
| `listenOnce(opts?): Promise<string>` | One utterance, **literal** transcript (only outer whitespace trimmed). Waits for TTS to finish before opening the mic. Default timeout 10 s (`{ timeoutMs }`). Never resolves empty. Rejects `VoiceError` with `code`: `unsupported`, `permission-denied`, `no-speech`, `timeout`, `cancelled`, `audio-capture`, `network`, `busy`, `language-unavailable`, `unknown`. |
| `stopListening(): void` | Cancels an active or waiting listen → rejects `cancelled`. |
| `parseCommand(text): VoiceCommand` | Command mode only. See table below. Anything ambiguous → `{type:'unknown'}`. |
| `describeDiagram(diagram, query, lang?): string` | Factual lookup over approved data, or a fixed refusal. |

Additive helpers (not in the contract; proposed to the lead): `readBackText(answer)`, `VoiceError`,
`isVoiceError`, `isSpeechSupported()`, `isRecognitionSupported()`,
`isSpeaking()`, `isListening()`, `setLanguage('en'|'ar', bcp47Tag?)`,
`getLanguage()`, `languageTag()`, `SUPPORTED_LANGUAGES`,
`setSpeechEnvironment(env|null)` (inject fake speech APIs for tests/demos).

## Commands

Whole utterance must match (case, punctuation and fillers like "please",
"the", "go to" ignored). Negation + command word ("don't submit") → `unknown`.
Two commands at once ("next submit") → `unknown`.

| Type | English | Arabic |
|---|---|---|
| next | next, next question, forward, skip | التالي، السؤال التالي، بعده |
| previous | previous, back, go back | السابق، رجوع، ارجع، قبله |
| repeat | repeat, again, say again, read question | أعد، كرر، إعادة، اقرأ السؤال |
| dictate | dictate, answer, start answer, record answer | إملاء، إجابة، أجب، ابدأ الإجابة |
| confirm | confirm, save, save answer | تأكيد، أكد، احفظ |
| cancel | cancel, stop, no, never mind | إلغاء، توقف، لا، تراجع |
| submit | submit, submit exam, hand in | تسليم، سلم، تسليم الامتحان |
| explore | "explore …", "what is R1", "node B", "between node A and node B", "list components", "describe the circuit" | "استكشف …"، "ما هي قيمة R1"، "العقدة B"، "بين العقدة A والعقدة B"، "المكونات" |

"yes" alone is deliberately **not** confirm. `parseCommand` accepts both
languages regardless of `setLanguage`.

## Diagram lookup (`describeDiagram`)

Answers only: overview (approved description + node/component lists), a
component (kind, verbatim value, its two terminal nodes), a node (components
touching it), components directly between two nodes, components of a kind,
node/component lists, help. Spoken forms like "are two", "R 2",
"resistor two", "ار ٢", "المقاومة 2" resolve only to ids that exist.

Refused with a fixed message: answer/solve/calculate/current/power/hint/
formula/series/parallel/equivalent/total resistance/voltage across/drop/
explain/why/correct… (and Arabic equivalents). The kind name "current source"
is exempt so it can still be looked up. Unknown items get "not in this diagram".

Reply language: Arabic if the query contains Arabic script; else the `lang`
argument; else `getLanguage()`. Values/descriptions are read verbatim from
the exam data (currently English).

## Read-back of dictated answers (`readBackText`)

Chrome dictation auto-formats ("x squared plus three x" → `X ^2 + 3 X`) and
sometimes mishears ("R one" → `or 1`, "Q" → `Queue`). The voice module never
corrects the answer: the stored text stays literal. `readBackText(answer)`
returns a separate, **speak-only** string so the student can verify it by ear:

| Literal (stored) | Read back |
|---|---|
| `X ^2 + 3 X` | X squared plus 3 X |
| `x - 5`, `n−1` | x minus 5, n minus 1 |
| `-5`, `x = -5`, `(-2)^2`, `e^-x` | negative 5, x equals negative 5, open bracket negative 2 close bracket squared, e to the power of negative x |
| `x-axis`, `twenty-one` | unchanged (hyphen inside a word) |
| `f'(x)`, `5!`, `1/2` | f prime open bracket x close bracket, 5 factorial, 1 divided by 2 |
| `Newton's`, `Done!`, `and/or` | unchanged / unchanged / and slash or |
| `sqrt(x)`, `sqrt(x + 1)`, `sin x`, `ln(x)` | square root of x, square root of open bracket x plus 1 close bracket, sine of x, natural log of x |
| `log in`, `a tan coat` | unchanged (function names only convert before `(` or a simple argument) |
| `V_out = 5V`, `10mA`, `2.2kΩ`, `1K ohm`, `4.7 µF`, `50 Hz` | V sub out equals 5 volts, 10 milliamps, 2.2 kilo ohms, 1 kilo ohm, 4.7 microfarads, 50 hertz |
| `9.81 m/s²`, `100 km/h`, `5 N/m²`, `10 rad/s` | 9.81 meters per second squared, 100 kilometers per hour, 5 newtons per meter squared, 10 radians per second |
| `3 m`, `v = d/t`, `x/s` | unchanged / v equals d divided by t / x divided by s (m, s, h only count as units inside "number unit/unit") |
| `2 A`, `3 F`, `3 V1`, `V = I R` | unchanged: A/F/H expand only when glued (`2A`); a letter not after a number is a variable |

Minus is contextual: after an operand (number, variable, number word,
closing bracket) it is subtraction; at the start, after an operator, opening
bracket or ordinary word it is negative. English only.

In diagram exploration (not dictation), the observed mishearings "or 1" → R1
and "queue" → Q resolve, but only to ids that exist in the diagram.

## UI integration (frontend owner)

```ts
import { speak, stopSpeaking, listenOnce, stopListening, parseCommand, describeDiagram,
         isRecognitionSupported, VoiceError, setLanguage } from '../voice';

// Command mode
try {
  const heard = await listenOnce();
  const cmd = parseCommand(heard);
  switch (cmd.type) {
    case 'next': /* UI moves */ break;
    case 'explore': await speak(q.diagram ? describeDiagram(q.diagram, cmd.query) : 'No diagram.'); break;
    case 'submit': /* UI asks "Say confirm to submit" — never submit directly */ break;
    case 'unknown': await speak('Not understood. Say help, or use the keyboard.'); break;
  }
} catch (e) {
  if (e instanceof VoiceError && e.code !== 'cancelled') announce(e.message); // aria-live
}

// Dictation mode: DO NOT call parseCommand on the text.
const literal = await listenOnce();     // store/show THIS exact text
await speak(`You said: ${readBackText(literal)}. Say confirm to save, or cancel.`);
// edit if needed, then explicit confirm → PUT answer with `literal` (never the read-back string)
```

Requirements on the UI:
1. Dictation mode never calls `parseCommand`; read back the literal text and require explicit confirm before `PUT /answers`.
2. `submit` and `confirm` from voice must still go through the UI's explicit confirmation step.
3. Every voice action needs a keyboard equivalent; if `isRecognitionSupported()` is false or a `VoiceError` occurs, announce `err.message` via `aria-live` and keep keyboard flow working.
4. Call `stopListening()` / `stopSpeaking()` on Escape, question change and unmount.
5. Start speech from a user gesture (key/click) — Chrome blocks TTS before interaction (`permission-denied`).
6. Optional language switch: call `setLanguage('ar')` (or `'ar-EG'` tag) and set `<html lang/dir>` in UI.

## Tests

No dependencies needed (Node ≥ 22.6). From the repo root:

```
node --experimental-strip-types --import ./frontend/src/voice/__tests__/register.mjs --test frontend/src/voice/__tests__/*.test.mjs
```

Covers: every phrase per command (EN/AR), fillers, diacritics/spelling
variants, ambiguous/negated/near-miss commands, dictation-like text, explore
routing, fixture lookups (components, nodes, between, kinds, lists,
overview, help, unknown), 22 EN + 16 AR cheating/solution queries refused,
leak checks for computed values (2 A, 4 V, 8 V, 6 ohms, series/parallel),
immutability/determinism, read-back of the six real Chrome dictation samples
plus contextual minus/plus/power/prime/factorial/slash cases, and the speech adapter with fake browser APIs
(unsupported, permission denied, no-speech, timeout, cancel, busy, start
failure, mic closed during TTS, Arabic tags/voices).

Tests are `.mjs` so the lead's `tsc --noEmit` build doesn't need `@types/node`.

### Manual Chrome check (human)

With frontend deps installed (`npm run dev` in `frontend/`), open
`http://localhost:5173/src/voice/dev/harness.html` (dev-only page; not in the
production build). Check:

- [ ] Speak → hear text; Stop speaking cuts it off.
- [ ] Listen for command → allow mic → say "next" → `{"type":"next"}`.
- [ ] Say "explore node B" → hears R1 and R2 facts; "what is the current through R2" → refusal.
- [ ] Deny mic permission (site settings) → `VoiceError[permission-denied]`.
- [ ] Stay silent → `no-speech` or `timeout`; Stop listening → `cancelled`.
- [ ] "Speak, then listen" → mic indicator appears only after speech ends.
- [ ] Typed command field + Enter works without a mic (keyboard fallback).
- [ ] Switch to العربية → Arabic voice installed? Say "التالي" and "العقدة ب".

## Limitations

- Prototype; not validated with blind users or certified accessible.
- Chrome speech recognition sends audio to Google's service (browser-managed, not our code); needs network. Firefox has no recognition → keyboard only.
- Arabic accuracy depends on dialect and installed voices; exam content and component values stay in English until the document engine produces Arabic.
- Phrase lists are fixed; unusual phrasing returns `unknown` (safe by design).
- Literal transcription is whatever the browser recogniser returns; math dictation ("x squared") is not converted.
