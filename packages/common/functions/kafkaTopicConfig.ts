export interface IKafkaTopicConfig {
  numPartitions: number;
  replicationFactor: number;
}

export const KAFKA_WORKER_TOPIC_CONFIG: IKafkaTopicConfig = {
  numPartitions: 1,
  replicationFactor: 2,
};

export const KAFKA_GLOBAL_TOPIC_CONFIG: IKafkaTopicConfig = {
  numPartitions: 30,
  replicationFactor: 3,
};

const GLOBAL_WORKER_TOPIC_SEGMENTS = new Set(['config', 'warm', 'lifecycle']);

export function isWorkerScopedKafkaTopic(topic: string): boolean {
  const parts = topic.split('.');
  return (
    parts.length >= 2 &&
    parts[0] === 'worker' &&
    !GLOBAL_WORKER_TOPIC_SEGMENTS.has(parts[1])
  );
}

export function resolveKafkaTopicConfig(topic: string): IKafkaTopicConfig {
  if (isWorkerScopedKafkaTopic(topic)) {
    return KAFKA_WORKER_TOPIC_CONFIG;
  }

  return KAFKA_GLOBAL_TOPIC_CONFIG;
}

export function isRecoverableKafkaTopicError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorCode =
    (error as { code?: number; errno?: number }).code ??
    (error as { code?: number; errno?: number }).errno;

  const hasStringMessage =
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string';
  const message =
    error instanceof Error
      ? error.message
      : hasStringMessage
        ? String((error as { message: string }).message)
        : String(error);

  const lowerMessage = message.toLowerCase();

  return (
    errorCode === 3 ||
    errorCode === -188 ||
    lowerMessage.includes('unknown topic') ||
    lowerMessage.includes('unknown topic or partition') ||
    lowerMessage.includes('unknown_topic_or_part') ||
    lowerMessage.includes('leader not available') ||
    lowerMessage.includes('not leader for partition') ||
    lowerMessage.includes('metadata')
  );
}
