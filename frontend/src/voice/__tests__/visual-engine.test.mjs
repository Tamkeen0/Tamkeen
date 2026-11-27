// Universal exploration engine, tested on a synthetic VisualDocument independent of any adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualExplorer } from '../visual/engine.ts';
import { validateDocument, VisualDataError } from '../visual/model.ts';
import { visualEn } from '../lang/visual-en.ts';

const r = visualEn.responses;

// A small network-like graph: places P1..P3 joined by links L1, L2 (undirected, via links).
const doc = () =>
  validateDocument({
    type: 'circuit',
    summary: 'Synthetic test diagram.',
    elements: [
      { id: 'L1', label: 'L1', category: 'resistor', attributes: [{ name: 'value', value: '10 ohms' }], role: 'link' },
      { id: 'L2', label: 'L2', category: 'resistor', attributes: [{ name: 'value', value: '20 ohms' }], role: 'link', uncertain: true },
      { id: 'node:P', label: 'P', category: 'node', attributes: [], role: 'place' },
      { id: 'node:Q', label: 'Q', category: 'node', attributes: [], role: 'place' },
      { id: 'node:S', label: 'S', category: 'node', attributes: [], role: 'place' },
      { id: 'node:Z', label: 'Z', category: 'node', attributes: [], role: 'place' }, // disconnected
    ],
    relations: [
      { from: 'node:P', to: 'node:Q', kind: 'connection', via: 'L1', directed: false },
      { from: 'node:Q', to: 'node:S', kind: 'connection', via: 'L2', directed: false },
    ],
    readingOrder: ['L1', 'L2'],
  });

const act = (ex, type, extra = {}) => ex.act({ type, ...extra }, 'en');

test('tour: start, next, previous, repeat, end, restart, stop', () => {
  const ex = new VisualExplorer(doc());
  assert.equal(act(ex, 'tourNext'), r.tourNotActive, 'next before starting');
  const start = act(ex, 'tourStart');
  assert.match(start, /^Synthetic test diagram\. The tour has 2 parts\./);
  assert.match(start, /Part 1 of 2\. L1, resistor, 10 ohms\. Connects node P and node Q\.$/);
  assert.equal(act(ex, 'tourPrev'), r.tourAtFirst);
  assert.match(act(ex, 'tourNext'), /^Part 2 of 2\. L2/);
  assert.match(act(ex, 'tourRepeat'), /^Part 2 of 2\. L2/);
  assert.equal(act(ex, 'tourNext'), r.tourEnd);
  assert.deepEqual(ex.snapshot.tour, { active: true, index: 1, count: 2 }, 'end does not move past the last part');
  assert.match(act(ex, 'tourRestart'), /^From the beginning\. Part 1 of 2\./);
  assert.equal(act(ex, 'tourStop'), r.tourStopped);
  assert.equal(ex.snapshot.tour.active, false);
  assert.equal(act(ex, 'tourRepeat'), r.tourNotActive);
});

test('the summary is not repeated on every part', () => {
  const ex = new VisualExplorer(doc());
  act(ex, 'tourStart');
  assert.doesNotMatch(act(ex, 'tourNext'), /Synthetic test diagram/);
});

test('relationship exploration: start, what is here, follow, else, step back, came from', () => {
  const ex = new VisualExplorer(doc());
  assert.equal(act(ex, 'whatHere'), r.noPosition);
  assert.equal(act(ex, 'goTo', { ref: 'node p' }), 'Node P. Connected to L1.');
  assert.equal(act(ex, 'follow', { ref: null }), 'Following L1. Node Q. Connected to L1 and L2.', 'one way out: follow it');
  assert.match(act(ex, 'whatHere'), /^At node Q: L1 \(resistor, 10 ohms\) to node P; L2 \(resistor, 20 ohms\) to node S\.$/);
  assert.equal(act(ex, 'elseHere'), 'Also at node Q: L2.', 'excludes the link we arrived by');
  assert.match(act(ex, 'follow', { ref: null }), /^From node Q, you can follow L1 and L2/, 'several ways: ask, never guess');
  assert.match(act(ex, 'follow', { ref: 'l2' }), /^Following L2\. Node S\./);
  assert.equal(act(ex, 'cameFrom'), 'You came from node Q along L2.');
  assert.match(act(ex, 'stepBack'), /^Back\. Node Q\./);
  assert.match(act(ex, 'stepBack'), /^Back\. Node P\./);
  assert.equal(act(ex, 'stepBack'), r.nothingToGoBack);
  assert.equal(act(ex, 'cameFrom'), 'This is where you started exploring.');
});

test('missing or disconnected relationships are never invented', () => {
  const ex = new VisualExplorer(doc());
  act(ex, 'goTo', { ref: 'z' });
  assert.equal(act(ex, 'follow', { ref: null }), r.deadEnd({ id: 'node:Z', label: 'Z', category: 'node' }));
  act(ex, 'goTo', { ref: 'p' });
  assert.match(act(ex, 'follow', { ref: 'l2' }), /^L2 is not connected to node P\. From here you can follow L1\.$/i);
  assert.match(act(ex, 'follow', { ref: 'node s' }), /not connected to node P/, 'S exists but is not directly connected to P');
  assert.match(act(ex, 'goTo', { ref: 'node x' }), /^There is no node x in this diagram\./);
});

test('a link cannot be stood on: it says what it joins', () => {
  const ex = new VisualExplorer(doc());
  assert.match(act(ex, 'goTo', { ref: 'l1' }), /^L1 is a resistor that connects node P and node Q\. Say start at node P/);
  assert.equal(ex.snapshot.position, null);
});

test('states are independent: questions and exploration never reset the tour; detail keeps position', () => {
  const ex = new VisualExplorer(doc());
  act(ex, 'tourStart');
  act(ex, 'tourNext');
  act(ex, 'goTo', { ref: 'p' });
  act(ex, 'follow', { ref: 'l1' });
  assert.equal(ex.snapshot.tour.index, 1, 'tour position unchanged by exploration');
  assert.equal(ex.snapshot.position, 'node:Q');
  assert.match(act(ex, 'tourRepeat'), /^Part 2 of 2\. L2/);
  assert.equal(ex.snapshot.position, 'node:Q', 'tour moves do not change the exploration position');
  act(ex, 'detailed');
  assert.equal(ex.snapshot.position, 'node:Q');
  assert.equal(ex.snapshot.tour.index, 1);
  assert.equal(act(ex, 'where'), 'In the tour: part 2 of 2, L2. You are at Q.');
});

test('detail levels: brief by default, detailed adds approved facts only, switch any time', () => {
  const ex = new VisualExplorer(doc());
  assert.equal(ex.detail, 'brief');
  act(ex, 'goTo', { ref: 'q' });
  const detailed = act(ex, 'detailed');
  assert.match(detailed, /^Detailed descriptions\. Node Q\. L1 \(resistor, 10 ohms\) leads to node P; L2 \(resistor, 20 ohms\) leads to node S\./);
  assert.equal(act(ex, 'brief'), r.briefOn);
  assert.equal(act(ex, 'whatHere').startsWith('At node Q'), true);
  act(ex, 'tourStart');
  act(ex, 'tourNext');
  assert.match(act(ex, 'tourRepeat'), /Marked uncertain in the approved diagram\.$/, 'uncertainty is never hidden, even in brief mode');
});

test('validateDocument rejects inconsistent approved data instead of guessing', () => {
  const bad = (patch) => () => validateDocument({ ...doc(), ...patch });
  assert.throws(bad({ relations: [{ from: 'node:P', to: 'node:NOPE', kind: 'connection', directed: false }] }), VisualDataError);
  assert.throws(bad({ relations: [{ from: 'node:P', to: 'node:Q', kind: 'connection', via: 'node:S', directed: false }] }), VisualDataError);
  assert.throws(bad({ readingOrder: ['L9'] }), VisualDataError);
  assert.throws(bad({ elements: [...doc().elements, { id: 'L1', label: 'dup', category: 'x', attributes: [], role: 'link' }] }), VisualDataError);
});
