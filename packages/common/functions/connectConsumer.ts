import { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { getErrorMessage } from './toError';

const TIMEOUT_ERROR_CODE = -185;
const FALLBACK_DELAY_MS = 5000;

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

function createCleanup(consumer: KafkaConsumer) {
  return (): void => {
    consumer.removeAllListeners('ready');
    consumer.removeAllListeners('event.error');
  };
}

function createTimeoutHandler(
  topic: string,
  cleanup: () => void,
  isResolved: { value: boolean }
): NodeJS.Timeout {
  return setTimeout(() => {
    if (isResolved.value) {
      return;
    }

    isResolved.value = true;
    cleanup();
    console.warn(
      `Kafka consumer connection timeout for topic ${topic}, continuing without connection`
    );
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

function handleNonTimeoutError(topic: string, error: unknown): void {
  console.error(`Kafka consumer error for topic ${topic}:`, error);
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
      return;
    }

    handleNonTimeoutError(topic, err);
  };
}

function createReadyHandler(
  topic: string,
  onConnected: () => void,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  consumer: KafkaConsumer
) {
  return (): void => {
    if (isResolved.value) {
      return;
    }

    try {
      consumer.subscribe([topic]);
      consumer.consume();
      console.log(`Kafka consumer connected to topic: ${topic}`);
      onConnected();
    } catch (error) {
      console.error(`Error subscribing to topic ${topic}:`, error);
    }

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

  handleNonTimeoutError(topic, err);
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
  topic: string,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean },
  connectCallbackCalled: { value: boolean },
  connectError: unknown
): void {
  connectCallbackCalled.value = true;

  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();

  if (isTimeoutError(connectError)) {
    console.warn(
      `Kafka consumer connect() threw timeout error for topic ${topic}, continuing without connection`
    );
    return;
  }

  console.error(
    `Kafka consumer connect() error for topic ${topic}:`,
    connectError
  );
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
  } catch (connectError) {
    handleConnectException(
      topic,
      cleanup,
      timeout,
      isResolved,
      connectCallbackCalled,
      connectError
    );
  }
}

function handleSubscribeSuccess(
  topic: string,
  onConnected: () => void,
  cleanup: () => void,
  timeout: NodeJS.Timeout,
  isResolved: { value: boolean }
): void {
  console.log(`Kafka consumer connected to topic: ${topic}`);
  onConnected();

  if (isResolved.value) {
    return;
  }

  isResolved.value = true;
  clearTimeout(timeout);
  cleanup();
}

function handleSubscribeError(
  topic: string,
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
  console.warn(
    `Kafka consumer subscribe timeout for topic ${topic}, continuing without subscription`
  );
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
      handleSubscribeSuccess(topic, onConnected, cleanup, timeout, isResolved);
    } catch (subscribeError) {
      handleSubscribeError(topic, cleanup, timeout, isResolved, subscribeError);
    }
  }, FALLBACK_DELAY_MS);
}

function connectInBackground(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): void {
  const isResolved = { value: false };
  const connectCallbackCalled = { value: false };
  const cleanup = createCleanup(consumer);
  const timeout = createTimeoutHandler(topic, cleanup, isResolved);
  const errorHandler = createErrorHandler(topic, cleanup, timeout, isResolved);
  const readyHandler = createReadyHandler(
    topic,
    onConnected,
    cleanup,
    timeout,
    isResolved,
    consumer
  );

  setupEventListeners(consumer, readyHandler, errorHandler);

  attemptConnect(
    consumer,
    topic,
    cleanup,
    timeout,
    isResolved,
    connectCallbackCalled
  );

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

export async function connectConsumer(
  consumer: KafkaConsumer,
  topic: string,
  onConnected: () => void
): Promise<void> {
  setImmediate(() => {
    connectInBackground(consumer, topic, onConnected);
  });

  return Promise.resolve();
}
