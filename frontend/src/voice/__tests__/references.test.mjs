import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeDiagram, createDiagramExplorer } from '../diagram.ts';
import { en } from '../lang/en.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const diagram = exam.questions.find((q) => q.type === 'diagram').diagram;
const ask = (q) => describeDiagram(diagram, q, 'en');
const isAbout = (text, id) => text.startsWith(`${id} is a`);

// A larger synthetic circuit with repeated kinds and values (no real exam data).
const wide = {
  description: 'Synthetic test circuit with four resistors.',
  nodes: ['A', 'B', 'C', 'D'],
  components: [
    { id: 'V1', kind: 'voltage source', value: '9 V, positive at A, negative at D', terminals: ['A', 'D'] },
    { id: 'R1', kind: 'resistor', value: '100 ohms', terminals: ['A', 'B'] },
    { id: 'R2', kind: 'resistor', value: '220 ohms', terminals: ['B', 'C'] },
    { id: 'R3', kind: 'resistor', value: '220 ohms', terminals: ['B', 'D'] },
    { id: 'R4', kind: 'resistor', value: '2.2 ohms', terminals: ['C', 'D'] },
    { id: 'I1', kind: 'current source', value: '3 mA, arrow from D to C', terminals: ['C', 'D'] },
  ],
};
const askWide = (q) => describeDiagram(wide, q, 'en');

// ---------- by value ----------

test('value references resolve when exactly one component has that value', () => {
  assert.ok(isAbout(ask('the 4 ohm resistor'), 'R2'), ask('the 4 ohm resistor'));
  assert.ok(isAbout(ask('the 2 ohms one'), 'R1'));
  assert.ok(isAbout(ask('the 12 volt source'), 'V1'));
  assert.ok(isAbout(ask('what is connected to the 4 Ω resistor'), 'R2'));
  assert.ok(isAbout(askWide('the 2.2 ohm resistor'), 'R4'), askWide('the 2.2 ohm resistor'));
  assert.ok(isAbout(askWide('the 3 mA source'), 'I1'), askWide('the 3 mA source'));
  assert.ok(isAbout(askWide('the 3 milliamp current source'), 'I1'));
  assert.ok(askWide('the 3 amp source').startsWith('I can only describe'), 'plain amps ≠ mA, and amps is a refusal word');
  assert.ok(askWide('the 100 kilohm resistor').startsWith('No component in this diagram matches'), 'kilohm ≠ ohm');
});

test('several components with the same value are listed, never guessed', () => {
  const out = askWide('the 220 ohm resistor');
  assert.ok(out.startsWith('2 components match') && out.includes('R2') && out.includes('R3'), out);
});

test('values that do not exist get a clear no-match', () => {
  assert.ok(ask('the 7 ohm resistor').startsWith('No component in this diagram matches'));
  assert.ok(ask('the 12 ohm resistor').startsWith('No component in this diagram matches')); // 12 is volts
});

test('a bare number is an id, not a value ("resistor 4" is not the 4 ohm resistor)', () => {
  assert.ok(ask('resistor 4').startsWith('There is no R4'), ask('resistor 4'));
  assert.ok(ask('resistor four').startsWith('There is no R4'));
  assert.ok(isAbout(ask('resistor 2'), 'R2'));
});

// ---------- by order ----------

test('ordinal references follow the approved component order', () => {
  assert.ok(isAbout(ask('the first resistor'), 'R1'));
  assert.ok(isAbout(ask('the second resistor'), 'R2'));
  assert.ok(isAbout(ask('the last resistor'), 'R2'));
  assert.ok(isAbout(ask('the first component'), 'V1'));
  assert.ok(isAbout(ask('the last component'), 'R2'));
  assert.ok(ask('the second node').startsWith('Node B is connected to'));
  assert.ok(ask('the third resistor').startsWith('No component in this diagram matches'));
  assert.ok(isAbout(askWide('the 3rd resistor'), 'R3'));
});

// ---------- by place ----------

test('kind + node narrows to the components at that node', () => {
  assert.ok(isAbout(ask('the resistor at node C'), 'R2'));
  assert.ok(isAbout(ask('the resistor connected to node A'), 'R1'));
  const b = ask('which resistors touch node B');
  assert.ok(b.startsWith('2 components match') && b.includes('R1') && b.includes('R2'), b);
  assert.equal(ask('the voltage source at node B'), 'No voltage source is connected to node B.');
  assert.ok(ask('node B').startsWith('Node B is connected to')); // unchanged without a kind
});

test('kind + between narrows to one component', () => {
  assert.ok(isAbout(ask('the resistor between node B and node C'), 'R2'));
  // I1 (current source) is also between C and D, but only one *resistor* is.
  assert.ok(isAbout(askWide('the resistor between C and D'), 'R4'));
  const both = askWide('between node C and node D');
  assert.ok(both.startsWith('Between node C and node D') && both.includes('R4') && both.includes('I1'), both);
});

// ---------- contextual (explorer) ----------

test('explorer resolves "it", "its", "that one" to the last component', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  assert.equal(ex.focus, null);
  assert.ok(isAbout(ex.ask('R2'), 'R2'));
  assert.deepEqual(ex.focus, { type: 'component', id: 'R2' });
  assert.ok(isAbout(ex.ask('what is its value'), 'R2'));
  assert.ok(isAbout(ex.ask('where is it connected'), 'R2'));
  assert.ok(isAbout(ex.ask('tell me about that one'), 'R2'));
  assert.ok(isAbout(ex.ask('that resistor'), 'R2'));
});

test('explorer follows descriptive references and "the other resistor"', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  assert.ok(isAbout(ex.ask('the 2 ohm resistor'), 'R1'));
  assert.ok(isAbout(ex.ask('the other resistor'), 'R2'));
  assert.ok(isAbout(ex.ask('the other one'), 'R1'));
  assert.ok(isAbout(ex.ask('V1'), 'V1'));
  assert.equal(ex.ask('the other voltage source'), 'There is no other voltage source in this diagram.');
});

test('explorer focuses nodes too', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  ex.ask('node B');
  assert.deepEqual(ex.focus, { type: 'node', id: 'B' });
  assert.ok(ex.ask('what is connected to it').startsWith('Node B is connected to'));
});

test('pronouns with no focus ask which component, never guess', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  assert.equal(ex.ask('what is its value'), en.responses.whichOne({ component: 'V1', node: 'A', otherNode: 'B' }));
  assert.equal(ask('what is that'), en.responses.whichOne({ component: 'V1', node: 'A', otherNode: 'B' }));
  const other = ask('the other resistor');
  assert.ok(other.startsWith('2 components match'), other);
});

test('pronouns used as determiners or relative pronouns are not references', () => {
  assert.ok(ask('describe this circuit').startsWith(diagram.description));
  const rel = ask('which resistors are there that touch node B');
  assert.ok(!rel.startsWith('Which component do you mean'), rel);
  assert.ok(ask('list components that touch node C').length > 0);
  assert.ok(!ask('list components that touch node C').startsWith('Which component'));
});

test('reset and list answers: focus is kept by lists, cleared by reset', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  ex.ask('R1');
  ex.ask('list nodes');
  assert.deepEqual(ex.focus, { type: 'component', id: 'R1' });
  ex.reset();
  assert.equal(ex.focus, null);
  assert.ok(ex.ask('its value').startsWith('Which component do you mean'));
});

// ---------- safety ----------

test('references never bypass refusals', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  ex.ask('R2');
  for (const q of ['what is the current through it', 'solve it', 'is it in series with R1', 'what is the voltage across that one', 'the other resistor in parallel', 'calculate its power']) {
    assert.equal(ex.ask(q), en.responses.refusal, q);
  }
  assert.deepEqual(ex.focus, { type: 'component', id: 'R2' }, 'a refusal does not move focus');
  assert.equal(askWide('the 2 amp source'), en.responses.refusal, 'amps not in any value -> refused');
});

test('no reference answer leaks computed facts', () => {
  const ex = createDiagramExplorer(diagram, 'en');
  const leaks = [/\b2\s?a\b/i, /\b8\s?v\b/i, /\b4\s?v\b/i, /\b6\s?ohm/i, /\bseries\b/i, /\bparallel\b/i];
  for (const q of ['R2', 'its value', 'the other resistor', 'that one', 'the 4 ohm resistor', 'the first resistor', 'the resistor at node C', 'node B', 'it']) {
    const out = ex.ask(q);
    for (const re of leaks) assert.doesNotMatch(out, re, `${q}: ${out}`);
  }
});

test('explorers are independent per question', () => {
  const a = createDiagramExplorer(diagram, 'en');
  const b = createDiagramExplorer(diagram, 'en');
  a.ask('R1');
  assert.equal(b.focus, null);
  assert.ok(b.ask('it').startsWith('Which component'));
});
