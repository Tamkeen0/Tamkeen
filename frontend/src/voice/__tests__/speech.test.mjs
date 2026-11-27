import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  speak,
  stopSpeaking,
  listenOnce,
  stopListening,
  setSpeechEnvironment,
  isSpeaking,
  isListening,
  splitForSpeech,
} from '../speech.ts';
import { VoiceError } from '../errors.ts';
import { setLanguage } from '../language.ts';

class FakeSynthesis {
  constructor(voices = []) {
    this.voices = voices;
    this.queue = [];
    this.spoken = [];
    this.cancelCount = 0;
  }
  speak(u) {
    this.queue.push(u);
    this.spoken.push(u);
  }
  cancel() {
    this.cancelCount++;
    const q = this.queue;
    this.queue = [];
    for (const u of q) u.onerror?.({ error: 'interrupted' });
  }
  getVoices() {
    return this.voices;
  }
  finishAll() {
    const q = this.queue;
    this.queue = [];
    for (const u of q) u.onend?.();
  }
}

class FakeRecognition {
  static instances = [];
  constructor() {
    this.started = false;
    this.aborted = false;
    this.onresult = this.onerror = this.onend = null;
    FakeRecognition.instances.push(this);
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error('InvalidStateError');
    this.started = true;
  }
  abort() {
    this.aborted = true;
  }
  say(text) {
    const result = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ results: [result] });
    this.onend?.();
  }
  fail(error) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

let synth;
const last = () => FakeRecognition.instances.at(-1);
const tick = () => new Promise((r) => setTimeout(r, 0));

function install({ synthesis = true, recognition = true, voices = [] } = {}) {
  synth = synthesis ? new FakeSynthesis(voices) : null;
  setSpeechEnvironment({
    synthesis: synth,
    createUtterance: synthesis ? (text) => ({ text, lang: '', voice: null, onend: null, onerror: null }) : null,
    createRecognition: recognition ? () => new FakeRecognition() : null,
  });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof VoiceError, `expected VoiceError, got ${err}`);
    assert.equal(err.code, code);
    assert.ok(err.message.length > 0);
    return true;
  });
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.throwOnStart = false;
  setLanguage('en');
  install();
});
afterEach(() => setSpeechEnvironment(null));

test('unsupported browser rejects clearly for both TTS and recognition', async () => {
  install({ synthesis: false, recognition: false });
  await rejectsWith(speak('hello'), 'unsupported');
  await rejectsWith(listenOnce(), 'unsupported');
});

test('speak resolves after the last chunk ends and uses the active language', async () => {
  const p = speak('First sentence. Second sentence.');
  assert.equal(isSpeaking(), true);
  assert.ok(synth.spoken.length >= 1);
  assert.equal(synth.spoken[0].lang, 'en-US');
  synth.finishAll();
  await p;
  assert.equal(isSpeaking(), false);
});

test('empty text resolves without speaking', async () => {
  await speak('   ');
  assert.equal(synth.spoken.length, 0);
});

test('long text is split into chunks of at most 180 characters', () => {
  const text = `${'word '.repeat(120)}end. Short one.`;
  const chunks = splitForSpeech(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 180, c.length);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' ').trim());
});

test('stopSpeaking resolves the pending speak and cancels synthesis', async () => {
  const p = speak('Some long text.');
  stopSpeaking();
  await p;
  assert.ok(synth.cancelCount >= 1);
  assert.equal(isSpeaking(), false);
});

test('a new speak interrupts the previous one, which resolves', async () => {
  const p1 = speak('one.');
  const p2 = speak('two.');
  await p1;
  synth.finishAll();
  await p2;
});

test('speech errors reject with mapped codes', async () => {
  const p = speak('hello');
  synth.queue[0].onerror({ error: 'not-allowed' });
  await rejectsWith(p, 'permission-denied');
  const p2 = speak('hello');
  synth.queue[0].onerror({ error: 'synthesis-failed' });
  await rejectsWith(p2, 'unknown');
});

test('missing voice for the language is reported', async () => {
  install({ voices: [{ lang: 'fr-FR', name: 'French' }] });
  await rejectsWith(speak('hello'), 'language-unavailable');
  install({ voices: [{ lang: 'fr-FR', name: 'French' }, { lang: 'en_GB', name: 'English' }] });
  const p = speak('hello');
  assert.equal(synth.spoken[0].voice.name, 'English');
  synth.finishAll();
  await p;
});

test('listenOnce returns the literal transcript and configures recognition', async () => {
  const p = listenOnce();
  const rec = last();
  assert.equal(rec.started, true);
  assert.equal(rec.lang, 'en-US');
  assert.equal(rec.continuous, false);
  assert.equal(rec.interimResults, false);
  assert.equal(rec.maxAlternatives, 1);
  rec.say('  Two x plus Three  ');
  assert.equal(await p, 'Two x plus Three');
  assert.equal(isListening(), false);
});

test('recognition errors map to VoiceError codes', async () => {
  for (const [error, code] of [
    ['not-allowed', 'permission-denied'],
    ['service-not-allowed', 'permission-denied'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'audio-capture'],
    ['network', 'network'],
    ['aborted', 'cancelled'],
    ['language-not-supported', 'language-unavailable'],
    ['something-new', 'unknown'],
  ]) {
    const p = listenOnce();
    last().fail(error);
    await rejectsWith(p, code);
  }
});

test('ending without a result or with an empty transcript rejects no-speech', async () => {
  const p = listenOnce();
  last().onend();
  await rejectsWith(p, 'no-speech');
  const p2 = listenOnce();
  last().say('   ');
  await rejectsWith(p2, 'no-speech');
});

test('timeout rejects and aborts the recogniser', async () => {
  const p = listenOnce({ timeoutMs: 20 });
  const rec = last();
  await rejectsWith(p, 'timeout');
  assert.equal(rec.aborted, true);
  assert.equal(isListening(), false);
});

test('stopListening cancels cleanly and a new listen works afterwards', async () => {
  const p = listenOnce();
  const rec = last();
  stopListening();
  await rejectsWith(p, 'cancelled');
  assert.equal(rec.aborted, true);
  rec.say('late result is ignored');
  const p2 = listenOnce();
  last().say('next');
  assert.equal(await p2, 'next');
});

test('a second concurrent listen is rejected as busy', async () => {
  const p = listenOnce();
  await rejectsWith(listenOnce(), 'busy');
  last().say('ok');
  await p;
});

test('start() throwing rejects instead of failing silently', async () => {
  FakeRecognition.throwOnStart = true;
  await rejectsWith(listenOnce(), 'unknown');
  assert.equal(isListening(), false);
});

test('microphone stays closed while TTS speaks', async () => {
  const s = speak('Question one.');
  const p = listenOnce();
  await tick();
  assert.equal(FakeRecognition.instances.length, 0, 'recognition must not start during speech');
  synth.finishAll();
  await s;
  await tick();
  assert.equal(last().started, true);
  last().say('repeat');
  assert.equal(await p, 'repeat');
});

test('speaking while listening cancels the listen and aborts the mic', async () => {
  const p = listenOnce();
  const rec = last();
  const s = speak('Interrupting.');
  await rejectsWith(p, 'cancelled');
  assert.equal(rec.aborted, true);
  synth.finishAll();
  await s;
});

test('stopListening while waiting for TTS cancels without ever opening the mic', async () => {
  const s = speak('Wait.');
  const p = listenOnce();
  stopListening();
  await rejectsWith(p, 'cancelled');
  synth.finishAll();
  await s;
  await tick();
  assert.equal(FakeRecognition.instances.length, 0);
});

// ---------- long speech and dictation (answer capture) ----------

const results = (...items) => ({
  results: items.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the timeout only counts silence before speech starts: a long answer is not cut off', async () => {
  const p = listenOnce({ timeoutMs: 20 });
  const rec = last();
  rec.onspeechstart();
  await wait(60); // student keeps talking well past the timeout
  rec.say('a long answer that takes a while to say');
  assert.equal(await p, 'a long answer that takes a while to say');
});

test('dictation keeps listening across pauses and returns everything once the student stops', async () => {
  const p = listenOnce({ mode: 'dictation', timeoutMs: 50, endSilenceMs: 30 });
  const rec = last();
  assert.equal(rec.continuous, true);
  assert.equal(rec.interimResults, true);
  rec.onresult(results(['The derivative is', true]));
  await wait(15); // short pause: shorter than endSilenceMs
  rec.onresult(results(['The derivative is', true], ['two x', false]));
  await wait(15);
  rec.onresult(results(['The derivative is', true], ['two x plus three', true]));
  assert.equal(await p, 'The derivative is two x plus three');
});

test('dictation: stopping or an error keeps the words heard in partialTranscript', async () => {
  let p = listenOnce({ mode: 'dictation', endSilenceMs: 1000 });
  last().onresult(results(['first part of my answer', true]));
  stopListening();
  await assert.rejects(p, (err) => err.code === 'cancelled' && err.partialTranscript === 'first part of my answer');

  p = listenOnce({ mode: 'dictation', endSilenceMs: 1000 });
  last().onresult(results(['heard so far', true], ['and this', false]));
  last().onerror({ error: 'network' });
  await assert.rejects(p, (err) => err.code === 'network' && err.partialTranscript === 'heard so far and this');
});

test('dictation: the browser ending recognition or a late no-speech returns what was heard', async () => {
  let p = listenOnce({ mode: 'dictation', endSilenceMs: 1000 });
  last().onresult(results(['seventeen', true]));
  last().onend();
  assert.equal(await p, 'seventeen');

  p = listenOnce({ mode: 'dictation', endSilenceMs: 1000 });
  last().onresult(results(['nine', true]));
  last().onerror({ error: 'no-speech' });
  assert.equal(await p, 'nine');

  p = listenOnce({ mode: 'dictation', endSilenceMs: 1000 });
  last().onend();
  await rejectsWith(p, 'no-speech');
});

test('dictation: the safety cap resolves with what was heard instead of discarding it', async () => {
  const p = listenOnce({ mode: 'dictation', endSilenceMs: 1000, maxDurationMs: 30 });
  const rec = last();
  rec.onspeechstart();
  rec.onresult(results(['a very long answer', true], ['still going', false]));
  assert.equal(await p, 'a very long answer still going');
});

test('command mode is unchanged: one utterance, no interim results', async () => {
  const p = listenOnce();
  assert.equal(last().continuous, false);
  assert.equal(last().interimResults, false);
  last().say('next');
  assert.equal(await p, 'next');
});
