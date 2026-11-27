import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { checkMicrophone } from './microphone';
import type { MicrophoneStatus } from './microphone';

const messages: Record<MicrophoneStatus, string> = {
  ready: 'Select Test microphone to begin.',
  requesting: 'Waiting for microphone permission.',
  listening: 'Listening. Please speak briefly in your usual voice.',
  detected: 'Audio input detected. You can continue to the exam.',
  silent: 'No audio input detected. Speak a little louder or move closer and retry.',
  denied: 'Microphone access was denied. You can retry or continue without a microphone.',
  missing: 'No microphone is available. Connect one and retry, or continue without a microphone.',
  unavailable: 'The microphone is unavailable or in use. Close other apps using it and retry.',
  unsupported: 'This browser does not support the microphone check. You can continue without a microphone.',
  insecure: 'This page needs a secure connection to test the microphone. You can continue without a microphone.',
  paused: 'The test stopped when you left the page. Retry when you are ready.',
  error: 'The microphone check could not finish. You can retry or continue without a microphone.',
};

export default function MicrophoneCheck({ onCancel, onContinue }: { onCancel: () => void; onContinue: () => void }) {
  const [status, setStatus] = useState<MicrophoneStatus>('ready');
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const meter = useRef<HTMLProgressElement>(null);
  const attempt = useRef<AbortController | undefined>(undefined);
  const finished = useRef(false);
  const testing = status === 'requesting' || status === 'listening';

  useLayoutEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    heading.current?.focus();
    return () => {
      attempt.current?.abort();
      attempt.current = undefined;
      panel?.close();
    };
  }, []);

  function test() {
    if (attempt.current || finished.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    void checkMicrophone(controller.signal, next => {
      if (next !== 'requesting' && next !== 'listening') attempt.current = undefined;
      setStatus(next);
    }, value => {
      if (meter.current) meter.current.value = value;
    });
  }

  function leave(continueToExam: boolean) {
    if (finished.current) return;
    finished.current = true;
    attempt.current?.abort();
    attempt.current = undefined;
    dialog.current?.close();
    if (continueToExam) onContinue();
    else onCancel();
  }

  return (
    <dialog className="confirmation-dialog microphone-dialog" ref={dialog} aria-labelledby="microphone-check-title"
      aria-describedby="microphone-check-help" onCancel={event => { event.preventDefault(); leave(false); }}>
      <div className="section-title">
        <span className="icon-tile"><Icon name="microphone" /></span>
        <h3 id="microphone-check-title" tabIndex={-1} ref={heading}>Microphone Check</h3>
      </div>
      <p id="microphone-check-help">You can test for audio input before starting the exam. If you prefer, continue with the keyboard.</p>
      <div className="microphone-level" aria-hidden="true">
        <span>Input level</span>
        <progress ref={meter} value={0} max={1} />
      </div>
      <p className="feedback-status" role="status" aria-atomic="true" data-pending={testing || undefined}>{messages[status]}</p>
      <p className="microphone-privacy">No audio is recorded or stored.</p>
      <div className="actions">
        {status === 'detected' ? <button type="button" className="primary" onClick={() => leave(true)}>Continue to exam</button>
          : <button type="button" className="primary" aria-disabled={testing} onClick={test}>{status === 'ready' || testing ? 'Test microphone' : 'Retry'}</button>}
        <button type="button" onClick={() => leave(true)}>Continue without microphone</button>
        <button type="button" className="quiet" onClick={() => leave(false)}>Cancel</button>
      </div>
    </dialog>
  );
}
