import type { Component } from '../../../../contracts/types';
import type { LanguagePack } from './types';

function join(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function short(c: Component): string {
  return `${c.id} (${c.kind}, ${c.value})`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export const en: LanguagePack = {
  commands: {
    next: ['next', 'next question', 'forward', 'skip'],
    previous: ['previous', 'previous question', 'back', 'prior question'],
    repeat: ['repeat', 'repeat question', 'repeat that', 'again', 'say again', 'say that again', 'read again', 'read question', 'read it again'],
    dictate: ['dictate', 'dictation', 'start dictation', 'answer', 'start answer', 'record answer', 'write answer', 'answer question'],
    confirm: ['confirm', 'confirm answer', 'save', 'save answer', 'yes confirm'],
    cancel: ['cancel', 'cancel that', 'stop', 'no', 'never mind', 'abort'],
    submit: ['submit', 'submit exam', 'submit test', 'submit my exam', 'submit answers', 'submit my answers', 'hand in', 'hand in exam'],
  },
  fillers: ['please', 'ok', 'okay', 'um', 'uh', 'er', 'hmm', 'so', 'now', 'the', 'go', 'to', 'lets', 'can', 'you', 'could', 'just', 'then'],
  negations: ['not', 'no', 'dont', 'never', 'cant', 'wont', 'shouldnt', 'without'],
  commandKeywords: ['next', 'previous', 'back', 'forward', 'skip', 'repeat', 'again', 'dictate', 'dictation', 'answer', 'confirm', 'save', 'cancel', 'stop', 'submit', 'hand'],
  exploreStarters: ['explore', 'describe', 'tell', 'show', 'what', 'whats', 'which', 'where', 'how', 'list', 'is', 'are', 'does', 'do', 'circuit', 'diagram', 'node', 'nodes', 'component', 'components', 'between', 'value'],
  exploreStrip: ['explore'],

  numberWords: {
    zero: '0', one: '1', won: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  },
  letterAliases: {
    a: 'a', ay: 'a', eh: 'a', b: 'b', be: 'b', bee: 'b', c: 'c', see: 'c', sea: 'c', si: 'c', d: 'd', dee: 'd',
    e: 'e', f: 'f', ef: 'f', g: 'g', gee: 'g', l: 'l', el: 'l', ell: 'l', n: 'n', en: 'n', q: 'q', cue: 'q',
    // "or 1" and "queue" are real Chrome mishearings of "R one" and "Q" (manual test 2026-11-26).
    r: 'r', are: 'r', ar: 'r', our: 'r', or: 'r', queue: 'q', s: 's', es: 's', ess: 's', u: 'u', v: 'v', vee: 'v', vi: 'v',
    w: 'w', x: 'x', ex: 'x', y: 'y', z: 'z', zed: 'z', zee: 'z',
  },
  refusalWords: [
    'answer', 'answers', 'solve', 'solved', 'solving', 'solution', 'solutions', 'calculate', 'calculation',
    'calculations', 'compute', 'computing', 'current', 'currents', 'amp', 'amps', 'ampere', 'amperes', 'amperage',
    'power', 'watt', 'watts', 'equivalent', 'series', 'parallel', 'hint', 'hints', 'clue', 'clues', 'formula',
    'formulas', 'equation', 'equations', 'kirchhoff', 'kirchhoffs', 'kvl', 'kcl', 'law', 'rule', 'drop', 'across',
    'potential', 'divider', 'mesh', 'nodal', 'thevenin', 'norton', 'superposition', 'explain', 'why', 'simplify',
    'simplified', 'result', 'correct', 'wrong', 'verify', 'step', 'steps', 'method',
  ],
  refusalPhrases: ['how do', 'how to', 'how can', 'how should', 'should i', 'what should', 'total resistance', 'ohms law', 'ohm law'],
  helpWords: ['help', 'options', 'commands'],
  nodeWords: ['node', 'nodes'],
  componentWords: ['component', 'components', 'part', 'parts', 'element', 'elements', 'items'],
  overviewWords: ['diagram', 'circuit', 'overview', 'describe', 'description', 'everything', 'all', 'summary', 'picture', 'figure', 'image', 'explore'],
  stopWords: [
    'what', 'whats', 'which', 'where', 'is', 'are', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'this',
    'that', 'these', 'those', 'there', 'me', 'tell', 'about', 'show', 'give', 'list', 'does', 'do', 'it', 'its',
    'have', 'has', 'how', 'many', 'much', 'value', 'values', 'kind', 'type', 'connected', 'connect', 'connects',
    'connection', 'connections', 'attached', 'with', 'please', 'can', 'you', 'i', 'and', 'or', 'each', 'every',
    'number', 'count', 'read', 'say', 'okay', 'ok', 'um', 'uh', 'so', 'now', 'again', 'here', 'whole', 'entire',
  ],
  betweenWords: ['between'],
  andWords: ['and', 'to'],
  kindNames: {},

  responses: {
    noDiagram: 'There is no diagram for this question.',
    refusal:
      "I can only describe what the diagram shows: its components, their values, and the nodes they connect. I can't solve, calculate, or give hints.",
    help: (ex) =>
      `You can ask about a component, such as "${ex.component}", a node, such as "node ${ex.node}", "between node ${ex.node} and node ${ex.otherNode}", "list components", or "list nodes". I only describe what is shown; I can't solve, calculate, or give hints.`,
    unknown: (ex) =>
      `I couldn't find that in this diagram. Try a component, such as ${ex.component}, a node, such as node ${ex.node}, or say "list components".`,
    componentNotFound: (label, cs) => `There is no ${label} in this diagram. Components are ${join(cs.map((c) => c.id))}.`,
    nodeNotFound: (label, nodes) => `There is no node ${label} in this diagram. Nodes are ${join(nodes)}.`,
    component: (c) =>
      `${c.id} is ${article(c.kind)} ${c.kind} with value ${c.value}, connected between node ${c.terminals[0]} and node ${c.terminals[1]}.`,
    node: (n, cs) =>
      cs.length
        ? `Node ${n} is connected to ${join(cs.map(short))}.`
        : `No components are connected to node ${n} in this diagram.`,
    between: (a, b, cs) =>
      cs.length
        ? `Between node ${a} and node ${b}: ${join(cs.map(short))}.`
        : `No component is connected directly between node ${a} and node ${b}.`,
    nodeList: (nodes) => `The diagram has ${nodes.length} ${plural(nodes.length, 'node')}: ${join(nodes)}.`,
    componentList: (cs) =>
      `The diagram has ${cs.length} ${plural(cs.length, 'component')}: ${join(cs.map((c) => `${c.id} (${c.kind})`))}.`,
    kindList: (kind, cs) =>
      `There ${cs.length === 1 ? 'is' : 'are'} ${cs.length} ${plural(cs.length, kind)}. ${cs.map((c) => en.responses.component(c)).join(' ')}`,
    overview: (d, nodes, cs) =>
      `${sentence(d.description)} ${en.responses.nodeList(nodes)} ${en.responses.componentList(cs)}${
        cs.length && nodes.length ? ` Ask about a component, such as ${cs[0].id}, or a node, such as node ${nodes[0]}.` : ''
      }`,
  },

  errors: {
    recognitionUnsupported: 'Speech recognition is not available in this browser. Use the keyboard instead.',
    speechUnsupported: 'Text-to-speech is not available in this browser. Use a screen reader or the keyboard instead.',
    permissionDenied: 'Microphone permission was denied. Allow the microphone in the browser, or use the keyboard.',
    speechBlocked: 'The browser blocked speech. Press a key or click the page, then try again.',
    noSpeech: 'No speech was recognised. Please try again.',
    timeout: 'Listening timed out with no speech.',
    cancelled: 'Listening was cancelled.',
    audioCapture: 'No microphone was found or it could not be opened.',
    network: 'The speech service could not be reached. Check the connection or use the keyboard.',
    busy: 'Already listening.',
    languageUnavailable: 'No voice for the selected language is installed in this browser.',
    startFailed: 'The microphone could not be started.',
    speechFailed: 'Text-to-speech failed.',
    unknown: 'An unexpected speech error occurred.',
  },
};
