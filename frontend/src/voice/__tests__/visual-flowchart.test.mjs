// Flowchart adapter (second supported diagram type), tested independently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowchartToVisual } from '../visual/adapters/flowchart.ts';
import { VisualExplorer } from '../visual/engine.ts';
import { parseExploreAction } from '../visual/commands.ts';
import { VisualDataError } from '../visual/model.ts';
import { TEST_FLOWCHART } from '../dev/circuits.ts';

const say = (ex, text, lang = 'en') => {
  const action = parseExploreAction(text);
  assert.ok(action, `not an exploration command: ${text}`);
  return ex.act(action, lang, text);
};

test('adapter: steps are places, arrows directed with printed labels; tour follows arrows from Start', () => {
  const doc = flowchartToVisual(TEST_FLOWCHART);
  assert.equal(doc.type, 'flowchart');
  assert.deepEqual(doc.readingOrder, ['s1', 's2', 's3', 's4', 's6', 's5'], 'depth first, arrows in listed order');
  assert.equal(doc.startAt, 's1');
  assert.deepEqual(doc.relations.filter((r) => r.label).map((r) => [r.from, r.to, r.label]), [['s3', 's4', 'yes'], ['s3', 's5', 'no']]);
  assert.ok(doc.relations.every((r) => r.directed && r.kind === 'arrow'));
});

test('adapter: unreachable steps come last, unchanged; bad data is rejected', () => {
  const data = { ...TEST_FLOWCHART, steps: [...TEST_FLOWCHART.steps, { id: 'x', label: 'Archive', kind: 'process' }] };
  assert.equal(flowchartToVisual(data).readingOrder.at(-1), 'x');
  assert.throws(() => flowchartToVisual({ ...TEST_FLOWCHART, arrows: [{ from: 's1', to: 'nope' }] }), VisualDataError);
  assert.throws(() => flowchartToVisual({ ...TEST_FLOWCHART, steps: [{ id: 'a', label: 'A', kind: 'cloud' }] }), VisualDataError);
});

test('tour reads steps and branches in order', () => {
  const ex = new VisualExplorer(flowchartToVisual(TEST_FLOWCHART));
  assert.match(say(ex, 'walk me through this flowchart'), /^A flowchart for handling an online order\. The tour has 6 parts\..*Part 1 of 6\. Start\. Next: Receive order\.$/);
  assert.equal(say(ex, 'next step'), 'Part 2 of 6. Receive order, step. Next: Item in stock?');
  assert.equal(say(ex, 'next step'), 'Part 3 of 6. Item in stock?, decision. Arrows: yes, to Ship order; no, to Notify customer of delay.');
  say(ex, 'next step');
  assert.equal(say(ex, 'next step'), 'Part 5 of 6. End. This is an end of the flowchart.');
});

test('following arrows: next step, decision branches by printed label, dead end, came from', () => {
  const ex = new VisualExplorer(flowchartToVisual(TEST_FLOWCHART));
  assert.equal(say(ex, 'start at receive order'), 'Receive order, step. Next: Item in stock?');
  assert.match(say(ex, 'what happens next'), /^Following the arrow\. Item in stock\?, decision\./);
  assert.match(say(ex, 'what happens next'), /^From Item in stock\?, you can follow yes, to Ship order and no, to Notify customer of delay\./, 'branch: ask');
  assert.match(say(ex, 'take the no branch'), /^Following the no arrow\. Notify customer of delay, output step\. Next: End\.$/);
  assert.match(say(ex, 'where did I come from'), /^You came from Item in stock\?\. Arrows into this step come from Item in stock\?\./);
  say(ex, 'step back');
  assert.match(say(ex, 'follow yes'), /^Following the yes arrow\. Ship order, step\./);
  say(ex, 'what happens next');
  assert.equal(say(ex, 'what happens next'), 'No arrow leaves End.');
});

test('flowchart: unknown and unrelated steps; "follow" never jumps along a missing arrow', () => {
  const ex = new VisualExplorer(flowchartToVisual(TEST_FLOWCHART));
  assert.match(say(ex, 'go to payment'), /^There is no payment in this diagram\. Parts include Start, Receive order/);
  say(ex, 'start at receive order');
  assert.match(say(ex, 'follow ship order'), /^ship order is not connected to Receive order\. From here you can follow Item in stock\?/);
  assert.match(say(ex, 'follow maybe'), /^There is no maybe in this diagram/);
});

test('detailed mode adds approved step text and incoming arrows', () => {
  const ex = new VisualExplorer(flowchartToVisual(TEST_FLOWCHART));
  say(ex, 'start at notify customer');
  assert.equal(
    say(ex, 'give me more detail'),
    'Detailed descriptions. Notify customer of delay, output step. Next: End. An email is sent to the customer. Arrows in from: Item in stock?',
  );
  assert.equal(say(ex, 'describe briefly'), 'Brief descriptions.');
});

test('Arabic: commands and replies for the flowchart (labels stay as approved)', () => {
  const ex = new VisualExplorer(flowchartToVisual(TEST_FLOWCHART));
  assert.match(say(ex, 'ابدأ الجولة', 'ar'), /في الجولة 6 أجزاء\..*الجزء 1 من 6\. Start، البداية\. التالي: Receive order\.$/);
  assert.match(say(ex, 'الخطوة التالية', 'ar'), /^الجزء 2 من 6\. Receive order، خطوة\./);
  assert.match(say(ex, 'ابدأ من receive order', 'ar'), /^Receive order، خطوة\./);
  assert.match(say(ex, 'ماذا يحدث بعد ذلك', 'ar'), /^باتباع السهم\. Item in stock\?، قرار\. الأسهم: yes، إلى Ship order؛ no، إلى Notify customer of delay\.$/);
  assert.match(say(ex, 'اتبع no', 'ar'), /^باتباع سهم no\./);
  assert.match(say(ex, 'من أين أتيت', 'ar'), /^أتيت من Item in stock\?/);
});
