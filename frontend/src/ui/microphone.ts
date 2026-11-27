export type MicrophoneStatus =
  | 'ready' | 'requesting' | 'listening' | 'detected' | 'silent'
  | 'denied' | 'missing' | 'unavailable' | 'unsupported' | 'insecure' | 'paused' | 'error';

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function permissionError(error: unknown): MicrophoneStatus {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError' || name === 'AbortError') return 'unavailable';
  return 'error';
}

export async function checkMicrophone(
  signal: AbortSignal, onStatus: (status: MicrophoneStatus) => void, onLevel: (level: number) => void,
) {
  if (!window.isSecureContext) { onStatus('insecure'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) { onStatus('unsupported'); return; }

  let stopped = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let timer: number | undefined;

  function release() {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener('abort', release);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.clearInterval(timer);
    if (stream) {
      for (const track of stream.getTracks()) track.removeEventListener('ended', onEnded);
      stopTracks(stream);
    }
    source?.disconnect();
    analyser?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    stream = context = source = analyser = undefined;
    timer = undefined;
    onLevel(0);
  }

  function finish(status: MicrophoneStatus) {
    if (stopped) return;
    release();
    onStatus(status);
  }

  function onEnded() { finish('unavailable'); }
  function onPageHide() { finish('paused'); }
  function onVisibilityChange() { if (document.hidden) onPageHide(); }

  if (signal.aborted) return;
  if (document.hidden) { onStatus('paused'); return; }
  signal.addEventListener('abort', release, { once: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  onStatus('requesting');

  try {
    // Resume during the button gesture. No audio nodes run while permission is pending.
    context = new AudioContext();
    const resumed = context.resume().then(() => true, () => false);
    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (failure) {
      finish(permissionError(failure));
      return;
    }
    if (stopped) { stopTracks(opened); return; }
    stream = opened;
    if (!stream.getAudioTracks().some(track => track.readyState === 'live')) { finish('missing'); return; }
    for (const track of stream.getTracks()) track.addEventListener('ended', onEnded);

    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    const started = performance.now();
    let listening = false;
    let signalCount = 0;
    timer = window.setInterval(() => {
      if (performance.now() - started >= 8000) { finish(listening ? 'silent' : 'error'); return; }
      if (context?.state !== 'running' || !analyser) return;
      if (!listening) {
        listening = true;
        onStatus('listening');
      }
      try {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        let squares = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          sum += amplitude;
          squares += amplitude * amplitude;
        }
        // Remove the DC offset so a constant sample value cannot count as input.
        const level = Math.sqrt(Math.max(0, squares / samples.length - (sum / samples.length) ** 2));
        onLevel(Math.min(1, level * 8));
        signalCount = level >= .015 ? signalCount + 1 : 0;
        if (signalCount >= 2) finish('detected');
      } catch {
        finish('error');
      }
    }, 100);
    if (!await resumed) finish('error');
  } catch {
    finish('error');
  }
}
