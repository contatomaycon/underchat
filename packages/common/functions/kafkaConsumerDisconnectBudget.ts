const MIN_NATIVE_DISCONNECT_TIMEOUT_MS = 15_000;
const DISCONNECT_WRAPPER_GRACE_MS = 5_000;

type KafkaConsumerDisconnectEnvironment = Record<string, string | undefined>;

export interface IKafkaConsumerDisconnectBudget {
  nativeTimeoutMs: number;
  wrapperTimeoutMs: number;
}

function readPositiveInteger(
  environment: KafkaConsumerDisconnectEnvironment,
  name: string,
  fallback: number
): number {
  const parsed = Number(environment[name]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

/**
 * The managed consumer owns the native librdkafka shutdown deadline. Every
 * wrapper waiting for its callback must have a strictly wider budget;
 * otherwise it can report a completed close while the native member is still
 * heartbeating and a replacement generation may start beside that ghost.
 */
export function resolveKafkaConsumerDisconnectBudget(
  environment: KafkaConsumerDisconnectEnvironment = process.env
): IKafkaConsumerDisconnectBudget {
  const nativeTimeoutMs = Math.max(
    MIN_NATIVE_DISCONNECT_TIMEOUT_MS,
    readPositiveInteger(
      environment,
      'KAFKA_CONSUMER_DISCONNECT_TIMEOUT_MS',
      MIN_NATIVE_DISCONNECT_TIMEOUT_MS
    )
  );

  return {
    nativeTimeoutMs,
    wrapperTimeoutMs: safeAdd(nativeTimeoutMs, DISCONNECT_WRAPPER_GRACE_MS),
  };
}

export const kafkaConsumerDisconnectBudget =
  resolveKafkaConsumerDisconnectBudget();
