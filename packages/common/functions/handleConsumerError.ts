import { getErrorMessage } from './toError';

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
    return;
  }
}
