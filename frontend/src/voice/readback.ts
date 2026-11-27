// Read-back text for verifying a dictated answer by ear.
//
// readBackText() returns a NEW string for speak() only. The stored answer
// must stay the literal transcript; never save this output.
//
// Symbols are verbalised by context, not blindly replaced:
//   minus  "x - 5", "n−1", "two - three"      -> "minus"     (after an operand)
//          "-5", "x = -5", "(-2)", "e^-x"     -> "negative"  (unary: start, after operator/bracket/word)
//          "x-axis", "twenty-one"             -> kept        (hyphen inside a word)
//   plus   "x + 1" -> "plus";  "+5" -> "positive 5"
//   power  "x^2" -> "x squared", "x^3" -> "x cubed", "x^10" -> "x to the power of 10"
//   prime  "f'(x)" -> "f prime …" but "Newton's" is kept
//   bang   "5!" -> "5 factorial" but "Done!" is kept
//   slash  "1/2" -> "1 divided by 2" but "and/or" -> "and slash or"
// Unknown characters pass through unchanged. English only (demo language).

type Tok = { t: 'num' | 'word' | 'space' | 'sym'; s: string };

const LEX = /(\d+(?:\.\d+)?)|(\p{L}[\p{L}\p{M}]*)|(\s+)|([\s\S])/gu;

const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'half', 'pi',
  'infinity',
]);

const ORDINAL_SUFFIX = /^(st|nd|rd|th)$/i;

const GREEK: Record<string, string> = {
  π: 'pi', θ: 'theta', α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'delta', λ: 'lambda', μ: 'mu',
  µ: 'micro', σ: 'sigma', Σ: 'sigma', ω: 'omega', Ω: 'ohms', φ: 'phi', ε: 'epsilon', ρ: 'rho', τ: 'tau',
  η: 'eta', ψ: 'psi', χ: 'chi', ξ: 'xi', ν: 'nu', κ: 'kappa', ζ: 'zeta',
};

// Written function names -> spoken form. Applied only when followed by "(" or a
// simple argument ("sin x"), so English words like "log in" or "tan coat" are kept.
// "sqrt" and "cbrt" are never English, so they always convert.
const FUNCTIONS: Record<string, string> = {
  sqrt: 'square root of',
  cbrt: 'cube root of',
  sin: 'sine of',
  cos: 'cosine of',
  tan: 'tangent of',
  sec: 'secant of',
  csc: 'cosecant of',
  cot: 'cotangent of',
  arcsin: 'arc sine of',
  arccos: 'arc cosine of',
  arctan: 'arc tangent of',
  asin: 'arc sine of',
  acos: 'arc cosine of',
  atan: 'arc tangent of',
  sinh: 'hyperbolic sine of',
  cosh: 'hyperbolic cosine of',
  tanh: 'hyperbolic tangent of',
  ln: 'natural log of',
  log: 'log of',
  exp: 'exponential of',
  abs: 'absolute value of',
};
const ALWAYS_FUNCTION = new Set(['sqrt', 'cbrt']);

// Units read only directly after a number. [singular, plural, allowedAfterSpace]
// Single letters that are often variables (A, F, H) expand only when glued: "2A" yes, "2 A" no.
const UNITS: Record<string, [string, string, boolean]> = {
  V: ['volt', 'volts', true], mV: ['millivolt', 'millivolts', true], kV: ['kilovolt', 'kilovolts', true],
  µV: ['microvolt', 'microvolts', true], uV: ['microvolt', 'microvolts', false],
  A: ['amp', 'amps', false], mA: ['milliamp', 'milliamps', true], µA: ['microamp', 'microamps', true],
  uA: ['microamp', 'microamps', false], kA: ['kiloamp', 'kiloamps', true],
  Ω: ['ohm', 'ohms', true], kΩ: ['kilo ohm', 'kilo ohms', true], MΩ: ['mega ohm', 'mega ohms', true],
  mΩ: ['milliohm', 'milliohms', true],
  W: ['watt', 'watts', true], mW: ['milliwatt', 'milliwatts', true], kW: ['kilowatt', 'kilowatts', true],
  MW: ['megawatt', 'megawatts', true],
  Hz: ['hertz', 'hertz', true], kHz: ['kilohertz', 'kilohertz', true], MHz: ['megahertz', 'megahertz', true],
  GHz: ['gigahertz', 'gigahertz', true],
  F: ['farad', 'farads', false], mF: ['millifarad', 'millifarads', true], µF: ['microfarad', 'microfarads', true],
  uF: ['microfarad', 'microfarads', true], nF: ['nanofarad', 'nanofarads', true], pF: ['picofarad', 'picofarads', true],
  H: ['henry', 'henries', false], mH: ['millihenry', 'millihenries', true], µH: ['microhenry', 'microhenries', true],
  uH: ['microhenry', 'microhenries', true],
  ms: ['millisecond', 'milliseconds', true], µs: ['microsecond', 'microseconds', true],
  ns: ['nanosecond', 'nanoseconds', true], dB: ['decibel', 'decibels', true],
};
// Extra units recognised only inside a compound "number unit/unit" ("9.81 m/s²", "100 km/h"),
// where m, s, h, g are unambiguous. On their own they stay as typed (could be variables).
const COMPOUND_ONLY_UNITS: Record<string, [string, string]> = {
  m: ['meter', 'meters'], cm: ['centimeter', 'centimeters'], mm: ['millimeter', 'millimeters'],
  km: ['kilometer', 'kilometers'], s: ['second', 'seconds'], min: ['minute', 'minutes'], h: ['hour', 'hours'],
  g: ['gram', 'grams'], kg: ['kilogram', 'kilograms'], N: ['newton', 'newtons'], J: ['joule', 'joules'],
  rad: ['radian', 'radians'], mol: ['mole', 'moles'], K: ['kelvin', 'kelvin'], C: ['coulomb', 'coulombs'],
};
function compoundUnit(s: string): [string, string] | undefined {
  const k = unitKey(s);
  const u = UNITS[k];
  return u ? [u[0], u[1]] : COMPOUND_ONLY_UNITS[k];
}

// "1K ohm", "2.2k Ω": a glued k/M prefix followed by an ohm word.
const OHM_PREFIX: Record<string, string> = { k: 'kilo', K: 'kilo', M: 'mega' };
const OHM_WORDS = new Set(['ohm', 'ohms', 'Ohm', 'Ohms', 'Ω']);
// Fold the Greek mu (U+03BC) to the micro sign and the ohm sign (U+2126) to Greek omega.
const unitKey = (s: string) => s.replace(/μ/g, 'µ').replace(/Ω/g, 'Ω');

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+',
};
const SUBSCRIPT: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

const MINUS = new Set(['-', '−', '–']);

/** symbol -> [spoken words, does it end an operand?] */
const SYMBOLS: Record<string, [string, boolean]> = {
  '=': ['equals', false],
  '≠': ['not equal to', false],
  '<': ['less than', false],
  '>': ['greater than', false],
  '≤': ['less than or equal to', false],
  '≥': ['greater than or equal to', false],
  '≈': ['approximately equal to', false],
  '≡': ['is equivalent to', false],
  '∝': ['is proportional to', false],
  '±': ['plus or minus', false],
  '∓': ['minus or plus', false],
  '*': ['times', false],
  '×': ['times', false],
  '·': ['times', false],
  '⋅': ['times', false],
  '∙': ['times', false],
  '÷': ['divided by', false],
  '√': ['square root of', false],
  '∛': ['cube root of', false],
  '∫': ['integral', false],
  '∑': ['summation', false],
  '∏': ['product', false],
  '∂': ['partial', false],
  '∆': ['delta', true],
  '∇': ['nabla', false],
  '∞': ['infinity', true],
  '→': ['approaches', false],
  '⇒': ['implies', false],
  '°': ['degrees', true],
  '%': ['percent', true],
  '&': ['and', false],
  '|': ['bar', false],
  _: ['sub', false],
  '(': ['open bracket', false],
  ')': ['close bracket', true],
  '[': ['open square bracket', false],
  ']': ['close square bracket', true],
  '{': ['open brace', false],
  '}': ['close brace', true],
  '′': ['prime', true],
  '″': ['double prime', true],
};

const TWO_CHAR: Record<string, [string, boolean]> = {
  '<=': ['less than or equal to', false],
  '>=': ['greater than or equal to', false],
  '!=': ['not equal to', false],
  '==': ['equals', false],
  '->': ['approaches', false],
  '=>': ['implies', false],
  '+-': ['plus or minus', false],
};

const OPERAND_START_SYMS = new Set(['(', '[', '√', '∛', '∞', '∆', '∑', '∫']);

function lex(text: string): Tok[] {
  const toks: Tok[] = [];
  for (const m of text.matchAll(LEX)) {
    if (m[1] !== undefined) toks.push({ t: 'num', s: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'word', s: m[2] });
    else if (m[3] !== undefined) toks.push({ t: 'space', s: m[3] });
    else toks.push({ t: 'sym', s: m[4] });
  }
  return toks;
}

const isSingleLetter = (w: string) => /^\p{L}$/u.test(w);
const isWordOperand = (w: string) => isSingleLetter(w) || NUMBER_WORDS.has(w.toLowerCase()) || w in GREEK;

function startsOperand(tok: Tok | undefined): boolean {
  if (!tok) return false;
  if (tok.t === 'num') return true;
  if (tok.t === 'word') return isWordOperand(tok.s) || tok.s.toLowerCase() in FUNCTIONS;
  return tok.t === 'sym' && OPERAND_START_SYMS.has(tok.s);
}

function powerWords(exponent: string): string {
  if (exponent === '2') return 'squared';
  if (exponent === '3') return 'cubed';
  return `to the power of ${exponent.replace(/^-/, 'negative ').replace(/^\+/, 'positive ')}`;
}

/** Spoken form of a literal answer, for read-back only. */
export function readBackText(text: string): string {
  const toks = lex(String(text ?? ''));
  const out: string[] = [];
  let prevOperand = false; // last significant token ended an operand (number, variable, ")", …)
  let prevWord: string | null = null; // last significant token, if it was a word
  let prevPrime = false;

  const say = (words: string, operand: boolean) => {
    out.push(` ${words} `);
    prevOperand = operand;
    prevWord = null;
    prevPrime = false;
  };
  const keep = (s: string, operand: boolean, word: string | null = null) => {
    out.push(s);
    prevOperand = operand;
    prevWord = word;
    prevPrime = false;
  };
  const nextSignificant = (i: number): Tok | undefined => {
    let j = i + 1;
    while (j < toks.length && toks[j].t === 'space') j++;
    return toks[j];
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t === 'space') {
      out.push(tok.s);
      continue;
    }
    if (tok.t === 'num') {
      out.push(tok.s);
      const singular = tok.s === '1';
      const glued = toks[i + 1];
      const spaced = glued?.t === 'space' && glued.s === ' ' ? toks[i + 2] : undefined;
      // A unit must be a whole token: "3 V1" is an identifier, not volts.
      const isWholeWord = (k: number) => toks[k]?.t === 'word' && !(toks[k + 1] && (toks[k + 1].t === 'num' || toks[k + 1].t === 'word'));

      // "9.81 m/s²", "100 km/h", "5 N/m^2" -> "9.81 meters per second squared"
      {
        let k = i + 1;
        if (toks[k]?.t === 'space' && toks[k].s === ' ') k++;
        const top = toks[k]?.t === 'word' ? compoundUnit(toks[k].s) : undefined;
        const bottom = toks[k + 2]?.t === 'word' ? compoundUnit(toks[k + 2].s) : undefined;
        if (top && bottom && toks[k + 1]?.t === 'sym' && toks[k + 1].s === '/') {
          let end = k + 2;
          let power = '';
          const nx = toks[end + 1];
          if (nx?.t === 'sym' && (nx.s === '²' || nx.s === '³')) {
            power = nx.s === '²' ? ' squared' : ' cubed';
            end += 1;
          } else if (nx?.t === 'sym' && nx.s === '^' && toks[end + 2]?.t === 'num' && /^[23]$/.test(toks[end + 2].s)) {
            power = toks[end + 2].s === '2' ? ' squared' : ' cubed';
            end += 2;
          }
          // Stop if the unit continues as an identifier ("3 m/s1").
          const after = toks[end + 1];
          if (!(after && (after.t === 'num' || after.t === 'word'))) {
            say(`${singular ? top[0] : top[1]} per ${bottom[0]}${power}`, true);
            i = end;
            continue;
          }
        }
      }

      // "1K ohm", "2.2k Ω" -> "1 kilo ohm"
      if (glued?.t === 'word' && glued.s in OHM_PREFIX && toks[i + 2]?.t === 'space' && OHM_WORDS.has(unitKey(toks[i + 3]?.s ?? ''))) {
        say(`${OHM_PREFIX[glued.s]} ${singular ? 'ohm' : 'ohms'}`, true);
        i += 3;
        continue;
      }
      const unitGlued = glued?.t === 'word' && isWholeWord(i + 1) ? UNITS[unitKey(glued.s)] : undefined;
      if (unitGlued) {
        say(singular ? unitGlued[0] : unitGlued[1], true);
        i += 1;
        continue;
      }
      const unitSpaced = spaced?.t === 'word' && isWholeWord(i + 2) ? UNITS[unitKey(spaced.s)] : undefined;
      if (unitSpaced && unitSpaced[2]) {
        say(singular ? unitSpaced[0] : unitSpaced[1], true);
        i += 2;
        continue;
      }

      const nx = toks[i + 1];
      // "3X" -> "3 X", "1K" -> "1 K", but keep ordinals like "2nd".
      if (nx && nx.t === 'word' && !ORDINAL_SUFFIX.test(nx.s)) out.push(' ');
      prevOperand = true;
      prevWord = null;
      prevPrime = false;
      continue;
    }
    if (tok.t === 'word') {
      const fn = FUNCTIONS[tok.s.toLowerCase()];
      if (fn) {
        let j = i + 1;
        while (j < toks.length && toks[j].t === 'space') j++;
        const arg = toks[j];
        const simpleArg = (t: Tok | undefined) =>
          !!t && (t.t === 'num' || (t.t === 'word' && isWordOperand(t.s) && !(t.s.toLowerCase() in FUNCTIONS)));
        // sqrt(x), sin(30): one-token argument -> drop the brackets.
        if (arg?.t === 'sym' && arg.s === '(' && simpleArg(toks[j + 1]) && toks[j + 2]?.t === 'sym' && toks[j + 2].s === ')') {
          say(`${fn} ${GREEK[toks[j + 1].s] ?? toks[j + 1].s}`, true);
          i = j + 2;
          continue;
        }
        // sqrt(x + 1): keep the brackets so the grouping is heard; sin x, sqrt 2: plain argument.
        if (ALWAYS_FUNCTION.has(tok.s.toLowerCase()) || (arg?.t === 'sym' && arg.s === '(') || simpleArg(arg)) {
          say(fn, false);
          continue;
        }
      }
      if (tok.s in GREEK) say(GREEK[tok.s], true);
      else keep(tok.s, isWordOperand(tok.s), tok.s);
      continue;
    }

    const c = tok.s;
    const before = toks[i - 1];
    const after = toks[i + 1];

    const two = after && after.t === 'sym' ? c + after.s : '';
    if (two && TWO_CHAR[two]) {
      say(...TWO_CHAR[two]);
      i++;
      continue;
    }

    if (c === '^' || two === '**') {
      if (two === '**') i++; // "x**2" is the same as "x^2"
      let j = i + 1;
      while (j < toks.length && toks[j].t === 'space') j++;
      const exp = toks[j];
      if (exp && exp.t === 'num' && (exp.s === '2' || exp.s === '3')) {
        say(powerWords(exp.s), true);
        i = j;
      } else {
        say('to the power of', false);
      }
      continue;
    }

    if (c in SUPERSCRIPT) {
      let digits = '';
      let k = i;
      while (k < toks.length && toks[k].t === 'sym' && toks[k].s in SUPERSCRIPT) digits += SUPERSCRIPT[toks[k++].s];
      say(powerWords(digits), true);
      i = k - 1;
      continue;
    }
    if (c in SUBSCRIPT) {
      let digits = '';
      let k = i;
      while (k < toks.length && toks[k].t === 'sym' && toks[k].s in SUBSCRIPT) digits += SUBSCRIPT[toks[k++].s];
      say(`sub ${digits}`, true);
      i = k - 1;
      continue;
    }

    if (MINUS.has(c)) {
      const compoundWord =
        before?.t === 'word' && after?.t === 'word' && (before.s.length > 1 || after.s.length > 1);
      if (compoundWord) keep(c, false); // "x-axis", "twenty-one", "second-order"
      else if (prevOperand) say('minus', false); // subtraction
      else if (startsOperand(nextSignificant(i))) say('negative', false); // negative number / unary minus
      else keep(c, false); // a dash used as punctuation
      continue;
    }

    if (c === '+') {
      if (prevOperand) say('plus', false);
      else if (startsOperand(nextSignificant(i))) say('positive', false);
      else say('plus', false);
      continue;
    }

    if (c === "'" || c === '’') {
      const nextIsLetter = after?.t === 'word';
      if (!nextIsLetter && (prevPrime || (prevWord !== null && isSingleLetter(prevWord)))) {
        say('prime', true);
        prevPrime = true;
      } else {
        keep(c, false); // apostrophe in "Newton's", "don't"
      }
      continue;
    }

    if (c === '!') {
      if (prevOperand && before?.t !== 'space') say('factorial', true);
      else keep(c, false);
      continue;
    }

    if (c === '/') {
      // Look past spaces: "and / or" is a slash between words; "a / b", "x / 2" are division.
      let p = i - 1;
      while (p >= 0 && toks[p].t === 'space') p--;
      const left = toks[p];
      const right = nextSignificant(i);
      const wordsBothSides =
        left?.t === 'word' && right?.t === 'word' && left.s.length > 1 && right.s.length > 1 &&
        !isWordOperand(left.s) && !isWordOperand(right.s);
      say(wordsBothSides ? 'slash' : 'divided by', false);
      continue;
    }

    const mapped = SYMBOLS[c];
    if (mapped) {
      say(...mapped);
      continue;
    }
    keep(c, false);
  }

  return out
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .trim();
}
