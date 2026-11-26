// Developer-only manual test page for the voice module (see ../README.md).
// Circuits are synthetic (see ./circuits.ts); the default is fixture question q3.
import type { VoiceCommand } from '../../../../contracts/types';
import { TEST_CIRCUITS } from './circuits';
import type { TestCircuit } from './circuits';
import { buildDemoExam } from './demo-exam';
import { createMemorySession, ReferenceController } from './reference-controller';
import {
  createDiagramExplorer,
  isRecognitionSupported,
  isSpeechSupported,
  listenOnce,
  parseCommand,
  readBackText,
  setLanguage,
  speak,
  stopListening,
  stopSpeaking,
  VoiceError,
} from '../index';
import type { VoiceLanguage } from '../index';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log');

function write(line: string): void {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent ?? ''}`;
}

// One explorer per circuit (like one per question in the UI), so "it" /
// "the other resistor" never carry over when the circuit changes.
let circuit: TestCircuit = TEST_CIRCUITS[0];
let explorer = createDiagramExplorer(circuit.diagram);

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

function renderCircuit(): void {
  const rows = circuit.diagram.components
    .map((c) => `<tr><th scope="row">${esc(c.id)}</th><td>${esc(c.kind)}</td><td>${esc(c.value)}</td><td>${esc(c.terminals.join(', '))}</td></tr>`)
    .join('');
  $('circuitFacts').innerHTML =
    `<p>${esc(circuit.diagram.description)}</p><p>Nodes: ${esc(circuit.diagram.nodes.join(', '))}</p>` +
    `<table><caption>Components</caption><thead><tr><th scope="col">Id</th><th scope="col">Kind</th>` +
    `<th scope="col">Value</th><th scope="col">Terminals</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function selectCircuit(id: string): void {
  const next = TEST_CIRCUITS.find((c) => c.id === id);
  if (!next) return;
  stopListening();
  stopSpeaking();
  circuit = next;
  explorer = createDiagramExplorer(circuit.diagram);
  renderCircuit();
  write(`circuit: ${circuit.label} (focus reset)`);
  if (flow) write('exam: restart the exam to use this circuit for question 3');
}

// ---------- hands-free exam flow (same controller as the end-to-end tests) ----------

let flow: ReferenceController | null = null;
let flowBusy = false;

function renderFlowStatus(): void {
  const el = $('flowStatus');
  if (!flow) {
    el.textContent = 'Not started.';
    return;
  }
  const saved = Object.keys(flow.api.session.answers).length;
  const mic = flow.keyboardOnly ? 'keyboard only' : flow.listening ? 'listening…' : flowBusy ? 'speaking…' : 'press Space to talk';
  el.textContent = `Question ${flow.index + 1} of ${flow.total} · mode: ${flow.mode} · ${mic} · answers saved: ${saved} · ${flow.api.session.status}`;
}

async function runFlow(step: Promise<void>): Promise<void> {
  flowBusy = true;
  renderFlowStatus();
  try {
    await step;
  } catch (e) {
    write(`exam error: ${describeError(e)}`);
  } finally {
    flowBusy = false;
    renderFlowStatus();
  }
}

$('flowStart').addEventListener('click', () => {
  stopListening();
  stopSpeaking();
  flow = new ReferenceController({
    exam: buildDemoExam(circuit.diagram),
    api: createMemorySession(),
    onAnnounce: (text) => {
      $('flowAnnounce').textContent = text;
      write(`exam says: ${text}`);
    },
    onHeard: (text) => write(`exam heard: "${text}"`),
    onChange: renderFlowStatus,
  });
  write(`exam: started (question 3 circuit: ${circuit.label})`);
  // Move focus off the button so Space talks instead of restarting.
  $('flowStatus').focus();
  void runFlow(flow.start());
});

$<HTMLInputElement>('flowType').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !flow) return;
  const input = e.target as HTMLInputElement;
  const text = input.value.trim();
  input.value = '';
  if (!text || flowBusy) return;
  write(`exam typed: "${text}"`);
  void runFlow(flow.type(text));
});

document.addEventListener('keydown', (e) => {
  if (!flow) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    void flow.escape();
    return;
  }
  const tag = (e.target as HTMLElement | null)?.tagName ?? '';
  if (e.key !== ' ' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  e.preventDefault(); // Space talks; it does not press the focused button
  if (flowBusy) return;
  if (flow.keyboardOnly) {
    $('flowAnnounce').textContent = 'Microphone unavailable: type in the box instead.';
    $<HTMLInputElement>('flowType').focus();
    return;
  }
  void runFlow(flow.turn());
});

const circuitSelect = $<HTMLSelectElement>('circuit');
for (const c of TEST_CIRCUITS) circuitSelect.add(new Option(c.label, c.id));
circuitSelect.addEventListener('change', () => selectCircuit(circuitSelect.value));
$('resetFocus').addEventListener('click', () => {
  explorer.reset();
  write('focus: null (reset)');
});
renderCircuit();

function describeError(err: unknown): string {
  return err instanceof VoiceError ? `VoiceError[${err.code}] ${err.message}` : `Error ${String(err)}`;
}

async function handleCommand(cmd: VoiceCommand): Promise<void> {
  write(`command: ${JSON.stringify(cmd)}`);
  if (cmd.type === 'explore') {
    const reply = explorer.ask(cmd.query);
    write(`focus: ${JSON.stringify(explorer.focus)}`);
    write(`diagram: ${reply}`);
    await speak(reply).catch((e) => write(describeError(e)));
  }
}

async function listen(mode: 'command' | 'dictation'): Promise<void> {
  write(`listening (${mode})…`);
  try {
    const text = await listenOnce();
    write(`heard: "${text}"`);
    // In dictation mode the transcript is the literal answer: never parse it as a command.
    if (mode === 'command') await handleCommand(parseCommand(text));
    else {
      const spoken = readBackText(text);
      write(`dictation literal (stored): "${text}"`);
      write(`read-back (spoken only): "${spoken}"`);
      await speak(`You said: ${spoken}`).catch((e) => write(describeError(e)));
    }
  } catch (e) {
    write(describeError(e));
  }
}

$('support').textContent = `Text-to-speech: ${isSpeechSupported() ? 'available' : 'NOT available'}. Speech recognition: ${
  isRecognitionSupported() ? 'available' : 'NOT available (keyboard fallback only)'
}.`;

$<HTMLSelectElement>('lang').addEventListener('change', (e) => {
  const value = (e.target as HTMLSelectElement).value as VoiceLanguage;
  setLanguage(value);
  document.documentElement.lang = value;
  write(`language: ${value}`);
});
$('speak').addEventListener('click', () => {
  speak($<HTMLInputElement>('text').value).then(
    () => write('speak: finished'),
    (e) => write(describeError(e)),
  );
});
$('readBack').addEventListener('click', () => {
  const literal = $<HTMLInputElement>('text').value;
  const spoken = readBackText(literal);
  write(`read-back of typed text: "${literal}" -> "${spoken}"`);
  speak(spoken).catch((e) => write(describeError(e)));
});
$('stopSpeak').addEventListener('click', () => stopSpeaking());
$('listenCmd').addEventListener('click', () => void listen('command'));
$('listenDictate').addEventListener('click', () => void listen('dictation'));
$('speakThenListen').addEventListener('click', () => {
  speak($<HTMLInputElement>('text').value).catch((e) => write(describeError(e)));
  void listen('command'); // must not open the mic until speech has finished
});
$('stopListen').addEventListener('click', () => stopListening());
$('parse').addEventListener('click', () => void handleCommand(parseCommand($<HTMLInputElement>('typed').value)));
$<HTMLInputElement>('typed').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void handleCommand(parseCommand((e.target as HTMLInputElement).value));
});
