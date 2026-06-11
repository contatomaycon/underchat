import { EventEmitter } from 'node:events';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

class FakeKafkaConsumer extends EventEmitter {
  private subscribedTopics: string[] = [];
  private assignedTopics: string[] = [];
  committedOffset = 0;
  highOffset = 0;

  constructor(private readonly autoAssign = true) {
    super();
  }

  connect = jest.fn((_metadata: unknown, cb?: (err: Error | null) => void) => {
    cb?.(null);
  });
  getMetadata = jest.fn(
    (
      options: { topic?: string },
      cb?: (err: Error | null, metadata: unknown) => void
    ) => {
      cb?.(null, {
        topics: [
          {
            name: options.topic,
            partitions: [{ id: 0, leader: 1, replicas: [1], isrs: [1] }],
          },
        ],
        brokers: [],
      });
    }
  );
  subscribe = jest.fn((topics: string[]) => {
    this.subscribedTopics = topics;
    if (this.autoAssign) {
      this.assignedTopics = topics;
    }
  });
  consume = jest.fn();
  commitSync = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((cb?: () => void) => {
    cb?.();
  });
  pause = jest.fn();
  resume = jest.fn();
  assignments = jest.fn(() =>
    this.assignedTopics.map((topic) => ({ topic, partition: 0 }))
  );
  committed = jest.fn(
    (
      assignments: Array<{ topic: string; partition: number }>,
      _timeout: number,
      cb?: (
        err: Error | null,
        offsets: Array<{ topic: string; partition: number; offset: number }>
      ) => void
    ) => {
      cb?.(
        null,
        assignments.map((assignment) => ({
          ...assignment,
          offset: this.committedOffset,
        }))
      );
    }
  );
  queryWatermarkOffsets = jest.fn(
    (
      _topic: string,
      _partition: number,
      _timeout: number,
      cb?: (
        err: Error | null,
        offsets: { lowOffset: number; highOffset: number }
      ) => void
    ) => {
      cb?.(null, { lowOffset: 0, highOffset: this.highOffset });
    }
  );
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('createConsumer managed kafka consumer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prepares topic and consume state when used through connectConsumer', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;
    const onConnected = jest.fn();

    await connectConsumer(consumer, 'worker.w1.send.message', onConnected);
    await flushPromises();

    expect(ensureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'worker.w1.send.message',
      1,
      2
    );
    expect(firstConsumer.connect).toHaveBeenCalledTimes(1);

    firstConsumer.emit('ready');
    await flushPromises();

    expect(firstConsumer.subscribe).toHaveBeenCalledWith([
      'worker.w1.send.message',
    ]);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('does not restart for stale commit generation errors', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();

    const error = new Error(
      'Broker: Specified group generation id is not valid'
    ) as Error & { code: number };
    error.code = 22;
    firstConsumer.commitSync.mockImplementationOnce(() => {
      throw error;
    });

    expect(() =>
      consumer.commitSync([
        { topic: 'upsert.message', partition: 0, offset: 10 },
      ])
    ).toThrow('Broker: Specified group generation id is not valid');

    jest.advanceTimersByTime(1000);
    await flushPromises();

    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();
  });
});
