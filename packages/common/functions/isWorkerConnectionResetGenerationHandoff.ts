import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';

export interface WorkerConnectionResetGenerationHandoffContext {
  currentCode?: ECodeMessage;
  currentRuntimeGeneration?: number;
  isResetting?: boolean;
}

/**
 * Allows the final `disponible` event emitted by a recreated runtime to take
 * ownership of a connection modal that is still showing the prior runtime's
 * logout state. Other generation changes remain fenced by the caller.
 */
export function isWorkerConnectionResetGenerationHandoff(
  payload: Partial<IBaileysConnectionState>,
  context: WorkerConnectionResetGenerationHandoffContext
): boolean {
  const incomingRuntimeGeneration = payload.runtime_generation;
  const currentRuntimeGeneration = context.currentRuntimeGeneration;

  return (
    typeof incomingRuntimeGeneration === 'number' &&
    typeof currentRuntimeGeneration === 'number' &&
    incomingRuntimeGeneration > currentRuntimeGeneration &&
    payload.worker_status_id === EWorkerStatus.disponible &&
    payload.status === EBaileysConnectionStatus.connecting &&
    payload.code === ECodeMessage.awaitConnection &&
    (context.isResetting === true ||
      context.currentCode === ECodeMessage.logoutInProgress)
  );
}
