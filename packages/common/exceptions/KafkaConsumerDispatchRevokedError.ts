export class KafkaConsumerDispatchRevokedError extends Error {
  constructor() {
    super('Kafka consumer dispatch authorization was revoked');
    this.name = 'KafkaConsumerDispatchRevokedError';
  }
}

export function isKafkaConsumerDispatchRevokedError(
  error: unknown
): error is KafkaConsumerDispatchRevokedError {
  return (
    error instanceof KafkaConsumerDispatchRevokedError ||
    (error instanceof Error &&
      error.name === 'KafkaConsumerDispatchRevokedError')
  );
}
