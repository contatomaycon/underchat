import { EventEmitter } from 'node:events';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

class FakeKafkaConsumer extends EventEmitter {
  private subscribedTopics: string[] = [];
  private assignedTopics: string[] = [];

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

  it('ensures topic, connects, forwards data, and recreates consumer on runtime error', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };

    const consumer = createConsumer(kafka as never, 'group-1') as any;
    const dataHandler = jest.fn();
    const errorHandler = jest.fn();
    const connectCallback = jest.fn();

    consumer.on('data', dataHandler);
    consumer.on('event.error', errorHandler);
    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, connectCallback);

    await flushPromises();
    expect(firstConsumer.connect).toHaveBeenCalledTimes(1);

    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', { value: Buffer.from('one') });

    expect(ensureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'worker.w1.send.message',
      1,
      2
    );
    expect(firstConsumer.subscribe).toHaveBeenCalledWith([
      'worker.w1.send.message',
    ]);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(dataHandler).toHaveBeenCalledWith({ value: Buffer.from('one') });

    firstConsumer.emit('event.error', new Error('Unknown topic or partition'));
    expect(errorHandler).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await flushPromises();

    expect(firstConsumer.disconnect).toHaveBeenCalled();
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(secondConsumer.connect).toHaveBeenCalledTimes(1);

    secondConsumer.emit('ready');
    await flushPromises();
    expect(secondConsumer.subscribe).toHaveBeenCalledWith([
      'worker.w1.send.message',
    ]);
    expect(secondConsumer.consume).toHaveBeenCalledTimes(1);
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

  it('does not restart a worker send consumer just because it is idle', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;

    await connectConsumer(consumer, 'worker.w1.send.message', jest.fn());
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();

    jest.advanceTimersByTime(5 * 60 * 1000);
    await flushPromises();

    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();
  });

  it('starts consuming when ready without waiting for legacy QR topic assignment', async () => {
    const topic = 'worker.w1.send.message';
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;
    const onConnected = jest.fn();

    await connectConsumer(consumer, topic, onConnected);
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();

    expect(firstConsumer.subscribe).toHaveBeenCalledWith([topic]);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
