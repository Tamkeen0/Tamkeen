// Developer-only: try the spoken exam flow in a terminal, no microphone needed.
// Each line you type is what the student "says"; the output is what they hear.
// Uses the same reference controller as the end-to-end tests (test-only, not product UI).
//
// Run from the repo root:
//   node --experimental-strip-types --no-warnings --import ./frontend/src/voice/__tests__/register.mjs frontend/src/voice/dev/try-session.mjs
//
// Special inputs:  !silence  !timeout  !blocked  !network  esc  quit
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { setSpeechEnvironment } from '../speech.ts';
import { createFakeSpeech, createFakeApi } from '../__tests__/support/fake-speech.mjs';
import { ReferenceController } from './reference-controller.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));

const SPECIAL = {
  '!silence': { silence: true },
  '!timeout': { hang: true },
  '!blocked': { error: 'not-allowed' },
  '!network': { error: 'network' },
};

const fake = createFakeSpeech();
setSpeechEnvironment(fake.env);
const api = createFakeApi(exam);
// One typed line per turn, so "answer" waits for the next line instead of auto-listening.
const ui = new ReferenceController({ exam, api, listenTimeoutMs: 200, autoListenAfterAnswer: false });

const out = (s) => process.stdout.write(s);
const hear = () => {
  const heard = fake.heardSince();
  const live = ui.live.at(-1);
  // Prefer what was spoken; fall back to the live-region text (e.g. in keyboard mode with no change in speech).
  out(`\n  🔊 ${heard || live || '(nothing)'}\n`);
};
const prompt = () => out(`\n${ui.keyboardOnly ? '⌨  type' : '🎤 say'} [${ui.mode}, q${ui.index + 1}]> `);

out('Tamkeen voice flow simulator (synthetic demo exam). Type what the student says.\n');
out('Try: answer · confirm · next · go back to question two · how many questions are remaining\n');
out('     read my previous answer · explore R2 · what is its value · solve this circuit · submit\n');
out('Special: !silence !timeout !blocked !network · esc · quit\n');
await ui.start();
hear();
prompt();

const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
for await (const raw of rl) {
  const line = raw.trim();
  if (line === 'quit' || line === 'exit') break;
  if (!line) {
    prompt();
    continue;
  }
  if (line === 'esc') {
    await ui.escape();
  } else if (ui.keyboardOnly) {
    await ui.type(line);
  } else {
    fake.student(SPECIAL[line] ?? line);
    await ui.turn();
  }
  hear();
  prompt();
}

out(`\n\nSaved answers (stored literally): ${JSON.stringify(api.session.answers)}\nStatus: ${api.session.status}\n`);
out(`Microphone opened while speaking: ${fake.state.micOpenedWhileSpeaking} time(s)\n`);
rl.close();
setSpeechEnvironment(null);
