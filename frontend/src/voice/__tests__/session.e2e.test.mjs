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
import { prompts, COMMAND_SUMMARY } from '../prompts.ts';
import { en } from '../lang/en.ts';
import { createFakeSpeech, createFakeApi } from './support/fake-speech.mjs';
import { ReferenceController } from '../dev/reference-controller.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));

let fake;
let api;
let ui;

function setup(options) {
  fake = createFakeSpeech(options);
  setSpeechEnvironment(fake.env);
  api = createFakeApi(exam);
  ui = new ReferenceController({ exam, api, listenTimeoutMs: 40 });
}

/** Student speaks one utterance (or script item); returns everything the student heard in reply. */
async function sayAndHear(item) {
  fake.student(item);
  await ui.turn();
  const heard = fake.heardSince();
  assert.ok(heard.trim().length > 0, `no spoken feedback after ${JSON.stringify(item)}`);
  return heard;
}

/** Student types (keyboard fallback); returns the live-region announcement. */
async function typeAndRead(text) {
  const before = ui.live.length;
  await ui.type(text);
  assert.ok(ui.live.length > before, `no announcement after typing "${text}"`);
  return ui.live.at(-1);
}

function assertMicNeverOpenDuringSpeech() {
  assert.equal(fake.state.micOpenedWhileSpeaking, 0, 'microphone was opened while text-to-speech was playing');
}

beforeEach(() => setLanguage('en'));
afterEach(() => {
  assertMicNeverOpenDuringSpeech();
  setSpeechEnvironment(null);
});

test('voice only: navigate, explore, answer, confirm and submit the whole exam', async () => {
  setup();
  await ui.start();
  let heard = fake.heardSince();
  assert.match(heard, /^Question 1 of 3\. Which number is prime\?/);
  assert.match(heard, /Options: A\. 9; B\. 15; C\. 17; D\. 21\./);

  // Q1 (MCQ): dictate, hear it back, confirm
  assert.equal(await sayAndHear('answer'), prompts.dictationStart);
  assert.match(await sayAndHear('C. 17'), /^You said: C\. 17\. Say confirm to save/);
  assert.equal(await sayAndHear('confirm'), 'Answer saved for question 1.');

  // Q2 (math): read-back verbalises symbols, stored text stays literal
  assert.match(await sayAndHear('next'), /^Question 2 of 3\. Find the derivative of f of x/);
  await sayAndHear('answer');
  assert.match(await sayAndHear('2 X + 3'), /^You said: 2 X plus 3\./);
  await sayAndHear('confirm');

  // Q3 (diagram): explore with follow-up references, refusal, then answer
  heard = await sayAndHear('next');
  assert.match(heard, /^Question 3 of 3\./);
  assert.match(heard, /This question has a circuit diagram\. Say explore/);
  assert.match(await sayAndHear('explore R2'), /^R2 is a resistor with value 4 ohms/);
  assert.match(await sayAndHear('what is connected to its first node'), /^Node B is connected to/);
  assert.match(await sayAndHear('what other components are connected there'), /^Besides R2, node B is connected to R1/);
  assert.equal(await sayAndHear('Solve this circuit'), en.responses.refusal);
  await sayAndHear('answer');
  await sayAndHear('the current is 2 amps');
  await sayAndHear('confirm');

  // Submit with explicit confirmation
  assert.match(await sayAndHear('submit'), /^You answered 3 of 3 questions\. Say confirm to submit/);
  assert.equal(await sayAndHear('confirm'), prompts.submitted);
  assert.equal(api.session.status, 'submitted');
  assert.equal(await sayAndHear('next'), prompts.alreadySubmitted);

  // Answers are the literal transcripts
  assert.deepEqual(api.session.answers, { q1: 'C. 17', q2: '2 X + 3', q3: 'the current is 2 amps' });
});

test('navigation: boundaries, repeat, previous; diagram references reset per question', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  assert.equal(await sayAndHear('previous'), prompts.firstQuestion);
  assert.match(await sayAndHear('repeat'), /^Question 1 of 3\./);
  await sayAndHear('next');
  await sayAndHear('next');
  await sayAndHear('explore R1');
  assert.equal(await sayAndHear('next'), prompts.lastQuestion);
  assert.match(await sayAndHear('go back'), /^Question 2 of 3\./);
  assert.match(await sayAndHear('explore its value'), /There is no diagram for this question/);
  assert.match(await sayAndHear('next'), /^Question 3 of 3\./);
  assert.match(await sayAndHear('explore its value'), /^Which component do you mean/, 'focus must not survive leaving the question');
});

test('voice-guided navigation: jump, progress, re-read, read my answer — never losing an unconfirmed answer', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  await sayAndHear('answer');
  await sayAndHear('x^2 + 3x');
  await sayAndHear('confirm');

  assert.match(await sayAndHear('Go to the next question.'), /^Question 2 of 3\./);
  assert.match(await sayAndHear('Read the current question again.'), /^Question 2 of 3\./);
  assert.equal(
    await sayAndHear('How many questions are remaining?'),
    'You are on question 2 of 3. 1 more question after this one. You have answered 1 of 3. Unanswered: questions 2 and 3.',
  );
  assert.equal(await sayAndHear('Read my previous answer.'), 'You have not saved an answer for question 2 yet. Say answer to dictate one.');
  assert.match(await sayAndHear('Go back to question two.'), /^Question 2 of 3\./, 'already there: re-reads');
  assert.match(await sayAndHear('go to question three'), /^Question 3 of 3\./);
  assert.match(await sayAndHear('Go back to question one.'), /^Question 1 of 3\./);
  assert.equal(await sayAndHear('Read my previous answer.'), 'Your saved answer for question 1 is: x squared plus 3 x.');
  assert.equal(await sayAndHear('read my answer to question 3'), 'You have not saved an answer for question 3 yet. Say answer to dictate one.');
  assert.match(await sayAndHear('go to question 7'), /^There is no question 7\. The exam has 3 questions/);
  assert.match(await sayAndHear('the final question'), /^Question 3 of 3\./);

  // Navigation is held while an answer waits for confirmation
  await sayAndHear('answer');
  await sayAndHear('2 amps');
  assert.match(await sayAndHear('go to question 1'), /^Finish this step first\. Say confirm to save this answer/);
  assert.match(await sayAndHear('how many questions are left'), /^Finish this step first\./);
  await sayAndHear('confirm');
  assert.match(await sayAndHear('where am I'), /You have answered 2 of 3\. Unanswered: question 2\./);

  // A solution request phrased around "answer" is still refused
  assert.equal(await sayAndHear('what is the answer'), en.responses.refusal);
  assert.equal(api.session.answers.q1, 'x^2 + 3x', 'stored literally');
});

test('recognition errors: silence, timeout, mishearing and network all get a spoken way forward', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  assert.equal(await sayAndHear({ silence: true }), "I didn't hear anything. Please try again.");
  assert.equal(await sayAndHear({ error: 'no-speech' }), "I didn't hear anything. Please try again.");
  assert.equal(await sayAndHear({ hang: true }), "I didn't hear anything. Please try again.", 'timeout');
  const misheard = await sayAndHear('necks');
  assert.ok(misheard.startsWith('Sorry, I did not understand.') && misheard.includes(COMMAND_SUMMARY), misheard);
  assert.match(await sayAndHear({ error: 'network' }), /could not be reached\. Please try again, or continue with the keyboard/);
  // the student can carry on by voice afterwards
  assert.match(await sayAndHear('next'), /^Question 2 of 3\./);
  assert.equal(ui.keyboardOnly, false);
});

test('correcting a misrecognised answer before saving', async () => {
  setup();
  await ui.start();
  await sayAndHear('next');
  await sayAndHear('next');
  await sayAndHear('answer');
  const first = await sayAndHear('the current through resistor or 1 is 3 amps');
  assert.match(first, /resistor or 1/, 'the mishearing must be audible in the read-back');
  assert.equal(await sayAndHear('answer'), prompts.dictationStart, 'student re-dictates instead of confirming');
  await sayAndHear('the current through R1 is 3 amps');
  await sayAndHear('confirm');
  assert.equal(api.session.answers.q3, 'the current through R1 is 3 amps');
});

test('no answer is saved without an explicit confirm', async () => {
  setup();
  await ui.start();
  await sayAndHear('answer');
  await sayAndHear('17');
  await sayAndHear('confirm');
  assert.equal(api.session.answers.q1, '17');

  await sayAndHear('answer');
  await sayAndHear('15');
  assert.equal(await sayAndHear('next'), prompts.confirmAnswerReminder, 'navigation is not a confirmation');
  assert.match(await sayAndHear({ silence: true }), /Say confirm to save this answer/);
  assert.equal(await sayAndHear('yes'), prompts.confirmAnswerReminder, '"yes" is deliberately not confirm');
  assert.equal(await sayAndHear('cancel'), prompts.answerCancelled);
  assert.equal(api.session.answers.q1, '17', 'cancelled dictation leaves the saved answer unchanged');

  // dictation text that sounds like a command is still just the answer
  await sayAndHear('answer');
  assert.match(await sayAndHear('submit'), /^You said: submit\./);
  await sayAndHear('confirm');
  assert.equal(api.session.answers.q1, 'submit');
  assert.equal(api.session.status, 'active');
});

test('submitting requires explicit confirmation; cancel, silence and negation keep the exam open', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  assert.match(await sayAndHear("don't submit"), /^Sorry, I did not understand/);
  assert.match(await sayAndHear('submit'), /^You answered 0 of 3 questions/);
  assert.equal(await sayAndHear('cancel'), prompts.submitCancelled);
  await sayAndHear('submit');
  assert.match(await sayAndHear({ error: 'no-speech' }), /Say confirm to submit the exam, or cancel/);
  assert.equal(await sayAndHear('yes'), prompts.submitReminder);
  assert.equal(await sayAndHear('submit'), prompts.submitReminder);
  assert.equal(api.session.status, 'active');
  assert.equal(await sayAndHear('confirm'), prompts.submitted);
  assert.equal(api.session.status, 'submitted');
});

test('microphone blocked mid-exam: spoken switch to keyboard, then finish by keyboard only', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  assert.match(await sayAndHear({ error: 'not-allowed' }), /^The microphone is blocked\. You can continue with the keyboard/);
  assert.equal(ui.keyboardOnly, true);
  await assert.rejects(ui.turn(), /microphone unavailable/, 'the controller stops using the microphone');

  assert.match(await typeAndRead('answer'), /Dictate your answer now/);
  assert.match(await typeAndRead('typed answer: 17'), /^You said: typed answer: 17/);
  assert.match(await typeAndRead('confirm'), /^Answer saved for question 1/);
  assert.match(await typeAndRead('next'), /^Question 2 of 3/);
  assert.match(await typeAndRead('submit'), /^You answered 1 of 3/);
  assert.equal(await typeAndRead('confirm'), prompts.submitted);
  assert.deepEqual(api.session.answers, { q1: 'typed answer: 17' });
});

test('browser without speech recognition starts in keyboard mode and says so', async () => {
  setup({ recognition: false });
  await ui.start();
  assert.equal(ui.keyboardOnly, true);
  assert.equal(ui.live.at(-1), prompts.keyboardMode);
  assert.match(await typeAndRead('explore R1'), /There is no diagram/);
  assert.match(await typeAndRead('next'), /^Question 2 of 3/);
});

test('no text-to-speech: every message still reaches the screen-reader live region', async () => {
  setup({ synthesis: false });
  await ui.start();
  assert.match(ui.live[0], /^Question 1 of 3/);
  fake.student('next', 'next', 'explore node B', 'solve it');
  for (let i = 0; i < 4; i++) await ui.turn();
  assert.match(ui.live.at(-3), /^Question 3 of 3/);
  assert.match(ui.live.at(-2), /^Node B is connected to/);
  assert.equal(ui.live.at(-1), en.responses.refusal);
  assert.equal(fake.state.spoken.length, 0);
});

test('Escape while listening or dictating cancels cleanly with feedback', async () => {
  setup();
  await ui.start();
  fake.heardSince();
  fake.student({ hang: true });
  const listening = ui.turn();
  await new Promise((r) => setTimeout(r, 5));
  await ui.escape();
  await listening;
  assert.ok(ui.live.includes('Stopped listening.'));

  await sayAndHear('answer');
  await sayAndHear('15');
  await ui.escape();
  assert.equal(ui.live.at(-1), prompts.answerCancelled);
  assert.equal(ui.mode, 'command');
  assert.equal(api.session.answers.q1, undefined);
});
