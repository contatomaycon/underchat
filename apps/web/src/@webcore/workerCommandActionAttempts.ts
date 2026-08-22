import { v7 as uuidv7 } from 'uuid';
import {
  WorkerCommandActionAttemptRegistry,
  type WorkerCommandActionAttempt,
  type WorkerCommandActionRequestResult,
} from '@core/common/functions/workerCommandActionAttempt';

const STORAGE_KEY = 'underchat_worker_command_action_attempts_v1';
const registry = new WorkerCommandActionAttemptRegistry(uuidv7);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function restore(): void {
  const clientStorage = storage();
  if (!clientStorage) return;
  try {
    const raw = clientStorage.getItem(STORAGE_KEY);
    if (raw) registry.restore(JSON.parse(raw));
  } catch {
    clientStorage.removeItem(STORAGE_KEY);
  }
}

function persist(): void {
  const clientStorage = storage();
  if (!clientStorage) return;
  try {
    const snapshot = registry.snapshot();
    if (snapshot.attempts.length === 0) {
      clientStorage.removeItem(STORAGE_KEY);
      return;
    }
    clientStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // A storage quota/security failure must not replace an in-flight ID.
  }
}

restore();

export function beginWorkerCommandActionAttempt(
  key: string
): WorkerCommandActionAttempt {
  const attempt = registry.begin(key);
  persist();
  return attempt;
}

export function settleWorkerCommandActionAttempt(
  key: string,
  result: WorkerCommandActionRequestResult
): void {
  registry.settle(key, result);
  persist();
}

export function clearWorkerCommandActionAttempts(): void {
  registry.clear();
  storage()?.removeItem(STORAGE_KEY);
}
