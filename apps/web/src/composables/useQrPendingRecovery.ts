import { onUnmounted, shallowRef } from 'vue';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

interface UseQrPendingRecoveryOptions {
  intervalMs?: number;
  shouldContinue: () => boolean;
  requestState: () => Promise<IBaileysConnectionState | null>;
  applyState: (state: IBaileysConnectionState) => void;
  onError?: (error: unknown) => void;
}

export function useQrPendingRecovery(options: UseQrPendingRecoveryOptions) {
  const intervalMs = options.intervalMs ?? 3000;
  const timerId = shallowRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = shallowRef(false);

  function clearTimer() {
    if (timerId.value) {
      clearTimeout(timerId.value);
      timerId.value = null;
    }
  }

  function stop() {
    clearTimer();
  }

  async function tick(): Promise<boolean> {
    if (!options.shouldContinue()) {
      stop();
      return false;
    }

    if (inFlight.value) {
      return options.shouldContinue();
    }

    inFlight.value = true;
    try {
      const state = await options.requestState();
      if (state) {
        options.applyState(state);
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      inFlight.value = false;
    }

    return options.shouldContinue();
  }

  function schedule() {
    if (timerId.value || !options.shouldContinue()) {
      return;
    }

    timerId.value = setTimeout(() => {
      timerId.value = null;
      void tick().then((shouldContinue) => {
        if (shouldContinue) {
          schedule();
          return;
        }

        stop();
      });
    }, intervalMs);
  }

  function start() {
    if (!options.shouldContinue()) {
      stop();
      return;
    }

    schedule();
  }

  function restart() {
    stop();
    start();
  }

  onUnmounted(stop);

  return {
    start,
    restart,
    stop,
    isPolling: inFlight,
  };
}
