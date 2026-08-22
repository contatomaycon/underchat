import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkerCommandPublishReceiptV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';

interface WorkerCommandAcceptanceStore {
  receipts: WorkerCommandPublishReceiptV1[];
  retryOf: string | null;
}

const storage = new AsyncLocalStorage<WorkerCommandAcceptanceStore>();
const acceptedReceiptsByError = new WeakMap<
  Error,
  WorkerCommandPublishReceiptV1[]
>();

/** Isolates additive command-acceptance metadata to the current HTTP request. */
export async function runWithWorkerCommandAcceptanceContext<T>(
  callback: () => Promise<T>,
  options: { retryOf?: string | null } = {}
): Promise<{ value: T; receipts: WorkerCommandPublishReceiptV1[] }> {
  const store: WorkerCommandAcceptanceStore = {
    receipts: [],
    retryOf: options.retryOf?.trim() || null,
  };
  try {
    const value = await storage.run(store, callback);
    return { value, receipts: [...store.receipts] };
  } catch (error) {
    if (error instanceof Error && store.receipts.length > 0) {
      acceptedReceiptsByError.set(error, [...store.receipts]);
    }
    throw error;
  }
}

export function currentWorkerCommandRetryOf(): string | null {
  return storage.getStore()?.retryOf ?? null;
}

/** Overrides retry ancestry for one fan-out branch while sharing receipts. */
export async function runWithWorkerCommandRetryOf<T>(
  callback: () => Promise<T>,
  retryOf?: string | null
): Promise<T> {
  const parent = storage.getStore();
  if (!parent) return callback();

  return storage.run(
    {
      receipts: parent.receipts,
      retryOf: retryOf?.trim() || null,
    },
    callback
  );
}

export function recordWorkerCommandAcceptance(
  receipt: WorkerCommandPublishReceiptV1
): void {
  storage.getStore()?.receipts.push({ ...receipt });
}

export function attachWorkerCommandAcceptancesToError(
  error: unknown,
  receipts: readonly WorkerCommandPublishReceiptV1[]
): void {
  if (!(error instanceof Error) || receipts.length === 0) return;
  acceptedReceiptsByError.set(
    error,
    receipts.map((receipt) => ({ ...receipt }))
  );
}

export function workerCommandAcceptancesFromError(
  error: unknown
): WorkerCommandPublishReceiptV1[] {
  if (!(error instanceof Error)) return [];
  return (acceptedReceiptsByError.get(error) ?? []).map((receipt) => ({
    ...receipt,
  }));
}
