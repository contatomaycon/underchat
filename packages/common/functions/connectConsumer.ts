import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { getErrorMessage } from './toError';
import { isWhatsappDurableCommittedTopic } from './kafkaConsumerStartPositionPolicy';
import { kafkaConsumerDisconnectBudget } from './kafkaConsumerDisconnectBudget';

const TIMEOUT_ERROR_CODE = -185;
const FALLBACK_DELAY_MS = 1000;
const MANAGED_CONNECT_TIMEOUT_MS = 30000;
const MANAGED_DISCONNECT_TIMEOUT_MS =
  kafkaConsumerDisconnectBudget.wrapperTimeoutMs;

function isManagedKafkaConsumer(consumer: KafkaConsumer): boolean {
  return Boolean(
    (consumer as unknown as { __managedKafkaConsumer?: boolean })
      .__managedKafkaConsumer
  );
}

function assertDurableConsumerBoundary(
  consumer: KafkaConsumer,
  topic: string
): void {
  // Legacy assignment-positioning contracts run only under Jest. Runtime
  // operational topics must enter through the managed committed-offset path.
  if (
    process.env.NODE_ENV === 'test' ||
    !isWhatsappDurableCommittedTopic(topic)
  ) {
    return;
  }

  const startPosition = (
    consumer as unknown as {
      __managedKafkaConsumerStartPosition?: string;
    }
  ).__managedKafkaConsumerStartPosition;
  if (!isManagedKafkaConsumer(consumer) || startPosition !== 'committed') {
    throw new Error(
      `Kafka topic ${topic} requires a managed committed-offset consumer`
    );
  }
}

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
  const isManagedConsumer = isManagedKafkaConsumer(consumer);
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

function disconnectFailedManagedConsumer(
  consumer: KafkaConsumer
): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(disconnectTimeout);
      resolve();
    };
    const disconnectTimeout = setTimeout(finish, MANAGED_DISCONNECT_TIMEOUT_MS);
    disconnectTimeout.unref?.();

    try {
      consumer.unsubscribe();
    } catch {}

    try {
      consumer.disconnect(finish);
    } catch {
      finish();
    }
  });
}

function connectManagedConsumer(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      consumer.removeListener('ready', readyHandler);
      consumer.removeListener('event.error', errorHandler);
      consumer.removeListener('disconnected', disconnectedHandler);
    };

    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      const normalizedError =
        error instanceof Error ? error : new Error(getErrorMessage(error));
      void disconnectFailedManagedConsumer(consumer).then(
        () => reject(normalizedError),
        () => reject(normalizedError)
      );
    };

    const readyHandler = (): void => {
      if (settled) {
        return;
      }

      try {
        onConnected();
      } catch (error) {
        fail(error);
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const errorHandler = (error: LibrdKafkaError): void => {
      fail(error);
    };

    const disconnectedHandler = (): void => {
      fail(
        new Error(`Kafka consumer disconnected before ready for topic ${topic}`)
      );
    };

    consumer.once('ready', readyHandler);
    consumer.on('event.error', errorHandler);
    consumer.once('disconnected', disconnectedHandler);
    timeout = setTimeout(() => {
      fail(
        new Error(
          `Kafka consumer readiness timeout after ${MANAGED_CONNECT_TIMEOUT_MS}ms for topic ${topic}`
        )
      );
    }, MANAGED_CONNECT_TIMEOUT_MS);

    try {
      consumer.subscribe([topic]);
      consumer.consume();
      consumer.connect({}, (error) => {
        if (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  });
}

export async function connectConsumer(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): Promise<void> {
  assertDurableConsumerBoundary(consumer, topic);

  if (isManagedKafkaConsumer(consumer)) {
    await connectManagedConsumer(consumer, topic, onConnected);
    return;
  }

  connectInBackground(consumer, topic, onConnected);
}
