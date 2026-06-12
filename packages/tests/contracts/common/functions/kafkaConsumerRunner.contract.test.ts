import { EventEmitter } from 'node:events';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(async (_consumer, _topic, onConnected) => {
    onConnected?.();
  }),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@core/plugins/kafkaStreams', () => ({}));

class FakeConsumer extends EventEmitter {
  pause = jest.fn();
  resume = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('KafkaConsumerRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits only contiguous completed offsets per partition', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const offset10 = deferred();
    const offset11 = deferred();
    const handler = jest.fn((payload: { offset: number }) =>
      payload.offset === 10 ? offset10.promise : offset11.promise
    );

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: handler,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
    });
    await flushPromises();

    offset11.resolve();
    await flushPromises();

    expect(commitOffset).not.toHaveBeenCalled();

    offset10.resolve();
    await flushPromises();

    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );

    await runner.close();
  });

  it('pauses and resumes partitions when in-flight limit is reached', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const task = deferred();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: () => task.promise,
      maxInFlightTotal: 1,
      maxInFlightPerPartition: 1,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 3,
      offset: 42,
    });
    await flushPromises();

    expect(fakeConsumer.pause).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 3 },
    ]);

    task.resolve();
    await flushPromises();

    expect(fakeConsumer.resume).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 3 },
    ]);

    await runner.close();
  });

  it('does not serialize messages with the same Kafka key by default', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: async (payload: { offset: number }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(payload.offset);
        await (payload.offset === 1
          ? releaseSecond.promise
          : releaseFirst.promise);
        active -= 1;
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      key: Buffer.from('same-key'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      key: Buffer.from('same-key'),
      partition: 0,
      offset: 1,
    });
    await flushPromises();

    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    releaseSecond.resolve();
    releaseFirst.resolve();
    await flushPromises();
    await runner.close();
  });

  it('serializes messages for the same entity only when requested', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const started: number[] = [];

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      resolveEntityKey: () => 'chat:a',
      preserveEntityOrder: true,
      handle: async (payload: { offset: number }) => {
        started.push(payload.offset);
        await (payload.offset === 1
          ? releaseSecond.promise
          : releaseFirst.promise);
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });
    await flushPromises();

    expect(started).toEqual([0]);

    releaseFirst.resolve();
    await flushPromises();

    expect(started).toEqual([0, 1]);

    releaseSecond.resolve();
    await flushPromises();
    await runner.close();
  });

  it('continues an ordered entity after a handler failure', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const started: number[] = [];
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      resolveEntityKey: () => 'chat:acc:chat',
      preserveEntityOrder: true,
      handle: async (payload: { offset: number }) => {
        started.push(payload.offset);
        if (payload.offset === 0) {
          throw new Error('send_failed');
        }
      },
      maxRetries: 1,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });

    await flushPromises(8);

    expect(started).toEqual([0, 1]);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      1
    );

    await runner.close();
  });

  it('commits invalid messages even when parser or invalid hook fails', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: () => {
        throw new Error('parse_failed');
      },
      handle: jest.fn(),
      onInvalidMessage: () => {
        throw new Error('invalid_hook_failed');
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{'),
      partition: 0,
      offset: 0,
    });

    await flushPromises();

    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      0
    );

    await runner.close();
  });

  it('does not block close forever when a task is stuck', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: () => new Promise<void>(() => undefined),
      maxInFlightTotal: 1,
      maxInFlightPerPartition: 1,
      shutdownDrainTimeoutMs: 1,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();

    await expect(runner.close()).resolves.toBeUndefined();
    expect(fakeConsumer.disconnect).toHaveBeenCalled();
  });
});
