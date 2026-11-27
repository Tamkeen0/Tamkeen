import { useRef, useState } from 'react';
import { UiError } from './errors';

export function useRequest(onBusyChange?: (busy: boolean) => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function run(message: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    const trigger = document.activeElement;
    inFlight.current = true;
    setPending(message);
    onBusyChange?.(true);
    setError(undefined);
    try {
      await action();
    } catch (error) {
      setError(error instanceof UiError ? error.message : 'Something went wrong. Try again.');
      if (trigger instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body && trigger.isConnected) trigger.focus();
        });
      }
    } finally {
      inFlight.current = false;
      setPending(undefined);
      onBusyChange?.(false);
    }
  }

  return { busy: Boolean(pending), pending, error, run };
}
