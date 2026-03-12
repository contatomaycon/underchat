import { getErrorMessage } from './toError';
import { logger } from '@core/plugins/telemetry/logger';
import { recordException } from '@core/plugins/telemetry/observability';

function isKnownConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorCode = (error as any)?.code ?? (error as any)?.errno;
  const errorMessage = getErrorMessage(error);

  const knownErrors = [-1, -185, -172];

  const knownMessages = [
    'broker transport failure',
    'all broker connections are down',
    'timed out',
    'timeout',
    'erroneous state',
    'connection refused',
    'not connected',
  ];

  if (knownErrors.includes(errorCode)) {
    return true;
  }

  const lowerMessage = errorMessage.toLowerCase();
  for (const knownMsg of knownMessages) {
    if (lowerMessage.includes(knownMsg)) {
      return true;
    }
  }

  return false;
}

export function handleConsumerError(error: unknown, topic?: string): void {
  if (isKnownConnectionError(error)) {
    logger.debug(
      {
        err: error,
        type: 'kafka_connection_error',
        topic,
      },
      'Known Kafka connection error (ignored)'
    );
    return;
  }

  logger.error(
    {
      err: error,
      type: 'kafka_consumer_error',
      topic,
    },
    `Kafka consumer error${topic ? ` for topic ${topic}` : ''}`
  );

  recordException(error, {
    kafka: {
      type: 'consumer_error',
      topic,
    },
  });
}
