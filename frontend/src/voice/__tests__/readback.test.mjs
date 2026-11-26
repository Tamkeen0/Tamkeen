import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readBackText } from '../readback.ts';
import { parseCommand } from '../parser.ts';
import { describeDiagram } from '../diagram.ts';

// Real Chrome dictation results from the manual test on 2026-11-26.
const CHROME_SAMPLES = [
  {
    recognized: 'The derivative of X ^2 + 3 X is two X + 3.',
    readBack: 'The derivative of X squared plus 3 X is two X plus 3.',
  },
  {
    recognized: 'The integral from zero to 1 of X ^2 with respect to X.',
    readBack: 'The integral from zero to 1 of X squared with respect to X.',
  },
  {
    recognized: "Newton's second law states that force equals mass multiplied by acceleration.",
    readBack: "Newton's second law states that force equals mass multiplied by acceleration.",
  },
  {
    // "R one" misheard as "or 1": read-back must keep it audible so the student can fix it.
    recognized: 'The current through resistor or 1 = 5 volts divided by 1K ohm.',
    readBack: 'The current through resistor or 1 equals 5 volts divided by 1 kilo ohm.',
  },
  {
    recognized: 'Queue next equals D on the rising edge of the clock.',
    readBack: 'Queue next equals D on the rising edge of the clock.',
  },
  {
    recognized: 'The summation from I equals one to N of X sub I squared.',
    readBack: 'The summation from I equals one to N of X sub I squared.',
  },
];

test('Chrome dictation samples read back as expected', () => {
  for (const { recognized, readBack } of CHROME_SAMPLES) assert.equal(readBackText(recognized), readBack);
});

test('read-back never alters the stored literal answer', () => {
  for (const { recognized } of CHROME_SAMPLES) {
    const stored = recognized;
    readBackText(stored);
    assert.equal(stored, recognized);
  }
});

test('minus: subtraction after an operand', () => {
  assert.equal(readBackText('x - 5'), 'x minus 5');
  assert.equal(readBackText('x-5'), 'x minus 5');
  assert.equal(readBackText('n−1'), 'n minus 1'); // U+2212 minus sign
  assert.equal(readBackText('two - three'), 'two minus three');
  assert.equal(readBackText('(x + 1) - 2'), 'open bracket x plus 1 close bracket minus 2');
  assert.equal(readBackText('R1 - R2'), 'R1 minus R2');
  assert.equal(readBackText('x² − 3x'), 'x squared minus 3 x');
});

test('minus: negative numbers and unary minus', () => {
  assert.equal(readBackText('-5'), 'negative 5');
  assert.equal(readBackText('x = -5'), 'x equals negative 5');
  assert.equal(readBackText('x=-5'), 'x equals negative 5');
  assert.equal(readBackText('5 - -3'), '5 minus negative 3');
  assert.equal(readBackText('(-2)^2'), 'open bracket negative 2 close bracket squared');
  assert.equal(readBackText('the answer is -4'), 'the answer is negative 4');
  assert.equal(readBackText('x ≥ -1'), 'x greater than or equal to negative 1');
  assert.equal(readBackText('-x^2 + 3'), 'negative x squared plus 3');
  assert.equal(readBackText('e^-x'), 'e to the power of negative x');
  assert.equal(readBackText('10^-3'), '10 to the power of negative 3');
  assert.equal(readBackText('x⁻¹'), 'x to the power of negative 1');
  assert.equal(readBackText('the temperature fell to -5 °C'), 'the temperature fell to negative 5 degrees C');
});

test('hyphens inside words and dashes are kept', () => {
  assert.equal(readBackText('the x-axis'), 'the x-axis');
  assert.equal(readBackText('twenty-one'), 'twenty-one');
  assert.equal(readBackText('a second-order system'), 'a second-order system');
  assert.equal(readBackText('first - then second'), 'first - then second');
});

test('plus, powers, roots and relations', () => {
  assert.equal(readBackText('+5'), 'positive 5');
  assert.equal(readBackText('x^3'), 'x cubed');
  assert.equal(readBackText('x**2'), 'x squared');
  assert.equal(readBackText('x^10'), 'x to the power of 10');
  assert.equal(readBackText('x^23'), 'x to the power of 23');
  assert.equal(readBackText('x⁴'), 'x to the power of 4');
  assert.equal(readBackText('√2'), 'square root of 2');
  assert.equal(readBackText('±3'), 'plus or minus 3');
  assert.equal(readBackText('x != 0'), 'x not equal to 0');
  assert.equal(readBackText('a <= b'), 'a less than or equal to b');
  assert.equal(readBackText('2 × 3'), '2 times 3');
  assert.equal(readBackText('2 * 3'), '2 times 3');
});

test('prime, factorial, slash, subscripts and Greek letters are contextual', () => {
  assert.equal(readBackText("f'(x)"), 'f prime open bracket x close bracket');
  assert.equal(readBackText("f''(x)"), 'f prime prime open bracket x close bracket');
  assert.equal(readBackText("don't"), "don't");
  assert.equal(readBackText('5!'), '5 factorial');
  assert.equal(readBackText('Done!'), 'Done!');
  assert.equal(readBackText('1/2'), '1 divided by 2');
  assert.equal(readBackText('and/or'), 'and slash or');
  assert.equal(readBackText('and / or'), 'and slash or');
  assert.equal(readBackText('a / b'), 'a divided by b');
  assert.equal(readBackText('A/B'), 'A divided by B');
  assert.equal(readBackText('x / 2'), 'x divided by 2');
  assert.equal(readBackText('one / two'), 'one divided by two');
  assert.equal(readBackText('(a + b) / c'), 'open bracket a plus b close bracket divided by c');
  assert.equal(readBackText('x_i'), 'x sub i');
  assert.equal(readBackText('x₁'), 'x sub 1');
  assert.equal(readBackText('2π r'), '2 pi r');
  assert.equal(readBackText('10 Ω'), '10 ohms');
  assert.equal(readBackText('50%'), '50 percent');
});

test('function names are read as functions only in a math context', () => {
  assert.equal(readBackText('sqrt(x)'), 'square root of x');
  assert.equal(readBackText('sqrt(2)'), 'square root of 2');
  assert.equal(readBackText('sqrt (x)'), 'square root of x');
  assert.equal(readBackText('SQRT(x)'), 'square root of x');
  assert.equal(readBackText('sqrt(x + 1)'), 'square root of open bracket x plus 1 close bracket');
  assert.equal(readBackText('sqrt 2'), 'square root of 2');
  assert.equal(readBackText('2 sqrt(x) - 1'), '2 square root of x minus 1');
  assert.equal(readBackText('sqrt(x)^2'), 'square root of x squared');
  assert.equal(readBackText('-sqrt(x)'), 'negative square root of x');
  assert.equal(readBackText('cbrt(8)'), 'cube root of 8');
  assert.equal(readBackText('sin(x)'), 'sine of x');
  assert.equal(readBackText('sin x + cos x'), 'sine of x plus cosine of x');
  assert.equal(readBackText('ln(x)'), 'natural log of x');
  assert.equal(readBackText('log(x^2)'), 'log of open bracket x squared close bracket');
  assert.equal(readBackText('sin(θ)'), 'sine of theta');
  // ordinary English words are left alone
  assert.equal(readBackText('log in to the system'), 'log in to the system');
  assert.equal(readBackText('a tan coat'), 'a tan coat');
});

test('units after a number are read as units', () => {
  assert.equal(readBackText('V_out = 5V'), 'V sub out equals 5 volts');
  assert.equal(readBackText('V_out = 5 V'), 'V sub out equals 5 volts');
  assert.equal(readBackText('1 V'), '1 volt');
  assert.equal(readBackText('12 V, positive at A'), '12 volts, positive at A');
  assert.equal(readBackText('10mA'), '10 milliamps');
  assert.equal(readBackText('2A'), '2 amps');
  assert.equal(readBackText('2.2kΩ'), '2.2 kilo ohms');
  assert.equal(readBackText('4 Ω'), '4 ohms');
  assert.equal(readBackText('10 Ω'), '10 ohms'); // U+2126 ohm sign
  assert.equal(readBackText('1K ohm'), '1 kilo ohm');
  assert.equal(readBackText('4.7 µF'), '4.7 microfarads');
  assert.equal(readBackText('4.7 μF'), '4.7 microfarads'); // Greek mu
  assert.equal(readBackText('50 Hz'), '50 hertz');
  assert.equal(readBackText('100 ms'), '100 milliseconds');
  assert.equal(readBackText('P = 3 W'), 'P equals 3 watts');
});

test('compound units after a number read as "per"', () => {
  assert.equal(readBackText('9.81 m/s²'), '9.81 meters per second squared');
  assert.equal(readBackText('9.81 m/s^2'), '9.81 meters per second squared');
  assert.equal(readBackText('g = 9.81 m/s²'), 'g equals 9.81 meters per second squared');
  assert.equal(readBackText('3 m/s'), '3 meters per second');
  assert.equal(readBackText('1 m/s'), '1 meter per second');
  assert.equal(readBackText('100 km/h'), '100 kilometers per hour');
  assert.equal(readBackText('5 N/m²'), '5 newtons per meter squared');
  assert.equal(readBackText('10 rad/s'), '10 radians per second');
  assert.equal(readBackText('2 V/m'), '2 volts per meter');
  assert.equal(readBackText('9.81m/s²'), '9.81 meters per second squared');
});

test('m, s, h on their own or without a number stay as typed', () => {
  assert.equal(readBackText('3 m'), '3 m');
  assert.equal(readBackText('v = d/t'), 'v equals d divided by t');
  assert.equal(readBackText('x/s'), 'x divided by s');
  assert.equal(readBackText('a = 2 m/s1'), 'a equals 2 m divided by s1');
});

test('units are not guessed where a letter may be a variable or option', () => {
  assert.equal(readBackText('2 A'), '2 A'); // could be option A or a variable
  assert.equal(readBackText('3 F'), '3 F');
  assert.equal(readBackText('3 V1'), '3 V1'); // component id
  assert.equal(readBackText('5V1'), '5 V1');
  assert.equal(readBackText('V = I R'), 'V equals I R'); // V as a variable, not after a number
  assert.equal(readBackText('3x'), '3 x');
});

test('numbers glued to letters are spaced, ordinals and decimals are kept', () => {
  assert.equal(readBackText('3X'), '3 X');
  assert.equal(readBackText('the 2nd term'), 'the 2nd term');
  assert.equal(readBackText('3.5 V'), '3.5 volts');
  assert.equal(readBackText('3.5 kg'), '3.5 kg');
});

test('empty and plain input', () => {
  assert.equal(readBackText(''), '');
  assert.equal(readBackText(undefined), '');
  assert.equal(readBackText('  hello   world  '), 'hello world');
});

test('Chrome dictation samples are never parsed as state-changing commands', () => {
  for (const { recognized } of CHROME_SAMPLES) {
    const { type } = parseCommand(recognized);
    assert.ok(type === 'unknown' || type === 'explore', `${recognized} -> ${type}`);
  }
});

test('misheard "or 1" and "queue" resolve in diagram exploration only when the id exists', () => {
  const exam = JSON.parse(readFileSync(new URL('../../../../fixtures/demo_exam.json', import.meta.url), 'utf8'));
  const diagram = exam.questions.find((q) => q.type === 'diagram').diagram;
  assert.ok(describeDiagram(diagram, 'what is or 1', 'en').startsWith('R1 is a resistor'));
  assert.ok(describeDiagram(diagram, 'resistor or 1', 'en').startsWith('R1 is a resistor'));
  assert.ok(describeDiagram(diagram, 'R1 or R2', 'en').includes('R2 is a resistor'));
  const logic = { description: 'Flip-flop.', nodes: ['D', 'CLK'], components: [{ id: 'Q1', kind: 'flip-flop', value: 'D type, rising edge', terminals: ['D', 'CLK'] }] };
  assert.ok(describeDiagram(logic, 'queue 1', 'en').startsWith('Q1 is a flip-flop'));
  // still refused when the question asks for a solution
  assert.match(describeDiagram(diagram, 'the current through resistor or 1', 'en'), /^I can only describe/);
});
