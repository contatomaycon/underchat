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
  const inFlight = shallowRef(false);

  function stop() {
    inFlight.value = false;
  }

  function start() {
    options.shouldContinue();
    stop();
  }

  function restart() {
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
