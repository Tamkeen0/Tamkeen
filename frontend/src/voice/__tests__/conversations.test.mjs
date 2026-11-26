// Multi-turn reference conversations (requested test cases A, B, C) and
// the "Solve this circuit" refusal path, end to end through parseCommand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagramExplorer, describeDiagram } from '../diagram.ts';
import { parseCommand } from '../parser.ts';
import { en } from '../lang/en.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const demo = exam.questions.find((q) => q.type === 'diagram').diagram;

// Same synthetic circuit as dev/circuits.ts "wide" (no real exam data).
const wide = {
  description: 'Synthetic test circuit with a voltage source, four resistors and a current source. Nodes A, B, C, and D.',
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

/** Ask through the real command path: utterance -> parseCommand -> explorer.ask(query). */
function say(explorer, utterance) {
  const cmd = parseCommand(utterance);
  assert.equal(cmd.type, 'explore', `"${utterance}" should be an explore request, got ${cmd.type}`);
  return explorer.ask(cmd.query);
}

for (const [name, diagram] of [['demo', demo], ['wide', wide]]) {
  test(`Conversation A (${name}): "there" refers to node B`, () => {
    const ex = createDiagramExplorer(diagram, 'en');
    assert.ok(say(ex, 'What is R2?').startsWith('R2 is a resistor'));

    const a2 = say(ex, 'What is connected to its first node?');
    assert.ok(a2.startsWith('Node B is connected to'), a2);
    assert.deepEqual(ex.focus, { type: 'node', id: 'B' });

    const a3 = say(ex, 'What other components are connected there?');
    assert.ok(a3.startsWith('Besides R2, node B is connected to'), a3);
    assert.ok(a3.includes('R1') && !a3.includes('R2 ('), a3);
    if (name === 'wide') assert.ok(a3.includes('R3'), a3);
    assert.deepEqual(ex.focus, { type: 'node', id: 'B' });
  });
}

test('Conversation B (wide): focus moves from R2 to R4; its value is 2.2 ohms', () => {
  const ex = createDiagramExplorer(wide, 'en');
  say(ex, 'What is R2?');
  assert.deepEqual(ex.focus, { type: 'component', id: 'R2' });
  say(ex, 'What is R4?');
  assert.deepEqual(ex.focus, { type: 'component', id: 'R4' });
  const b3 = say(ex, 'What is its value?');
  assert.ok(b3.startsWith('R4 is a resistor with value 2.2 ohms'), b3);
});

for (const [name, diagram] of [['demo', demo], ['wide', wide]]) {
  test(`Conversation C (${name}): latest focus is node A, so "its value" asks which component`, () => {
    const ex = createDiagramExplorer(diagram, 'en');
    say(ex, 'What is R2?');
    const c2 = say(ex, 'What is connected to node A?');
    assert.ok(c2.startsWith('Node A is connected to'), c2);
    assert.deepEqual(ex.focus, { type: 'node', id: 'A' });

    const c3 = say(ex, 'What is its value?');
    assert.equal(c3, 'Node A has 2 components: V1 and R1. Which one do you mean?');
    assert.ok(!c3.includes('R2'), 'must not fall back to the older focus R2');
    assert.deepEqual(ex.focus, { type: 'node', id: 'A' }, 'a clarifying question does not move focus');
  });
}

test('node focus with exactly one component: "its value" resolves to that component', () => {
  const d = {
    description: 'Synthetic.',
    nodes: ['A', 'B', 'C'],
    components: [
      { id: 'R1', kind: 'resistor', value: '10 ohms', terminals: ['A', 'B'] },
      { id: 'R2', kind: 'resistor', value: '20 ohms', terminals: ['B', 'C'] },
    ],
  };
  const ex = createDiagramExplorer(d, 'en');
  ex.ask('node A');
  assert.ok(ex.ask('what is its value').startsWith('R1 is a resistor with value 10 ohms'));
});

test('terminal references: first, second, last and other end', () => {
  const ex = createDiagramExplorer(wide, 'en');
  assert.ok(ex.ask('the first node of R4').startsWith('Node C'));
  assert.ok(ex.ask('the second terminal of R4').startsWith('Node D'));
  assert.ok(ex.ask('the last end of R1').startsWith('Node B'));
  ex.ask('node B');
  assert.ok(ex.ask('the other end of R2').startsWith('Node C'), 'other end relative to focused node B');
  assert.equal(describeDiagram(wide, 'the other end of R2', 'en'), en.responses.whichNode({ component: 'V1', node: 'A', otherNode: 'B' }));
  assert.ok(describeDiagram(wide, 'the third terminal of R2', 'en').startsWith('No component in this diagram matches'));
});

test('"there" without a node in focus asks which node; "is there" / "are there" stay existential', () => {
  const ex = createDiagramExplorer(demo, 'en');
  assert.equal(ex.ask('what is connected there'), en.responses.whichNode({ component: 'V1', node: 'A', otherNode: 'B' }));
  ex.ask('R1');
  assert.ok(ex.ask('what is connected there').startsWith('Which node do you mean'), 'component focus is not a place');
  assert.ok(describeDiagram(demo, 'what resistors are there', 'en').startsWith('There are 2 resistors'));
  assert.ok(describeDiagram(demo, 'is there a capacitor', 'en').startsWith("I couldn't find"));
});

test('"other" without a node keeps meaning "the other resistor", using the last component even after a node', () => {
  const ex = createDiagramExplorer(demo, 'en');
  ex.ask('R2');
  ex.ask('node B');
  assert.ok(ex.ask('the other resistor').startsWith('R1 is a resistor'));
});

test('"Solve this circuit" gets the explicit refusal, with or without a diagram', () => {
  const cmd = parseCommand('Solve this circuit');
  assert.equal(cmd.type, 'explore');
  assert.equal(describeDiagram(demo, cmd.query, 'en'), en.responses.refusal);
  assert.equal(describeDiagram(null, cmd.query, 'en'), en.responses.refusal, 'math/MCQ questions have no diagram');
  assert.equal(describeDiagram(null, 'R1', 'en'), en.responses.noDiagram);
  const ex = createDiagramExplorer(demo, 'en');
  ex.ask('R2');
  for (const t of ['Solve this circuit', 'give me a hint', 'find the current through it', 'explain the circuit']) {
    assert.equal(ex.ask(parseCommand(t).query), en.responses.refusal, t);
  }
  assert.deepEqual(ex.focus, { type: 'component', id: 'R2' });
});
