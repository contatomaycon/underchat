interface KafkaRequestQueueLike {
  pending: unknown[];
  checkPendingRequests(): void;
  destroy(): void;
}

interface KafkaRequestQueueConstructor {
  new (options: {
    maxInFlightRequests: number | null;
    requestTimeout: number;
    enforceRequestTimeout: boolean;
    clientId: string;
    broker: string;
    logger: {
      debug: jest.Mock;
      warn: jest.Mock;
    };
  }): KafkaRequestQueueLike;
}

const KafkaRequestQueue =
  require('kafkajs/src/network/requestQueue') as KafkaRequestQueueConstructor;

function createRequestQueue(): KafkaRequestQueueLike {
  return new KafkaRequestQueue({
    maxInFlightRequests: 0,
    requestTimeout: 10_000,
    enforceRequestTimeout: false,
    clientId: 'request-queue-contract-test',
    broker: 'localhost:9092',
    logger: {
      debug: jest.fn(),
      warn: jest.fn(),
    },
  });
}

describe('KafkaJS request queue patch', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not schedule a negative timeout after the request queue becomes empty', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const queue = createRequestQueue();

    queue.checkPendingRequests();

    expect(queue.pending).toHaveLength(0);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    queue.destroy();
  });

  it('keeps the positive fallback poll for a pending request', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const queue = createRequestQueue();
    queue.pending.push({});

    queue.checkPendingRequests();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(10);
    queue.destroy();
  });
});
