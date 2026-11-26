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

Additive helpers (not in the contract; proposed to the lead): `parseNavigation(text)`, `createDiagramExplorer(diagram)`, `readBackText(answer)`, `questionSpeech`/`prompts`/`recoveryPrompt`/`needsKeyboardFallback`, `VoiceError`,
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
languages regardless of `setLanguage`. Repeat also accepts "read the current question again",
"read this question", "what is the question".

### Voice-guided navigation (`parseNavigation`, scoped adapter)

| Say | Result | Spoken by the UI (`prompts.*`) |
|---|---|---|
| "Go to the next question." | `parseCommand` → `next` | `questionSpeech(…)` |
| "Go back to question two.", "question 3", "the second question", "the final question" | `{type:'goto', question:2}` (1-based; `-1` = final) | `questionSpeech(…)`, or `noSuchQuestion(n, total)` |
| "Read the current question again." | `parseCommand` → `repeat` | `questionSpeech(…)` |
| "How many questions are remaining?", "where am I", "how many have I answered" | `{type:'progress'}` | `progress(index, total, answeredFlags)` → position, how many follow, which are unanswered |
| "Read my previous answer.", "what was my answer to question 2" | `{type:'readAnswer', question?}` (omitted = current question) | `savedAnswer(index, literal)` (read back with `readBackText`) |

Call `parseNavigation(text)` **first** in command mode, then `parseCommand(text)`. Never in
dictation mode. Rules the tests enforce:
- "Read my answer" needs "my"/"I", so "what is the answer" stays a refused solution request, and
  "is my answer correct" / "check my answer" are never read back (refused instead).
- Negated ("don't go to question 2") → `null`. "the last question" is ambiguous (previous vs final) → `null`.
- Chrome's "question to/for" → question 2/4 (only right after "question").
- While an answer or submission awaits confirmation, navigation is held: `prompts.navigationBlocked` + the reminder.
- "My previous answer" = the answer already saved for the **current** question.

## Contract requests (for the lead)

File `contracts/types.ts`, type `VoiceCommand`. Proposed additive members, so these can move
from scoped adapters into `parseCommand` (affects voice + frontend):

```ts
| { type: 'goto'; question: number }        // parseNavigation today
| { type: 'progress' }                      // parseNavigation today
| { type: 'readAnswer'; question?: number } // parseNavigation today
| { type: 'unsupported' }                   // solution requests; routed to explore + refusal today
```

Plus the additive exports listed under "Public API". Until approved, the adapters keep the
contract unchanged.

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

### Component reference resolution

| Reference | Example | Resolves to (fixture) |
|---|---|---|
| explicit id / spoken id | "R2", "are two", "resistor 2" | R2 ("resistor 4" → "There is no R4") |
| by value (number **and** unit) | "the 4 ohm resistor", "the 12 volt source" | R2, V1 |
| by order (approved list order) | "the first resistor", "the last component", "the second node" | R1, R2, node B |
| by place | "the resistor at node C", "the resistor between node B and node C" | R2 |
| contextual (explorer only) | "its value", "is that connected to node B", "that one", "the other resistor" | last focus / the other one |

- Several matches → listed ("2 components match: …"), never guessed. No match → "No component … matches".
- Prefixed units are separate: "3 mA" never matches "3 A"; "100 kilohm" never matches "100 ohms".
- A pronoun with nothing discussed yet → "Which component do you mean?".
- "this circuit", "components that touch node B" are not treated as references.
- Refusals run first: "the current through it", "is it in series with R1" are refused; a refusal does not move the focus.
- Nothing is derived from component-to-component relations (no "the one in series with R1").

`createDiagramExplorer(diagram)` (additive helper) wraps the same lookup and
remembers the last single component/node answered:

```ts
const explorer = createDiagramExplorer(question.diagram); // new one per question
speak(explorer.ask('R2'));               // "R2 is a resistor with value 4 ohms, …"
speak(explorer.ask('what is its value')); // same R2
speak(explorer.ask('the other resistor')); // R1
explorer.reset();                         // or create a new explorer on question change
```

More contextual references (explorer):

| Conversation | Answer |
|---|---|
| "What is R2?" → "What is connected to its first node?" → "What other components are connected there?" | R2 → node B → "Besides R2, node B is connected to R1 … and R3 …" |
| "What is R2?" → "What is R4?" → "What is its value?" | focus moves to R4 → 2.2 ohms |
| "What is R2?" → "What is connected to node A?" → "What is its value?" | latest focus is node A → "Node A has 2 components: V1 and R1. Which one do you mean?" |

- Terminals: "its first node", "the second terminal of R2", "the other end of R2" (relative to the node in focus; otherwise asks which node). Terminal order is the approved data order.
- "there" = the node in focus ("Which node do you mean?" if none); "is there" / "are there" stay existential.
- "its value" / "its kind" with a node in focus resolves only when the node has one component; otherwise it asks.
- "other … there/at node B" excludes the last component discussed.

### Solution requests in command mode

`parseCommand("Solve this circuit")` → `{type:'explore', query:'solve this circuit'}` and
`describeDiagram` / `explorer.ask` return the fixed refusal — **also when the question has no
diagram** (pass `null`). Words like "answer", "current", "power" alone don't trigger this
(they appear in dictation and commands); phrases like "current through", "what is the answer" do.
**Lead proposal:** add `{ type: 'unsupported' }` to `VoiceCommand` so the UI can tell a refused
request from an exploration; until then this routing keeps the contract unchanged.

`describeDiagram` stays stateless (contract); it resolves everything except pronouns.
Contextual pronouns are English-only; Arabic supports value/order/place references.

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
    // Always call it, even when q.diagram is null: solution requests ("Solve this circuit")
    // arrive as explore and must get the refusal on every question type.
    case 'explore': await speak(explorer.ask(cmd.query)); break; // explorer = createDiagramExplorer(q.diagram)
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

## Spoken prompts (`prompts.ts`)

`questionSpeech(question, index, total)` reads the number, the approved `accessible_text`,
MCQ options, a diagram hint and how to answer. `prompts.*` holds read-back/confirm, saved,
cancelled, not-understood (with the command list), boundaries, submit-confirm (with the
answered count), submitted and keyboard-mode wording. `recoveryPrompt(error)` turns any
`VoiceError` into a spoken next step; `needsKeyboardFallback(error)` says when to stop
retrying the microphone. English only (demo). Every prompt ends with what the student can do next.

## Integration requirements tested (end to end)

`__tests__/session.e2e.test.mjs` drives a scripted blind student through the fixture exam with
fake microphone/speech and `dev/reference-controller.ts` standing in for the UI
(dev/test only, not product code; the Chrome test page and `dev/try-session.mjs` run the same controller). The UI should meet the same rules:

1. Command mode → `parseCommand`; dictation mode → literal text, **never** parsed (dictating "submit" saves the answer "submit").
2. Read back with `prompts.readBack(literal)`; save only on `confirm`. "next", "yes", silence → reminder, nothing saved; `cancel` keeps the old answer; `answer` re-dictates.
3. `submit` → `prompts.submitConfirm(answered, total)`; only `confirm` submits. `cancel`, "yes", silence, "don't submit" keep the exam active.
4. `explore` → `explorer.ask(query)` on **every** question (a new explorer per question), so "Solve this circuit" is refused even with no diagram.
5. Every turn gives spoken **and** `aria-live` feedback; if TTS is unavailable the live region still gets every message.
6. On `VoiceError`, speak `recoveryPrompt(err)` (plus the current mode's reminder). On `needsKeyboardFallback(err)` or no recognition support, switch to keyboard and say so; the whole exam can be finished by keyboard.
7. Escape → `stopListening()` + `stopSpeaking()`, and backs out of dictation/confirmation with feedback.
8. The microphone is never open while TTS speaks (asserted after every test; a mutation that removes the wait is caught).

Not covered here (needs the real UI): focus order, no keyboard traps, visible focus, headings/labels,
and a screen-reader pass (NVDA/Narrator). None of this replaces testing with blind users.

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
