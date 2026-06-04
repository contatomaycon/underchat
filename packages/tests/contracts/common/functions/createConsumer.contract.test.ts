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
  connect = jest.fn((_metadata: unknown, cb?: (err: Error | null) => void) => {
    cb?.(null);
  });
  subscribe = jest.fn();
  consume = jest.fn();
  commitSync = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((cb?: () => void) => {
    cb?.();
  });
  pause = jest.fn();
  resume = jest.fn();
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

    expect(firstConsumer.subscribe).toHaveBeenCalledWith([
      'worker.w1.send.message',
    ]);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
