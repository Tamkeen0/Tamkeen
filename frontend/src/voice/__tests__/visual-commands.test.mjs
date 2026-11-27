// Exploration command parsing, English and Arabic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExploreAction } from '../visual/commands.ts';
import { parseNavigation } from '../navigation.ts';
import { parseEditCommand } from '../editing.ts';
import { createDiagramExplorer } from '../diagram.ts';
import { ar } from '../lang/ar.ts';

const p = (t) => parseExploreAction(t);
const type = (t) => p(t)?.type ?? null;

test('English: the requested commands', () => {
  for (const [t, ty] of [
    ['Walk me through this diagram.', 'tourStart'], ['Start the tour.', 'tourStart'], ['Next part.', 'tourNext'],
    ['Previous part.', 'tourPrev'], ['Repeat this part.', 'tourRepeat'], ['Where am I?', 'where'],
    ['Go back to the beginning.', 'tourRestart'], ['Stop the tour.', 'tourStop'],
    ['What is connected here?', 'whatHere'], ['What happens next?', 'whatNext'], ['What else is here?', 'elseHere'],
    ['Where did I come from?', 'cameFrom'], ['step back', 'stepBack'], ['go back a step', 'stepBack'],
    ['Describe briefly.', 'brief'], ['Give me more detail.', 'detailed'], ['Back to brief mode.', 'brief'],
  ]) {
    assert.equal(type(t), ty, t);
  }
  assert.deepEqual(p('Start at node A.'), { type: 'goTo', ref: 'node a' });
  assert.deepEqual(p('Follow R1.'), { type: 'follow', ref: 'r1' });
  assert.deepEqual(p('take the no branch'), { type: 'follow', ref: 'the no branch' });
  assert.deepEqual(p('follow it'), { type: 'follow', ref: null });
});

test('Arabic: the same commands', () => {
  for (const [t, ty] of [
    ['ابدأ الجولة', 'tourStart'], ['الجزء التالي', 'tourNext'], ['الجزء السابق', 'tourPrev'], ['أعد هذا الجزء', 'tourRepeat'],
    ['أين أنا', 'where'], ['ارجع إلى البداية', 'tourRestart'], ['أوقف الجولة', 'tourStop'], ['ما المتصل هنا', 'whatHere'],
    ['ماذا يحدث بعد ذلك', 'whatNext'], ['ماذا يوجد أيضا هنا', 'elseHere'], ['من أين أتيت', 'cameFrom'], ['ارجع خطوة', 'stepBack'],
    ['باختصار', 'brief'], ['مزيد من التفاصيل', 'detailed'],
  ]) {
    assert.equal(type(t), ty, t);
  }
  assert.equal(p('ابدأ من العقدة ب')?.type, 'goTo');
  assert.equal(p('اتبع R1')?.type, 'follow');
});

test('not exploration: bare navigation, negation, solution requests, dictation-like text, edits', () => {
  for (const t of ['next', 'go back', 'previous', 'repeat', 'go to question 2', 'go to the next question', "don't start the tour",
    'do not follow R1', 'follow the current through R1', 'solve this circuit', 'give me a hint', 'the answer is 2 amps',
    'start over', 'clear my answer', 'answer', 'لا تبدأ الجولة', '']) {
    assert.equal(p(t), null, t);
  }
});

test('exploration phrases do not collide with exam navigation or editing', () => {
  for (const t of ['next part', 'previous part', 'step back', 'go back a step', 'repeat this part', 'go back to the beginning', 'start the tour', 'what happens next']) {
    assert.equal(parseNavigation(t), null, `navigation: ${t}`);
    assert.equal(parseEditCommand(t), null, `edit: ${t}`);
  }
});

test('Arabic circuit exploration end to end through the explorer', () => {
  const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
  const ex = createDiagramExplorer(exam.questions[2].diagram);
  assert.match(ex.ask('ابدأ الجولة'), /الجزء 1 من 3\. V1، مصدر جهد/);
  assert.match(ex.ask('الجزء التالي'), /^الجزء 2 من 3\. R1، مقاومة، 2 ohms\. يصل بين العقدة A والعقدة B\.$/);
  assert.equal(ex.ask('ابدأ من العقدة ب'), 'العقدة B. موصولة بـ R1 وR2.');
  assert.equal(ex.ask('اتبع R2'), 'بالمتابعة عبر R2. العقدة C. موصولة بـ V1 وR2.');
  assert.equal(ex.ask('من أين أتيت'), 'أتيت من العقدة B عبر R2.');
  assert.equal(ex.ask('اتبع التيار في R1'), ar.responses.refusal, 'Arabic solution request refused');
});
