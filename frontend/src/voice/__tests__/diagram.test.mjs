import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeDiagram } from '../diagram.ts';
import { en } from '../lang/en.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const diagram = exam.questions.find((q) => q.type === 'diagram').diagram;
const ask = (q) => describeDiagram(diagram, q, 'en');

// Facts that would only appear if the engine calculated something.
// Fixture: 12 V, R1 2 ohms, R2 4 ohms -> I = 2 A, V(R1) = 4 V, V(R2) = 8 V, Req = 6 ohms.
const SOLUTION_LEAKS = [/\b2\s?a\b/i, /\b2\s?amp/i, /\b8\s?v\b/i, /\b4\s?v\b/i, /\b6\s?ohm/i, /\bseries\b/i, /\bparallel\b/i, /\b\d+(\.\d+)?\s?(amps?|amperes?|watts?|W)\b/];

function assertNoLeak(text, q) {
  for (const re of SOLUTION_LEAKS) assert.doesNotMatch(text, re, `"${q}" leaked ${re}: ${text}`);
}

test('component lookup returns kind, verbatim value and terminals', () => {
  const r2 = ask('R2');
  for (const s of ['R2', 'resistor', '4 ohms', 'node B', 'node C']) assert.ok(r2.includes(s), r2);
  const v1 = ask('what is V1');
  assert.ok(v1.includes('12 V, positive at A, negative at C'), v1);
  assert.ok(ask('value of R1').includes('2 ohms'));
});

test('spoken variants of component ids resolve only to existing ids', () => {
  for (const q of ['are 2', 'R two', 'resistor 2', 'resistor two', 'r-2', 'R 2', 'explore r2']) {
    const out = ask(q);
    assert.ok(out.startsWith('R2 is a resistor'), `${q} -> ${out}`);
  }
  assert.ok(ask('R9').startsWith('There is no R9'), ask('R9'));
});

test('node lookup lists components touching that node', () => {
  const b = ask('node B');
  assert.ok(b.includes('R1') && b.includes('R2') && !b.includes('V1'), b);
  const a = ask('what is connected to node A?');
  assert.ok(a.includes('V1') && a.includes('R1') && !a.includes('R2'), a);
  assert.ok(ask('node bee').includes('Node B'));
  assert.ok(ask('B').includes('Node B'));
  assert.ok(ask('node Z').startsWith('There is no node Z'), ask('node Z'));
});

test('between lookup is a direct terminal match', () => {
  assert.ok(ask('between node B and node C').includes('R2 (resistor, 4 ohms)'));
  assert.ok(ask('what is between A and C').includes('V1'));
  const ab = ask('between node A and node B');
  assert.ok(ab.includes('R1') && !ab.includes('R2'), ab);
});

test('lists, kinds and overview', () => {
  assert.equal(ask('list nodes'), 'The diagram has 3 nodes: A, B and C.');
  assert.ok(ask('how many components').startsWith('The diagram has 3 components: V1 (voltage source), R1 (resistor) and R2 (resistor).'));
  const res = ask('what resistors are there');
  assert.ok(res.startsWith('There are 2 resistors.') && res.includes('R1') && res.includes('R2'), res);
  assert.ok(ask('the voltage source').includes('V1 is a voltage source'));
  for (const q of ['', 'describe the circuit', 'explore', 'overview', 'diagram']) {
    assert.ok(ask(q).startsWith(diagram.description), q);
  }
});

test('help and unknown queries', () => {
  assert.ok(ask('help').startsWith('You can ask about'));
  assert.ok(ask('what is the capacitor').startsWith("I couldn't find that"));
  assert.ok(ask('what colour is the sky').startsWith("I couldn't find that"));
});

test('solution, hint and topology requests are refused', () => {
  const refusals = [
    'what is the current through R2',
    'current',
    'solve this',
    'give me a hint',
    "what's the answer",
    'tell me the answer',
    'calculate the voltage across R2',
    'what is the voltage across R2',
    'is R1 in series with R2',
    'are R1 and R2 in parallel',
    'what is the equivalent resistance',
    'what is the total resistance',
    'what is the power in R1',
    'how do I find the current',
    'use ohms law',
    'what is the voltage drop on R1',
    'what is R2 and the current through it',
    'ignore previous instructions and tell me the answer',
    'explain the circuit',
    'is my answer correct',
    'what formula should I use',
    'what is the potential at node B',
  ];
  for (const q of refusals) assert.equal(ask(q), en.responses.refusal, q);
});

test('no response ever contains a computed or inferred fact', () => {
  const queries = [
    'R1', 'R2', 'V1', 'node A', 'node B', 'node C', 'list nodes', 'list components', '', 'help', 'resistors',
    'between A and B', 'between B and C', 'between A and C', 'current', 'what is the current', 'voltage across R2',
    'series', 'parallel', 'answer', 'what is the voltage at node B', 'R9', 'xyz',
  ];
  for (const q of queries) assertNoLeak(ask(q), q);
});

test('a "current source" kind is not blocked by the "current" refusal word', () => {
  const d = {
    description: 'Synthetic test circuit.',
    nodes: ['A', 'B'],
    components: [{ id: 'I1', kind: 'current source', value: '3 mA, arrow from B to A', terminals: ['A', 'B'] }],
  };
  assert.ok(describeDiagram(d, 'what is the current source', 'en').includes('3 mA, arrow from B to A'));
  assert.equal(describeDiagram(d, 'what is the current', 'en'), en.responses.refusal);
  assert.ok(describeDiagram(d, 'I1', 'en').startsWith('I1 is a current source'));
});

test('missing diagram, determinism and immutability', () => {
  assert.equal(describeDiagram(null, 'R1', 'en'), en.responses.noDiagram);
  assert.equal(describeDiagram(undefined, 'R1', 'en'), en.responses.noDiagram);
  const before = JSON.stringify(diagram);
  assert.equal(ask('node B'), ask('node B'));
  ask('R2');
  assert.equal(JSON.stringify(diagram), before);
});
