import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Diagram, VoiceCommand } from '../../../contracts/types';

export interface VoiceApi {
  speak(text: string): Promise<void>;
  stopSpeaking(): void;
  listenOnce(): Promise<string>;
  stopListening(): void;
  parseCommand(text: string): VoiceCommand;
  describeDiagram(diagram: Diagram, query: string): string;
}

// The voice entry point is optional on the standalone frontend branch.
const modules: Partial<Record<string, () => Promise<VoiceApi>>> = import.meta.glob<VoiceApi>('../voice/index.ts');
const loadVoice = modules['../voice/index.ts'];

type VoiceTask = { api?: VoiceApi };
export type VoiceActivity = { phase: 'preparing' | 'listening' | 'speaking' | 'processing'; label: string };

export function useVoice(visible: boolean) {
  const [activity, setActivity] = useState<VoiceActivity>();
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const task = useRef<VoiceTask | null>(null);

  const cancel = useCallback(() => {
    const current = task.current;
    task.current = null;
    current?.api?.stopListening();
    current?.api?.stopSpeaking();
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      setActivity(undefined);
      setResult(undefined);
      setError(undefined);
    }
    return cancel;
  }, [visible, cancel]);

  function stop() {
    cancel();
    setActivity(undefined);
  }

  async function run(pending: string, action: (voice: VoiceApi, isCurrent: () => boolean) => Promise<void>) {
    if (!loadVoice || !visible || task.current) return;
    const current: VoiceTask = {};
    task.current = current;
    const isCurrent = () => task.current === current;
    setError(undefined);
    setResult(undefined);
    setActivity({ phase: 'preparing', label: pending });
    try {
      const voice = await loadVoice();
      if (!isCurrent()) return;
      current.api = voice;
      await action(voice, isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error && failure.message
          ? `${failure.message} Keyboard controls are available.`
          : 'Speech is unavailable. Keyboard controls are available.');
      }
    } finally {
      if (isCurrent()) {
        task.current = null;
        setActivity(undefined);
      }
    }
  }

  function speak(voice: VoiceApi, text: string) {
    voice.stopListening();
    setActivity({ phase: 'speaking', label: 'Reading aloud…' });
    return voice.speak(text);
  }

  return {
    available: Boolean(loadVoice),
    activity, result, error, run, speak, setActivity, setResult, stop,
  };
}
