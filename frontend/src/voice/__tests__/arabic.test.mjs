import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand } from '../parser.ts';
import { describeDiagram } from '../diagram.ts';
import { ar } from '../lang/ar.ts';
import { setLanguage, getLanguage, languageTag } from '../language.ts';
import { speak, listenOnce, setSpeechEnvironment } from '../speech.ts';
import { VoiceError } from '../errors.ts';

const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
const diagram = exam.questions.find((q) => q.type === 'diagram').diagram;
const ask = (q) => describeDiagram(diagram, q, 'ar');
const type = (t) => parseCommand(t).type;

afterEach(() => {
  setLanguage('en');
  setSpeechEnvironment(null);
});

// ---------- language selection ----------

test('setLanguage switches tags and rejects unsupported languages', () => {
  setLanguage('ar');
  assert.equal(getLanguage(), 'ar');
  assert.equal(languageTag(), 'ar-SA');
  setLanguage('ar', 'ar-EG');
  assert.equal(languageTag(), 'ar-EG');
  setLanguage('en');
  assert.equal(languageTag(), 'en-US');
  assert.throws(() => setLanguage('fr'), RangeError);
});

// ---------- parser ----------

test('every listed Arabic phrase maps to its own command', () => {
  for (const [cmd, phrases] of Object.entries(ar.commands)) {
    for (const p of phrases) assert.equal(type(p), cmd, `"${p}"`);
  }
});

test('Arabic spelling variants, diacritics and polite fillers are tolerated', () => {
  assert.equal(type('التالي من فضلك'), 'next');
  assert.equal(type('السؤالُ التالي'), 'next');
  assert.equal(type('التالى'), 'next'); // alef maqsura
  assert.equal(type('اعد السؤال'), 'repeat'); // missing hamza
  assert.equal(type('إلغاء'), 'cancel');
  assert.equal(type('الغاء'), 'cancel');
  assert.equal(type('تأكيد.'), 'confirm');
  assert.equal(type('سلّم الامتحان'), 'submit');
});

test('Arabic negated or combined commands are unknown', () => {
  for (const t of ['لا تسلم', 'ما تسلم', 'لا تحفظ', 'مش التالي', 'التالي تسليم', 'تأكيد وتسليم', 'لن أسلم']) {
    const r = type(t);
    assert.notEqual(r, 'submit', t);
    assert.notEqual(r, 'confirm', t);
    assert.notEqual(r, 'next', t);
  }
  assert.equal(type('لا'), 'cancel');
});

test('Arabic explore requests', () => {
  assert.deepEqual(parseCommand('استكشف R2'), { type: 'explore', query: 'r2' });
  assert.equal(type('ما هي قيمة R1؟'), 'explore');
  assert.equal(type('العقدة B'), 'explore');
  assert.equal(type('R٢'), 'explore'); // Arabic-Indic digit
  assert.equal(type('بين العقدة A والعقدة B'), 'explore');
});

test('English commands still work while Arabic is active', () => {
  setLanguage('ar');
  assert.equal(type('next'), 'next');
  assert.equal(type('submit'), 'submit');
  assert.equal(type("don't submit"), 'unknown');
});

// ---------- diagram ----------

test('Arabic component lookup keeps verbatim values', () => {
  const r2 = ask('ما هي قيمة R2؟');
  for (const s of ['R2', 'مقاومة', '4 ohms', 'العقدة B', 'العقدة C']) assert.ok(r2.includes(s), r2);
  assert.ok(ask('V1').includes('12 V, positive at A, negative at C'));
  assert.ok(ask('V1').includes('مصدر جهد'));
});

test('Arabic spoken forms of component ids', () => {
  for (const q of ['المقاومة 2', 'مقاومة اثنين', 'ار ٢', 'R٢', 'آر 2']) {
    assert.ok(ask(q).startsWith('R2: مقاومة'), `${q} -> ${ask(q)}`);
  }
  assert.ok(ask('R9').startsWith('لا يوجد R9'));
});

test('Arabic node and between lookups', () => {
  const b = ask('العقدة ب');
  assert.ok(b.includes('العقدة B') && b.includes('R1') && b.includes('R2') && !b.includes('V1'), b);
  const a = ask('ما المتصل بالعقدة A؟');
  assert.ok(a.includes('V1') && a.includes('R1') && !a.includes('R2'), a);
  assert.ok(ask('العقدة أ').includes('العقدة A'));
  const bc = ask('بين العقدة B والعقدة C');
  assert.ok(bc.startsWith('بين العقدة B والعقدة C') && bc.includes('R2') && !bc.includes('R1'), bc);
  assert.ok(ask('العقدة Z').startsWith('لا توجد عقدة Z'));
});

test('Arabic lists, kinds, overview, help and unknown', () => {
  assert.ok(ask('العقد').startsWith('عدد العقد في المخطط: 3'));
  assert.ok(ask('ما هي المكونات').startsWith('عدد المكونات في المخطط: 3'));
  const res = ask('المقاومات');
  assert.ok(res.startsWith('عدد مقاومات: 2') && res.includes('R1') && res.includes('R2'), res);
  assert.ok(ask('صف الدائرة').startsWith(diagram.description));
  assert.ok(ask('مساعدة').startsWith('يمكنك أن تسأل'));
  assert.ok(ask('ما هو المكثف').startsWith('لم أجد ذلك'));
});

test('Arabic solution, hint and topology requests are refused', () => {
  const refusals = [
    'ما هو التيار في R2',
    'التيار',
    'حل السؤال',
    'أعطني تلميح',
    'ما الإجابة',
    'ما هو الجواب',
    'احسب الجهد على R2',
    'هل R1 و R2 على التوالي',
    'هل هما على التوازي',
    'ما المقاومة المكافئة',
    'ما المقاومة الكلية',
    'كيف أحل هذا',
    'ما هي القدرة',
    'اشرح الدائرة',
    'هل إجابتي صحيحة',
    'ما هو قانون أوم',
  ];
  for (const q of refusals) assert.equal(ask(q), ar.responses.refusal, q);
});

test('Arabic answers never contain computed facts', () => {
  const leaks = [/\b2\s?a\b/i, /\b8\s?v\b/i, /\b4\s?v\b/i, /\b6\s?ohm/i, /توالي|توازي/, /أمبير/];
  for (const q of ['R1', 'R2', 'V1', 'العقدة B', 'العقد', 'المكونات', '', 'مساعدة', 'التيار', 'بين العقدة A والعقدة C']) {
    const out = ask(q);
    for (const re of leaks) assert.doesNotMatch(out, re, `${q}: ${out}`);
  }
});

test('reply language: Arabic script forces Arabic; otherwise argument, then active language', () => {
  assert.ok(describeDiagram(diagram, 'R2', 'en').startsWith('R2 is a resistor'));
  assert.ok(describeDiagram(diagram, 'R2', 'ar').startsWith('R2: مقاومة'));
  assert.ok(describeDiagram(diagram, 'ما هو R2', 'en').startsWith('R2: مقاومة'));
  setLanguage('ar');
  assert.ok(describeDiagram(diagram, 'R2').startsWith('R2: مقاومة'));
  assert.equal(describeDiagram(null, 'R2'), ar.responses.noDiagram);
});

// ---------- speech in Arabic ----------

function fakeEnv(voices) {
  const spoken = [];
  const recs = [];
  setSpeechEnvironment({
    synthesis: {
      speak: (u) => spoken.push(u),
      cancel: () => {},
      getVoices: () => voices,
    },
    createUtterance: (text) => ({ text, lang: '', voice: null, onend: null, onerror: null }),
    createRecognition: () => {
      const r = { start() {}, abort() {}, onresult: null, onerror: null, onend: null };
      recs.push(r);
      return r;
    },
  });
  return { spoken, recs };
}

test('Arabic recognition and TTS use the Arabic tag and voice', async () => {
  setLanguage('ar');
  const { spoken, recs } = fakeEnv([{ lang: 'en-US', name: 'English' }, { lang: 'ar-SA', name: 'Arabic' }]);
  const p = speak('السؤال الأول.');
  assert.equal(spoken[0].lang, 'ar-SA');
  assert.equal(spoken[0].voice.name, 'Arabic');
  spoken[0].onend();
  await p;
  const l = listenOnce();
  assert.equal(recs[0].lang, 'ar-SA');
  recs[0].onresult({ results: [Object.assign([{ transcript: 'مشتقة x تربيع' }], { isFinal: true })] });
  assert.equal(await l, 'مشتقة x تربيع');
});

test('missing Arabic voice is reported with an Arabic message', async () => {
  setLanguage('ar');
  fakeEnv([{ lang: 'en-US', name: 'English' }]);
  await assert.rejects(speak('مرحبا'), (err) => {
    assert.ok(err instanceof VoiceError);
    assert.equal(err.code, 'language-unavailable');
    assert.match(err.message, /[؀-ۿ]/);
    return true;
  });
});
