import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../parser.ts';
import { en } from '../lang/en.ts';

const type = (text) => parseCommand(text).type;

test('every listed English phrase maps to its own command', () => {
  for (const [cmd, phrases] of Object.entries(en.commands)) {
    for (const p of phrases) assert.equal(type(p), cmd, `"${p}"`);
  }
});

test('case, punctuation and filler words are ignored', () => {
  assert.equal(type('Next.'), 'next');
  assert.equal(type('NEXT!'), 'next');
  assert.equal(type('  next question please '), 'next');
  assert.equal(type("Let's go to the next question"), 'next');
  assert.equal(type('Go back'), 'previous');
  assert.equal(type('OK, repeat that.'), 'repeat');
  assert.equal(type('Submit the exam'), 'submit');
  assert.equal(type('Never mind'), 'cancel');
});

test('empty and noise input is unknown', () => {
  for (const t of ['', '   ', '...', 'um', 'please', undefined, null]) assert.equal(type(t), 'unknown', String(t));
});

test('ambiguous or combined commands are unknown', () => {
  for (const t of ['next submit', 'submit next', 'next next', 'confirm and submit', 'back next', 'repeat submit']) {
    assert.equal(type(t), 'unknown', t);
  }
});

test('near-misses never submit or confirm', () => {
  for (const t of ['submitted', 'submission', 'summit', 'I think I want to submit', 'maybe submit later', 'submit it now or not', 'confirmed', 'conform', 'yes']) {
    const r = type(t);
    assert.notEqual(r, 'submit', t);
    assert.notEqual(r, 'confirm', t);
  }
});

test('negated commands are unknown', () => {
  for (const t of ["don't submit", 'do not submit', 'not next', 'no submit', 'never submit', "don't save", "can't confirm", 'do not go back']) {
    assert.equal(type(t), 'unknown', t);
  }
});

test('explore requests carry the query', () => {
  assert.deepEqual(parseCommand('explore'), { type: 'explore', query: '' });
  assert.deepEqual(parseCommand('Explore R2'), { type: 'explore', query: 'r2' });
  assert.deepEqual(parseCommand('What is R1?'), { type: 'explore', query: 'what is r1' });
  assert.equal(type('node B'), 'explore');
  assert.equal(type('R 2'), 'explore');
  assert.equal(type('what is connected to node B'), 'explore');
  assert.equal(type('describe the circuit'), 'explore');
  assert.equal(type('list components'), 'explore');
  assert.equal(type('between node A and node B'), 'explore');
});

test('cheating questions are routed to explore (which refuses), never to a state change', () => {
  for (const t of ["what's the answer", 'what is the current through R2', 'tell me the answer', 'how do I solve this']) {
    assert.equal(type(t), 'explore', t);
  }
  assert.equal(type('solve it'), 'unknown');
  assert.equal(type('give me a hint'), 'unknown');
});

test('dictation-like sentences are not commands', () => {
  for (const t of ['the answer is 2x plus 3', 'two x plus three', 'C. 17', 'option C', 'f prime of x equals 2x plus 3']) {
    const r = type(t);
    assert.ok(r === 'unknown' || r === 'explore', `${t} -> ${r}`);
  }
});

test('very long input is unknown', () => {
  assert.equal(type(`what is ${'very '.repeat(40)}long`), 'unknown');
});

test('returns a fresh object each call', () => {
  const a = parseCommand('next');
  a.type = 'submit';
  assert.equal(type('next'), 'next');
});
