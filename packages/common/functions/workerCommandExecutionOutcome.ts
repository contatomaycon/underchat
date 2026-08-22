import { AsyncLocalStorage } from 'node:async_hooks';

export type WorkerCommandExecutionOutcome =
  'succeeded' | 'failed' | 'expired' | 'ambiguous';

interface WorkerCommandExecutionOutcomeStore {
  outcome: WorkerCommandExecutionOutcome | null;
  identity: WorkerCommandExecutionIdentity | null;
}

export interface WorkerCommandExecutionIdentity {
  accountId: string;
  workerId: string;
  entityKey: string;
  operationId: string;
  commandId: string;
}

const outcomeStorage =
  new AsyncLocalStorage<WorkerCommandExecutionOutcomeStore>();

const OUTCOME_PRIORITY: Record<WorkerCommandExecutionOutcome, number> = {
  succeeded: 1,
  expired: 2,
  failed: 3,
  ambiguous: 4,
};

/**
 * Captures the terminal provider outcome produced by a transport-neutral
 * handler. Handlers remain unaware of JetStream while the ingress can avoid
 * incorrectly acknowledging an ambiguous/failed provider result as success.
 */
export async function runWithWorkerCommandExecutionOutcome<T>(
  callback: () => Promise<T>,
  identity: WorkerCommandExecutionIdentity | null = null
): Promise<{ value: T; outcome: WorkerCommandExecutionOutcome | null }> {
  const store: WorkerCommandExecutionOutcomeStore = { outcome: null, identity };
  const value = await outcomeStorage.run(store, callback);
  return { value, outcome: store.outcome };
}

export function currentWorkerCommandExecutionIdentity(): WorkerCommandExecutionIdentity | null {
  const identity = outcomeStorage.getStore()?.identity;
  return identity ? { ...identity } : null;
}

export function recordWorkerCommandExecutionOutcome(
  outcome: WorkerCommandExecutionOutcome
): void {
  const store = outcomeStorage.getStore();
  if (!store) return;
  if (
    store.outcome === null ||
    OUTCOME_PRIORITY[outcome] > OUTCOME_PRIORITY[store.outcome]
  ) {
    store.outcome = outcome;
  }
}
