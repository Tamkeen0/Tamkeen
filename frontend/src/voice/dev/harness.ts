// Developer-only manual test page for the voice module (see ../README.md).
// Uses the synthetic diagram from fixtures/demo_exam.json, question q3.
import type { Diagram, VoiceCommand } from '../../../../contracts/types';
import {
  describeDiagram,
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

const DIAGRAM: Diagram = {
  description: 'A circuit with a voltage source and two resistors. Nodes A, B, and C.',
  nodes: ['A', 'B', 'C'],
  components: [
    { id: 'V1', kind: 'voltage source', value: '12 V, positive at A, negative at C', terminals: ['A', 'C'] },
    { id: 'R1', kind: 'resistor', value: '2 ohms', terminals: ['A', 'B'] },
    { id: 'R2', kind: 'resistor', value: '4 ohms', terminals: ['B', 'C'] },
  ],
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log');

function write(line: string): void {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent ?? ''}`;
}

function describeError(err: unknown): string {
  return err instanceof VoiceError ? `VoiceError[${err.code}] ${err.message}` : `Error ${String(err)}`;
}

async function handleCommand(cmd: VoiceCommand): Promise<void> {
  write(`command: ${JSON.stringify(cmd)}`);
  if (cmd.type === 'explore') {
    const reply = describeDiagram(DIAGRAM, cmd.query);
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
