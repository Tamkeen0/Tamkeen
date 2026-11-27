// End-to-end accessibility tests of the voice experience: a scripted blind
// student completes the fixture exam using only speech in / speech out, or
// only the keyboard, and recovers from recognition errors without a mouse or
// a screen. A reference controller (dev/reference-controller.ts, dev/test only)
// stands in for the not-yet-built UI; the Chrome test page runs the same one.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setSpeechEnvironment } from '../speech.ts';
import { setLanguage } from '../language.ts';
import { prompts, questionSpeech } from '../prompts.ts';
import { en } from '../lang/en.ts';
import { createFakeSpeech, createFakeApi } from './support/fake-speech.mjs';
import { ReferenceController } from '../dev/reference-controller.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const [Q1, Q2, Q3] = exam.questions;

let fake;
let api;
let ui;

function setup({ speech = {}, ...controller } = {}) {
  fake = createFakeSpeech(speech);
  setSpeechEnvironment(fake.env);
  api = createFakeApi(exam);
  ui = new ReferenceController({ exam, api, listenTimeoutMs: 40, dictationEndSilenceMs: 25, ...controller });
}

/** Start the exam and clear the opening readout from the transcript. */
async function begin() {
  await ui.start();
  return fake.heardSince();
}

/** One talk-key press: the student says `items` (a command, plus dictation if it opens). Returns what they heard. */
async function press(...items) {
  for (const it of items) fake.student(it);
  const turns = fake.state.listens;
  await ui.turn();
  assert.equal(fake.state.script.length, 0, `unused script items after ${JSON.stringify(items)}`);
  assert.ok(fake.state.listens > turns);
  const heard = fake.heardSince();
  assert.ok(heard.trim().length > 0, `no spoken feedback after ${JSON.stringify(items)}`);
  return heard;
}

/** Keyboard fallback: returns the last message. */
async function typeIn(text) {
  const before = ui.live.length;
  await ui.type(text);
  assert.ok(ui.live.length > before, `no feedback after typing "${text}"`);
  return ui.live.at(-1);
}

beforeEach(() => setLanguage('en'));
afterEach(() => {
  assert.equal(fake.state.micOpenedWhileSpeaking, 0, 'microphone was opened while text-to-speech was playing');
  setSpeechEnvironment(null);
});

// ---------- the whole exam, efficiently ----------

test('voice only: the whole exam in few, natural steps', async () => {
  setup();
  await ui.start();
  assert.equal(fake.heardSince(), `${questionSpeech(Q1, 0, 3)} ${prompts.welcome}`);

  // MCQ: two presses ("option C", "save it")
  assert.equal(await press('option C'), 'You chose: C. 17. Say save to keep it, or choose another option.');
  assert.equal(await press('save it'), 'Answer saved for question 1.');

  // Natural navigation; question read automatically
  assert.equal(await press('Move to the next question.'), questionSpeech(Q2, 1, 3));

  // Dictation opens right after "answer" (one press), read back, "yes" saves
  assert.equal(await press('answer', '2 X + 3'), 'Dictate your answer now. You said: 2 X plus 3. Say save to keep it, or try again.');
  assert.equal(await press('yes'), 'Answer saved for question 2.');

  // Diagram question with follow-ups and a refused solution request
  assert.equal(await press('next one'), questionSpeech(Q3, 2, 3));
  assert.match(await press('explore R2'), /^R2 is a resistor with value 4 ohms/);
  assert.match(await press('what is connected to its first node'), /^Node B is connected to/);
  assert.match(await press('what other components are connected there'), /^Besides R2, node B is connected to R1/);
  assert.equal(await press('Solve this circuit'), en.responses.refusal);
  await press('answer', 'the current is 2 amps');
  await press('save');

  // Submit: strict
  assert.match(await press('submit'), /^You answered 3 of 3 questions\. Say confirm to submit/);
  assert.equal(await press('yes'), prompts.submitReminder, '"yes" never submits');
  assert.equal(await press('confirm'), prompts.submitted);
  assert.equal(api.session.status, 'submitted');
  assert.deepEqual(api.session.answers, { q1: 'C. 17', q2: '2 X + 3', q3: 'the current is 2 amps' });
});

// ---------- Priority 1: question reading ----------

test('reading: full on first visit, brief with answer status on return; no repeated instructions', async () => {
  setup();
  await begin();
  await press('option C');
  await press('save it');
  await press('next');
  const back = await press('previous');
  assert.equal(back, 'Question 1 of 3. Which number is prime? Options: A. 9; B. 15; C. 17; D. 21. You have a saved answer for this question.');
  assert.doesNotMatch(back, /Say option|Say answer/, 'instructions are not repeated on return');
  assert.equal(await press('read the question again'), back);
  assert.equal(await press('read the options'), 'Options: A. 9; B. 15; C. 17; D. 21.');

  await press('question 3');
  const diagramAnswer = await press('explore R1');
  assert.equal(await press('repeat that'), diagramAnswer, '"repeat that" repeats the last message, not the question');
  assert.equal(await press('what did you say'), diagramAnswer);
  await press('question 1');
  const q3again = await press('question 3');
  assert.match(q3again, /This question has a circuit diagram\.$/, 'diagram noted briefly, explore example not repeated');
  assert.equal(await press('read the options'), prompts.noOptions);
});

// ---------- Priority 2: natural commands ----------

test('natural phrasing for navigation, help, status and time; uncertain speech does nothing destructive', async () => {
  setup();
  await begin();
  const at = (n) => new RegExp(`^Question ${n} of 3\\.`);
  for (const [say, n] of [
    ['next one', 2], ['go to the previous one', 1], ['skip this question', 2], ['back one', 1], ['move on', 2],
    ['Go to question three.', 3], ['the first question', 1], ['the final question', 3], ['can you go to the previous one', 2],
  ]) {
    assert.match(await press(say), at(n), say);
  }
  assert.equal(await press('help'), prompts.help);
  assert.equal(await press('what can I say'), prompts.help);
  assert.equal(await press('how much time is left'), prompts.timeUnavailable, 'never invents remaining time');
  assert.equal(await press('what time is it'), prompts.timeUnavailable);
  assert.equal(await press('is my answer saved'), 'Question 2 has no answer yet.');
  assert.equal(await press('necks'), prompts.notUnderstood);
  assert.ok(prompts.notUnderstood.length < 70, 'misses get a short reply, not the full command list');
  for (const risky of ['delete', 'submit next', "don't submit", 'clear', 'yes']) {
    await press(risky);
    assert.equal(api.session.status, 'active', risky);
    assert.deepEqual(api.session.answers, {}, risky);
  }
});

test('remaining time comes only from authoritative data when provided', async () => {
  let remaining = 12 * 60_000 + 30_000;
  setup({ timeRemainingMs: () => remaining });
  await begin();
  assert.equal(await press('how much time is left'), '12 minutes remaining.');
  remaining = 75 * 60_000;
  assert.equal(await press('how long do I have'), '1 hour and 15 minutes remaining.');
  remaining = 20_000;
  assert.equal(await press('time remaining'), 'Less than one minute remaining.');
});

// ---------- Priority 3: reliable answer capture ----------

test('long dictation across pauses is captured whole and literally', async () => {
  setup();
  await begin();
  await press('question 2');
  const heard = await press('answer', { parts: ['The derivative is', 'two x plus three', 'because the constant drops out'], gapMs: 8 });
  assert.equal(heard, 'Dictate your answer now. You said: The derivative is two x plus three because the constant drops out. Say save to keep it, or try again.');
  await press('save');
  assert.equal(api.session.answers.q2, 'The derivative is two x plus three because the constant drops out');
});

test('a draft is never lost: Escape, recognition errors, navigation, "no" and re-dictation all keep it', async () => {
  setup();
  await begin();
  await press('question 2');

  // Escape while dictating keeps the words already heard
  setup({ dictationEndSilenceMs: 5000 }); // long pause allowed: only Escape ends this dictation
  await begin();
  await press('question 2');
  fake.student('answer', { parts: ['f prime of x is'], hang: true });
  const t = ui.turn();
  while (fake.state.wordsHeard === 0) await new Promise((r) => setTimeout(r, 2));
  await ui.escape();
  await t;
  assert.equal(fake.heardSince(), 'Dictate your answer now. Stopped listening. You said: f prime of x is. Say save to keep it, or try again.');
  assert.equal(ui.pending, 'f prime of x is');

  // A network error mid-dictation keeps the words too
  assert.match(await press('try again', { parts: ['2 x plus 3'], error: 'network' }), /could not be reached.*You said: 2 x plus 3\./);
  assert.equal(ui.pending, '2 x plus 3');
  assert.match(await press('undo'), /now: f prime of x is\./, 're-dictation replaced the draft, undo brings the old one back');
  assert.match(await press('redo', '2x + 3'), /You said: 2 x plus 3\./);
  assert.equal(ui.pending, '2x + 3');

  // Navigation keeps the draft and says so; returning announces it; save works later
  const leave = await press('next');
  assert.match(leave, /^Your unsaved draft for question 2 is kept\. Question 3 of 3\./);
  const back = await press('previous');
  assert.match(back, /You have an unsaved draft for this question\. Say save to keep it\.$/);
  assert.match(await press('read my answer'), /^Your unsaved draft for question 2 is: /);

  // "no" / "stop" are too uncertain to delete dictated content
  assert.equal(await press('no'), prompts.draftKept);
  assert.ok(ui.pending);

  // Explicit discard is undoable
  assert.equal(await press('discard'), prompts.draftDiscarded);
  assert.equal(ui.pending, null);
  assert.match(await press('undo'), /^Draft restored: /);
  assert.ok(ui.pending);
  assert.equal(api.session.answers.q2, undefined, 'nothing was saved along the way');
});

test('saved vs draft vs submitted are always distinguishable', async () => {
  setup();
  await begin();
  assert.equal(await press('is my answer saved'), 'Question 1 has no answer yet.');
  await press('option B');
  assert.match(await press('have I answered this question'), /^Question 1 has an unsaved draft\./);
  await press('save it');
  assert.equal(await press('is it saved'), 'Your answer for question 1 is saved.');
  await press('next');
  await press('answer', '7');
  const sub = await press('submit');
  assert.match(sub, /You answered 1 of 3 questions\. You have an unsaved draft for question 2; drafts are not submitted\./);
  await press('confirm');
  assert.deepEqual(api.session.answers, { q1: 'B. 15' }, 'the unsaved draft was not submitted');
  assert.equal(await press('is my answer saved'), 'Your exam has been submitted. Your answer for question 2 can no longer be changed.');
  assert.equal(await press('option A'), prompts.alreadySubmitted);
  assert.match(await press('read my answer to question 1'), /B\. 15/, 'review still works after submitting');
});

test('saving needs a clear intent; dictation is always literal', async () => {
  setup();
  await begin();
  assert.equal(await press('yes'), prompts.nothingToConfirm, '"yes" with nothing pending saves nothing');
  await press('answer', 'submit');
  assert.equal(ui.pending, 'submit', 'dictated "submit" is just the answer');
  assert.equal(api.session.status, 'active');
  await press('save');
  assert.equal(api.session.answers.q1, 'submit');
  await press('answer', 'delete the last word');
  await press('confirm');
  assert.equal(api.session.answers.q1, 'delete the last word', 'dictated edit phrases are not executed');
});

test('multiple choice: letters, spoken letters, numbers and option text', async () => {
  setup();
  await begin();
  for (const [say, option] of [['option see', 'C. 17'], ['I choose B', 'B. 15'], ['select option 4', 'D. 21'], ['the answer is 17', 'C. 17'], ['option a', 'A. 9']]) {
    assert.equal(await press(say), prompts.optionChosen(option), say);
  }
  assert.equal(await press('option F'), 'There is no option F. Options: A. 9; B. 15; C. 17; D. 21.');
  await press('question 2');
  assert.equal(await press('option C'), prompts.noOptions);
});

// ---------- Priority 4: correction ----------

test('fast correction: fix a misrecognition without re-dictating, undo, then save', async () => {
  setup();
  await begin();
  await press('question 3');
  assert.match(await press('answer', 'the current through resistor or 1 is 3 amps'), /resistor or 1/);
  assert.equal(await press('replace or 1 with R1'), 'Changed. Your answer is now: the current through resistor R1 is 3 amps. Say save to keep it, or keep editing.');
  assert.match(await press('replace three with four'), /four amps/);
  assert.match(await press('undo'), /3 amps/);
  assert.match(await press('clear my answer'), /^Your draft is now empty\. Say undo to bring it back/);
  assert.equal(await press('save'), prompts.edited(''), 'an emptied draft is not saved');
  assert.match(await press('undo'), /3 amps/);
  await press('save');
  assert.equal(api.session.answers.q3, 'the current through resistor R1 is 3 amps');
  // Editing a saved answer makes a draft that still needs saving
  await press('add through R2');
  assert.equal(api.session.answers.q3, 'the current through resistor R1 is 3 amps');
  assert.equal(await press('cancel'), prompts.draftDiscarded);
});

// ---------- recovery and keyboard ----------

test('recognition errors: silence, timeout, network; the student continues by voice', async () => {
  setup();
  await begin();
  assert.equal(await press({ silence: true }), "I didn't hear anything. Please try again.");
  assert.equal(await press({ hang: true }), "I didn't hear anything. Please try again.", 'timeout');
  assert.match(await press({ error: 'network' }), /could not be reached/);
  assert.equal(await press('answer', { hang: true }), "Dictate your answer now. I didn't hear anything. Please try again. Say answer to dictate again.");
  assert.match(await press('next'), /^Question 2 of 3\./);
  assert.equal(ui.keyboardOnly, false);
});

test('microphone blocked mid-exam: spoken switch to keyboard, then the whole exam by keyboard', async () => {
  setup();
  await begin();
  assert.match(await press({ error: 'not-allowed' }), /^The microphone is blocked\. You can continue with the keyboard/);
  assert.equal(ui.keyboardOnly, true);
  await assert.rejects(ui.turn(), /microphone unavailable/);
  assert.match(await typeIn('option C'), /^You chose: C\. 17/);
  assert.equal(await typeIn('save'), 'Answer saved for question 1.');
  assert.match(await typeIn('go to question 2'), /^Question 2 of 3/);
  assert.equal(await typeIn('answer'), prompts.dictationStart);
  assert.match(await typeIn('f prime of x = 2x + 3'), /^You said: f prime of x equals 2 x plus 3/);
  assert.equal(await typeIn('save'), 'Answer saved for question 2.');
  assert.match(await typeIn('submit'), /^You answered 2 of 3/);
  assert.equal(await typeIn('confirm'), prompts.submitted);
  assert.deepEqual(api.session.answers, { q1: 'C. 17', q2: 'f prime of x = 2x + 3' });
});

test('browser without speech recognition starts in keyboard mode and says so', async () => {
  setup({ speech: { recognition: false } });
  await begin();
  assert.equal(ui.keyboardOnly, true);
  assert.equal(ui.live.at(-1), prompts.keyboardMode);
  assert.match(await typeIn('next'), /^Question 2 of 3/);
});

// ---------- Priority 5: screen readers ----------

test('screen-reader mode: no app speech, every message announced exactly once', async () => {
  setup({ output: 'screenReader' });
  await begin();
  fake.student('next', 'explore node B');
  await ui.turn();
  await ui.turn();
  assert.equal(fake.state.spoken.length, 0, 'no app TTS competing with the screen reader');
  assert.deepEqual(ui.announced, ui.live, 'each message announced once');
  assert.match(ui.announced.at(-1), /^There is no diagram/);
});

test('voice mode does not also announce (no duplicates with a screen reader); falls back if TTS fails', async () => {
  setup({ output: 'voice' });
  await begin();
  await press('next');
  assert.deepEqual(ui.announced, [], 'nothing duplicated in the live region');
  setup({ output: 'voice', speech: { synthesis: false } });
  await begin();
  assert.deepEqual(ui.announced, ui.live, 'without app TTS, the live region gets everything');
  setup({ output: 'both' });
  await begin();
  assert.equal(ui.announced.length, 1);
  assert.ok(fake.state.spoken.length > 0);
});

// ---------- fairness ----------

test('fairness: questions read verbatim from approved text; no hints on any question', async () => {
  setup();
  await begin();
  for (const n of [1, 2, 3]) {
    const reading = await press(`question ${n}`);
    assert.ok(reading.includes(exam.questions[n - 1].accessible_text), `question ${n} text read verbatim`);
    assert.equal(await press('give me a hint'), en.responses.refusal);
    assert.equal(await press('what is the answer'), en.responses.refusal);
  }
});
