import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { getErrorMessage } from './toError';

const TIMEOUT_ERROR_CODE = -185;
const FALLBACK_DELAY_MS = 1000;

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorCode =
    (error as { code?: number; errno?: number })?.code ??
    (error as { code?: number; errno?: number })?.errno;
  const errorMessage = getErrorMessage(error);

  if (errorCode === TIMEOUT_ERROR_CODE) {
    return true;
  }

  if (errorMessage.includes('Timed out')) {
    return true;
  }

  if (errorMessage.includes('timeout')) {
    return true;
  }

  return false;
}

function createCleanup(
  consumer: KafkaConsumer,
  readyHandler: () => void,
  errorHandler: (err: LibrdKafkaError) => void
) {
  return (): void => {
    consumer.removeListener('ready', readyHandler);
    consumer.removeListener('event.error', errorHandler);
  };
}

function createTimeoutHandler(
  cleanup: () => void,
  isResolved: { value: boolean }
): NodeJS.Timeout {
  return setTimeout(() => {
    if (isResolved.value) {
      return;
    }

    isResolved.value = true;
    cleanup();
  }, 30000);
}

function handleTimeoutError(
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean }
): void {
  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();
  console.warn(
    `Kafka consumer connection timeout for topic ${topic}, continuing without connection`
  );
}

function createErrorHandler(
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean }
) {
  return (err: LibrdKafkaError): void => {
    if (isResolved.value) {
      return;
    }

    if (isTimeoutError(err)) {
      handleTimeoutError(topic, cleanup, timeout, isResolved);
    }
  };
}

function createReadyHandler(
  topic: string,
  onConnected: () => void,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  consumer: KafkaConsumer,
  subscribeOnReady = true
) {
  return (): void => {
    if (isResolved.value) {
      return;
    }

    try {
      if (subscribeOnReady) {
        consumer.subscribe([topic]);
        consumer.consume();
      }
      onConnected();
    } catch {}

    if (isResolved.value) {
      return;
    }

    isResolved.value = true;
    clearTimeout(timeout);
    cleanup();
  };
}

function setupEventListeners(
  consumer: KafkaConsumer,
  readyHandler: () => void,
  errorHandler: (err: LibrdKafkaError) => void
): void {
  consumer.once('ready', readyHandler);
  consumer.on('event.error', errorHandler);
}

function handleConnectCallbackError(
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  err: LibrdKafkaError
): void {
  if (isTimeoutError(err)) {
    handleTimeoutError(topic, cleanup, timeout, isResolved);
    return;
  }
}

function createConnectCallback(
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  connectCallbackCalled: { value: boolean }
) {
  return (err: LibrdKafkaError | null): void => {
    connectCallbackCalled.value = true;

    if (!err) {
      return;
    }

    handleConnectCallbackError(topic, cleanup, timeout, isResolved, err);
  };
}

function handleConnectException(
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  connectCallbackCalled: { value: boolean }
): void {
  connectCallbackCalled.value = true;

  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();
}

function attemptConnect(
  consumer: KafkaConsumer,
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  connectCallbackCalled: { value: boolean }
): void {
  const connectCallback = createConnectCallback(
    topic,
    cleanup,
    timeout,
    isResolved,
    connectCallbackCalled
  );

  try {
    consumer.connect({}, connectCallback);
  } catch {
    handleConnectException(cleanup, timeout, isResolved, connectCallbackCalled);
  }
}

function handleSubscribeSuccess(
  onConnected: () => void,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean }
): void {
  onConnected();

  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();
}

function handleSubscribeError(
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  subscribeError: unknown
): void {
  if (!isTimeoutError(subscribeError)) {
    return;
  }

  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();
}

function attemptSubscribeFallback(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  connectCallbackCalled: { value: boolean }
): void {
  setTimeout(() => {
    if (isResolved.value) {
      return;
    }

    if (connectCallbackCalled.value) {
      return;
    }

    try {
      consumer.subscribe([topic]);
      consumer.consume();
      handleSubscribeSuccess(onConnected, cleanup, timeout, isResolved);
    } catch (subscribeError) {
      handleSubscribeError(cleanup, timeout, isResolved, subscribeError);
    }
  }, FALLBACK_DELAY_MS);
}

function connectInBackground(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): void {
  const isManagedConsumer = Boolean(
    (consumer as unknown as { __managedKafkaConsumer?: boolean })
      .__managedKafkaConsumer
  );
  const isResolved = { value: false };
  const connectCallbackCalled = { value: false };
  const cleanupRef = { current: () => {} };
  const cleanup = () => cleanupRef.current();
  const timeout = createTimeoutHandler(cleanup, isResolved);
  const errorHandler = createErrorHandler(topic, cleanup, timeout, isResolved);
  const readyHandler = createReadyHandler(
    topic,
    onConnected,
    cleanup,
    timeout,
    isResolved,
    consumer,
    !isManagedConsumer
  );
  cleanupRef.current = createCleanup(consumer, readyHandler, errorHandler);

  setupEventListeners(consumer, readyHandler, errorHandler);

  if (isManagedConsumer) {
    try {
      consumer.subscribe([topic]);
      consumer.consume();
    } catch {}
  }

  attemptConnect(
    consumer,
    topic,
    cleanup,
    timeout,
    isResolved,
    connectCallbackCalled
  );

  if (!isManagedConsumer) {
    attemptSubscribeFallback(
      consumer,
      topic,
      onConnected,
      cleanup,
      timeout,
      isResolved,
      connectCallbackCalled
    );
  }
}

export async function connectConsumer(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): Promise<void> {
  connectInBackground(consumer, topic, onConnected);

  return Promise.resolve();
}
