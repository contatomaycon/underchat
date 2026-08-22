import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WorkerCommandActionAttemptRegistry,
  type WorkerCommandActionAttempt,
  type WorkerCommandActionRequestResult,
} from '../../../packages/common/functions/workerCommandActionAttempt';

export const WORKER_COMMAND_ACTION_ATTEMPTS_STORAGE_KEY =
  '@underchat_worker_command_action_attempts_v1';

function uuidv7(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const registry = new WorkerCommandActionAttemptRegistry(uuidv7);
let restorePromise: Promise<void> | null = null;
let mutationQueue: Promise<void> = Promise.resolve();

async function ensureRestored(): Promise<void> {
  restorePromise ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(
        WORKER_COMMAND_ACTION_ATTEMPTS_STORAGE_KEY
      );
      if (raw) registry.restore(JSON.parse(raw));
    } catch {
      await AsyncStorage.removeItem(
        WORKER_COMMAND_ACTION_ATTEMPTS_STORAGE_KEY
      ).catch(() => undefined);
    }
  })();
  await restorePromise;
}

async function persist(): Promise<void> {
  const snapshot = registry.snapshot();
  if (snapshot.attempts.length === 0) {
    await AsyncStorage.removeItem(WORKER_COMMAND_ACTION_ATTEMPTS_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(
    WORKER_COMMAND_ACTION_ATTEMPTS_STORAGE_KEY,
    JSON.stringify(snapshot)
  );
}

function mutateRegistry<T>(mutation: () => T): Promise<T> {
  const run = mutationQueue.then(async () => {
    await ensureRestored();
    const result = mutation();
    await persist().catch(() => undefined);
    return result;
  });
  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function beginWorkerCommandActionAttempt(
  key: string
): Promise<WorkerCommandActionAttempt> {
  return mutateRegistry(() => registry.begin(key));
}

export async function settleWorkerCommandActionAttempt(
  key: string,
  result: WorkerCommandActionRequestResult
): Promise<void> {
  await mutateRegistry(() => registry.settle(key, result));
}

export async function clearWorkerCommandActionAttempts(): Promise<void> {
  await mutateRegistry(() => registry.clear());
}
