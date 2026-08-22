import { AsyncLocalStorage } from 'node:async_hooks';

export type KafkaDispatchGuard = () => void | Promise<void>;

const kafkaDispatchGuardStorage = new AsyncLocalStorage<KafkaDispatchGuard>();

export function runWithKafkaDispatchGuard<T>(
  assertActive: KafkaDispatchGuard,
  callback: () => T
): T {
  return kafkaDispatchGuardStorage.run(assertActive, callback);
}

export function runWithoutKafkaDispatchGuard<T>(callback: () => T): T {
  return kafkaDispatchGuardStorage.exit(callback);
}

export function getKafkaDispatchGuard(): KafkaDispatchGuard | undefined {
  return kafkaDispatchGuardStorage.getStore();
}

export async function assertKafkaDispatchActive(): Promise<void> {
  await getKafkaDispatchGuard()?.();
}
