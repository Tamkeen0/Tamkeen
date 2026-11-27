// Circuit adapter + backward compatibility through the contract functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { circuitToVisual } from '../visual/adapters/circuit.ts';
import { VisualExplorer } from '../visual/engine.ts';
import { parseExploreAction } from '../visual/commands.ts';
import { describeDiagram, createDiagramExplorer } from '../diagram.ts';
import { parseCommand } from '../parser.ts';
import { en } from '../lang/en.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const fixture = exam.questions.find((q) => q.type === 'diagram').diagram;
const copy = () => JSON.parse(JSON.stringify(fixture));
const say = (ex, text) => ex.act(parseExploreAction(text), 'en', text);

test('adapter: components become links, nodes places, terminals connections; order = approved order', () => {
  const doc = circuitToVisual(fixture);
  assert.equal(doc.type, 'circuit');
  assert.equal(doc.summary, fixture.description);
  assert.deepEqual(doc.readingOrder, ['V1', 'R1', 'R2']);
  assert.deepEqual(doc.elements.filter((e) => e.role === 'place').map((e) => e.label), ['A', 'B', 'C']);
  assert.deepEqual(doc.relations.map((r) => [r.via, r.from, r.to, r.directed]), [
    ['V1', 'node:A', 'node:C', false], ['R1', 'node:A', 'node:B', false], ['R2', 'node:B', 'node:C', false],
  ]);
  assert.equal(doc.elements.find((e) => e.id === 'V1').attributes[0].value, '12 V, positive at A, negative at C', 'verbatim');
});

test('circuit: following a component moves to its other terminal; spoken forms resolve', () => {
  const ex = new VisualExplorer(circuitToVisual(fixture));
  assert.equal(say(ex, 'start at node bee'), 'Node B. Connected to R1 and R2.');
  assert.equal(say(ex, 'follow are two'), 'Following R2. Node C. Connected to V1 and R2.');
  assert.equal(say(ex, 'follow V1'), 'Following V1. Node A. Connected to V1 and R1.');
  assert.equal(say(ex, 'where did I come from'), 'You came from node C along V1.');
});

test('stateless describeDiagram (merged UI) keeps a tour per diagram object; lookups unchanged', () => {
  const d = copy();
  assert.match(describeDiagram(d, 'walk me through this circuit', 'en'), /Part 1 of 3\. V1/);
  assert.match(describeDiagram(d, 'next part', 'en'), /^Part 2 of 3\. R1/);
  assert.match(describeDiagram(d, 'R2', 'en'), /^R2 is a resistor with value 4 ohms/, 'a question does not disturb the tour');
  assert.match(describeDiagram(d, 'next part', 'en'), /^Part 3 of 3\. R2/);
  const other = copy();
  assert.equal(describeDiagram(other, 'next part', 'en'), en.visual.responses.tourNotActive, 'another diagram object has its own session');
  // The contract parser routes the same phrases to explore, so the UI needs no change
  for (const t of ['walk me through this diagram', 'next part', 'previous part', 'follow R1', 'start at node A', 'give me more detail', 'ابدأ الجولة']) {
    assert.equal(parseCommand(t).type, 'explore', t);
  }
});

test('exam navigation is unchanged: bare "next" and "go back" still move between questions', () => {
  assert.equal(parseCommand('next').type, 'next');
  assert.equal(parseCommand('go back').type, 'previous');
  assert.equal(parseCommand('Go to the next question.').type, 'next');
  assert.equal(parseExploreAction('go to question 2'), null);
  assert.equal(parseExploreAction('next'), null);
});

test('explorer: exploration updates "it" focus; existing reference answers still work', () => {
  const ex = createDiagramExplorer(copy(), 'en');
  ex.ask('start the tour');
  ex.ask('next part');
  assert.deepEqual(ex.focus, { type: 'component', id: 'R1' });
  assert.match(ex.ask('what is its value'), /^R1 is a resistor with value 2 ohms/);
  assert.match(ex.ask('the other resistor'), /^R2 is a resistor/);
  assert.equal(ex.exploring, true);
  assert.match(ex.where(), /^In the tour: part 2 of 3, R1\./);
  ex.reset();
  assert.equal(ex.exploring, false);
});

test('integrity: exploration never states topology or computed values; solution requests refused', () => {
  const ex = createDiagramExplorer(copy(), 'en');
  const all = [];
  for (const t of ['walk me through this circuit', 'next part', 'next part', 'give me more detail', 'start at node B', 'what is connected here',
    'follow R1', 'what else is here', 'where did I come from', 'step back', 'go back to the beginning']) {
    all.push(ex.ask(t));
  }
  for (const out of all) {
    for (const re of [/\bseries\b/i, /\bparallel\b/i, /\b2\s?a\b/i, /\b8\s?v\b/i, /\b4\s?v\b/i, /\b6\s?ohm/i, /equivalent/i]) {
      assert.doesNotMatch(out, re, out);
    }
  }
  assert.equal(ex.ask('follow the current through R1'), en.responses.refusal);
  assert.equal(ex.ask('solve this circuit'), en.responses.refusal);
  assert.equal(ex.ask('start at the equivalent resistance'), en.responses.refusal);
  // Names that pass the command parser but ask for unshown quantities: refused by the name check
  assert.equal(ex.ask('follow the current'), en.responses.refusal);
  assert.equal(ex.ask('go to the power'), en.responses.refusal);
  assert.equal(ex.ask('اتبع التيار'), 'يمكنني فقط وصف ما يظهر في المخطط: المكونات وقيمها والعقد التي تتصل بها. لا يمكنني الحل أو الحساب أو إعطاء تلميحات.');
});
