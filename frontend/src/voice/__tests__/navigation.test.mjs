import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNavigation } from '../navigation.ts';
import { parseCommand } from '../parser.ts';
import { prompts } from '../prompts.ts';

const nav = (t) => parseNavigation(t);

test('the five requested commands', () => {
  assert.equal(nav('Go to the next question.'), null, 'handled by parseCommand');
  assert.equal(parseCommand('Go to the next question.').type, 'next');
  assert.deepEqual(nav('Go back to question two.'), { type: 'goto', question: 2 });
  assert.equal(nav('Read the current question again.'), null, 'handled by parseCommand');
  assert.equal(parseCommand('Read the current question again.').type, 'repeat');
  assert.deepEqual(nav('How many questions are remaining?'), { type: 'progress' });
  assert.deepEqual(nav('Read my previous answer.'), { type: 'readAnswer' });
});

test('jump to a question: numbers, words, ordinals and common mishearings', () => {
  for (const [t, n] of [
    ['question 3', 3], ['question three', 3], ['go to question 1', 1], ['jump to question two', 2],
    ['take me to question 3', 3], ['open question one', 1], ['back to question 2', 2], ['read question two', 2],
    ['go to question to', 2], ['question for', 4], ['number 3', 3], ['the second question', 2],
    ['go to the first question', 1], ['the final question', -1], ['skip to question 3', 3],
  ]) {
    assert.deepEqual(nav(t), { type: 'goto', question: n }, t);
  }
});

test('progress phrasing', () => {
  for (const t of ['how many questions are left', 'how many questions remaining', 'questions remaining', 'where am I',
    'which question am I on', 'what question is this', 'how many have I answered', 'unanswered questions', 'my progress',
    'how many questions are there']) {
    assert.deepEqual(nav(t), { type: 'progress' }, t);
  }
});

test('read my own saved answer, optionally for a numbered question', () => {
  for (const t of ['read my answer', 'read my saved answer', 'what did I answer', 'what was my answer', 'repeat my answer',
    'tell me my answer', 'what is my answer']) {
    assert.deepEqual(nav(t), { type: 'readAnswer' }, t);
  }
  assert.deepEqual(nav('read my answer to question two'), { type: 'readAnswer', question: 2 });
  assert.deepEqual(nav('what was my answer for question 3'), { type: 'readAnswer', question: 3 });
});

test('not navigation: solution requests, judgement, negation, dictation-like and other commands', () => {
  for (const t of ['what is the answer', 'tell me the answer', 'is my answer correct', 'check my answer', 'is my answer right',
    "don't go to question 2", 'not question 3', 'next', 'previous question', 'the last question', 'question',
    'what is question 2 about the current', 'I want to answer question two', 'answer', 'change my answer', '']) {
    assert.equal(nav(t), null, t);
  }
});

test('solution requests that mention "answer" still reach the refusal path', () => {
  assert.equal(parseCommand('what is the answer').type, 'explore');
  assert.equal(parseCommand('check my answer').type, 'explore');
});

test('progress and saved-answer prompts', () => {
  assert.equal(
    prompts.progress(1, 3, [true, false, false]),
    'You are on question 2 of 3. 1 more question after this one. You have answered 1 of 3. Unanswered: questions 2 and 3.',
  );
  assert.equal(prompts.progress(2, 3, [true, true, true]), 'You are on question 3 of 3. This is the last question. You have answered 3 of 3. All questions have a saved answer.');
  assert.equal(prompts.savedAnswer(1, 'x^2 + 3x'), 'Your saved answer for question 2 is: x squared plus 3 x.');
  assert.equal(prompts.savedAnswer(0, undefined), 'You have not saved an answer for question 1 yet. Say answer to dictate one.');
  assert.equal(prompts.noSuchQuestion(5, 3), 'There is no question 5. The exam has 3 questions. Say a number from 1 to 3.');
});
