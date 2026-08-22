import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';
import type { WorkerLifecycleQueueSource } from '../interfaces/IWorkerLifecycleQueueMessage';

export interface WorkerWarmActivationPolicyInput {
  source: WorkerLifecycleQueueSource;
  session_storage?: EWorkerSessionStorage;
  remove_session?: boolean;
  remove_volume?: boolean;
}

/**
 * Warm runtimes are PostgreSQL-only and deliberately own no session volume.
 * They may serve a new channel or an update that explicitly discards its
 * PostgreSQL session. Legacy-volume channels always use cold lifecycle paths
 * so their existing volume is never detached or replaced by a warm runtime.
 */
export function canActivateWorkerWarmRuntime(
  input: WorkerWarmActivationPolicyInput
): boolean {
  if (input.session_storage !== EWorkerSessionStorage.postgres) {
    return false;
  }

  if (input.source === 'worker_create') {
    return true;
  }

  return (
    input.source === 'worker_update' &&
    input.remove_session === true &&
    input.remove_volume === false
  );
}
