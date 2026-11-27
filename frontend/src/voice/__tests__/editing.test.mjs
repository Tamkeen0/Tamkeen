import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditCommand, applyEdit, AnswerDraft } from '../editing.ts';
import { editResultPrompt, prompts } from '../prompts.ts';
import { parseCommand } from '../parser.ts';
import { parseNavigation } from '../navigation.ts';

const p = (t) => parseEditCommand(t);
const edit = (answer, utterance) => applyEdit(answer, parseEditCommand(utterance));

// ---------- parsing ----------

test('parses each edit command, keeping the spoken payload as said', () => {
  assert.deepEqual(p('add through R2'), { type: 'append', text: 'through R2' });
  assert.deepEqual(p('Append plus C to my answer.'), { type: 'append', text: 'plus C' });
  assert.deepEqual(p('replace three with four'), { type: 'replace', target: 'three', replacement: 'four', all: false });
  assert.deepEqual(p('Change 2x to 3x'), { type: 'replace', target: '2x', replacement: '3x', all: false });
  assert.deepEqual(p('replace every x with y'), { type: 'replace', target: 'x', replacement: 'y', all: true });
  assert.deepEqual(p('delete amps'), { type: 'delete', target: 'amps', all: false });
  assert.deepEqual(p('remove the word very'), { type: 'delete', target: 'very', all: false });
  assert.deepEqual(p('delete every comma'), { type: 'delete', target: 'comma', all: true });
  assert.deepEqual(p('delete the last word'), { type: 'deleteLastWords', count: 1 });
  assert.deepEqual(p('remove the last two words'), { type: 'deleteLastWords', count: 2 });
  assert.deepEqual(p('delete last 3 words'), { type: 'deleteLastWords', count: 3 });
  assert.deepEqual(p('insert about before 3'), { type: 'insert', text: 'about', position: 'before', anchor: '3' });
  assert.deepEqual(p('put plus C after 3'), { type: 'insert', text: 'plus C', position: 'after', anchor: '3' });
  assert.deepEqual(p('undo'), { type: 'undo' });
  assert.deepEqual(p('Undo that.'), { type: 'undo' });
  for (const t of ['clear', 'clear my answer', 'start over', 'delete everything', 'erase my whole answer']) {
    assert.deepEqual(p(t), { type: 'clear' }, t);
  }
  for (const t of ['edit', 'edit my answer', 'how do I edit my answer']) assert.deepEqual(p(t), { type: 'help' }, t);
});

test('not edit commands: ordinary commands, navigation, dictation-like text and incomplete edits', () => {
  for (const t of ['next', 'confirm', 'cancel', 'answer', 'submit', 'repeat', 'read my answer', 'go to question 2',
    'the answer is 2x plus 3', 'what is R2', 'add', 'delete', 'replace three', 'replace with four', 'change my answer to', '']) {
    assert.equal(p(t), null, t);
  }
});

test('edit phrases do not collide with commands or navigation', () => {
  for (const t of ['add through R2', 'replace three with four', 'delete the last word', 'undo', 'clear my answer', 'edit']) {
    assert.equal(parseCommand(t).type === 'submit' || parseCommand(t).type === 'confirm', false, t);
    assert.equal(parseNavigation(t), null, t);
  }
});

// ---------- applying ----------

test('append, replace, delete, insert and delete-last-words', () => {
  const a = 'the current is 3 amps';
  assert.equal(edit(a, 'add through R2').text, 'the current is 3 amps through R2');
  assert.equal(edit('', 'add 17').text, '17');
  assert.equal(edit(a, 'replace amps with milliamps').text, 'the current is 3 milliamps');
  assert.equal(edit(a, 'delete amps').text, 'the current is 3');
  assert.equal(edit(a, 'insert about before 3').text, 'the current is about 3 amps');
  assert.equal(edit(a, 'insert roughly after is').text, 'the current is roughly 3 amps');
  assert.equal(edit(a, 'delete the last word').text, 'the current is 3');
  assert.equal(edit(a, 'delete the last two words').text, 'the current is');
  assert.equal(edit(a, 'delete the last ten words').text, '');
  assert.equal(edit(a, 'clear').text, '');
});

test('spoken words match written symbols and digits', () => {
  assert.equal(edit('the current is 3 amps', 'replace three with four').text, 'the current is four amps');
  assert.equal(edit('2 X + 3', 'replace plus with minus').text, '2 X minus 3');
  assert.equal(edit('2 X + 3', 'replace x with y').text, '2 y + 3', 'case-insensitive target, replacement as spoken');
  assert.equal(edit('f(x) = 2x + 3', 'replace 2x with 3x').text, 'f(x) = 3x + 3');
  assert.equal(edit('R1 equals 5 volts.', 'replace volts with V').text, 'R1 equals 5 V.', 'keeps trailing punctuation');
  assert.equal(edit('2x+3', 'replace 2x with 4x').text, '4x+3', 'plain-text fallback inside symbols');
});

test('a target found more than once changes nothing unless "every" is said', () => {
  const r = edit('x plus x', 'replace x with y');
  assert.deepEqual(r, { ok: false, reason: 'ambiguous', target: 'x', count: 2 });
  assert.equal(edit('x plus x', 'replace every x with y').text, 'y plus y');
  assert.equal(edit('very very good', 'delete every very').text, 'good');
  assert.deepEqual(edit('3 plus 3', 'insert about before 3'), { ok: false, reason: 'ambiguous', target: '3', count: 2 });
});

test('missing targets, empty answers and partial words change nothing', () => {
  assert.deepEqual(edit('the current is 3 amps', 'replace volts with amps'), { ok: false, reason: 'notFound', target: 'volts' });
  assert.deepEqual(edit('resistance', 'delete resist'), { ok: false, reason: 'notFound', target: 'resist' }, 'no partial-word match');
  assert.deepEqual(edit('', 'replace x with y'), { ok: false, reason: 'empty' });
  assert.deepEqual(edit('   ', 'delete the last word'), { ok: false, reason: 'empty' });
  assert.deepEqual(applyEdit('abc', { type: 'undo' }), { ok: false, reason: 'nothingToUndo' });
});

test('AnswerDraft keeps unlimited undo back to where editing started', () => {
  const d = new AnswerDraft('the current is 3 amps');
  assert.equal(d.canUndo, false);
  d.apply(p('replace three with four'));
  d.apply(p('add through R2'));
  assert.equal(d.text, 'the current is four amps through R2');
  d.apply(p('replace volts with amps')); // failure: not recorded
  d.apply(p('undo'));
  assert.equal(d.text, 'the current is four amps');
  d.apply(p('undo'));
  assert.equal(d.text, 'the current is 3 amps');
  assert.deepEqual(d.apply(p('undo')), { ok: false, reason: 'nothingToUndo' });
  d.apply(p('clear'));
  assert.equal(d.text, '');
  d.apply(p('undo'));
  assert.equal(d.text, 'the current is 3 amps', 'clear is undoable');
});

test('edit result prompts tell the student what happened and what to do next', () => {
  assert.equal(
    editResultPrompt(edit('x^2 + 3x', 'add plus C')),
    'Changed. Your answer is now: x squared plus 3 x plus C. Say save to keep it, or keep editing.',
  );
  assert.equal(editResultPrompt(edit('a b', 'delete c')), 'I could not find c in your answer. Nothing was changed.');
  assert.match(editResultPrompt(edit('x plus x', 'delete x')), /^x appears 2 times in your answer, so nothing was changed\. Say replace every x/);
  assert.equal(editResultPrompt({ ok: false, reason: 'empty' }), prompts.editEmpty);
  assert.equal(editResultPrompt(edit('abc', 'clear')), prompts.edited(''));
});
