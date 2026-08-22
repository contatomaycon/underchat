import 'reflect-metadata';
import { container } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { runWithKafkaDispatchGuard } from '@core/common/functions/kafkaDispatchFenceContext';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

describe('StreamProducerService topic recovery', () => {
  afterEach(() => {
    jest.clearAllMocks();
    container.clearInstances();
    container.reset();
  });

  it('reuses the same producer service instance through dependency injection', () => {
    const kafka = {
      createProducer: jest.fn(),
      getBroker: jest.fn(() => 'broker:9092'),
    };

    container.register('Kafka', { useValue: kafka });

    const firstService = container.resolve(StreamProducerService);
    const secondService = container.resolve(StreamProducerService);

    expect(secondService).toBe(firstService);
  });

  it('fails closed instead of recreating a missing durable worker topic', async () => {
    const kafka = {
      createProducer: jest.fn(),
      getBroker: jest.fn(() => 'broker:9092'),
    };
    const service = new StreamProducerService(kafka as never) as any;
    const firstProducer = { id: 'first' };
    const recoveredProducer = { id: 'recovered' };

    jest
      .spyOn(service, 'produceWithQueueFullRetry')
      .mockRejectedValueOnce(new Error('Broker: Unknown topic or partition'));
    const reconnect = jest
      .spyOn(service, 'reconnectProducer')
      .mockResolvedValue(recoveredProducer);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      service.sendWithRetry(
        'worker.w1.send.message',
        Buffer.from('payload'),
        undefined,
        undefined,
        undefined,
        0,
        firstProducer
      )
    ).rejects.toThrow(
      'durable_worker_topic_missing_recovery_disabled:worker.w1.send.message'
    );

    expect(ensureKafkaTopic).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(service.produceWithQueueFullRetry).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      '[worker-kafka-topic-audit]',
      expect.stringContaining('"worker_id":"w1"')
    );
  });

  it('may provision and retry a missing global topic through the provisioner boundary', async () => {
    const kafka = {
      createProducer: jest.fn(),
      getBroker: jest.fn(() => 'broker:9092'),
    };
    const service = new StreamProducerService(kafka as never) as any;
    const firstProducer = { id: 'first' };
    const recoveredProducer = { id: 'recovered' };

    jest
      .spyOn(service, 'produceWithQueueFullRetry')
      .mockRejectedValueOnce(new Error('Broker: Unknown topic or partition'))
      .mockResolvedValueOnce(undefined);
    jest
      .spyOn(service, 'reconnectProducer')
      .mockResolvedValue(recoveredProducer);

    await expect(
      service.sendWithRetry(
        'update.message',
        Buffer.from('payload'),
        undefined,
        undefined,
        undefined,
        0,
        firstProducer
      )
    ).resolves.toBeUndefined();

    expect(ensureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'update.message',
      30,
      3
    );
    expect(service.produceWithQueueFullRetry).toHaveBeenLastCalledWith(
      recoveredProducer,
      'update.message',
      Buffer.from('payload'),
      undefined,
      undefined,
      undefined
    );
  });

  it('captures the Kafka handler guard and drops a record revoked after enqueue', async () => {
    const kafka = {
      createProducer: jest.fn(),
      getBroker: jest.fn(() => 'broker:9092'),
    };
    const service = new StreamProducerService(kafka as never) as any;
    const revoked = new Error('assignment revoked');
    let active = true;
    const assertActive = jest.fn(() => {
      if (!active) throw revoked;
    });
    jest.spyOn(service, 'scheduleFlush').mockImplementation(() => undefined);
    const produce = jest
      .spyOn(service, 'produceWithQueueFullRetry')
      .mockResolvedValue(undefined);

    const pending = runWithKafkaDispatchGuard(assertActive, () =>
      service.send('update.message', { message_id: 'm1' }, 'a1:w1:m1')
    );
    await Promise.resolve();
    expect(service.sendQueue).toHaveLength(1);

    active = false;
    await service.runFlushLoop();

    await expect(pending).rejects.toBe(revoked);
    expect(produce).not.toHaveBeenCalled();
    expect(service.sendQueue).toHaveLength(0);
  });

  it('does not reconnect or retry a guarded record revoked after a failed attempt', async () => {
    const kafka = {
      createProducer: jest.fn(),
      getBroker: jest.fn(() => 'broker:9092'),
    };
    const service = new StreamProducerService(kafka as never) as any;
    const firstProducer = { id: 'first' };
    const revoked = new Error('assignment revoked');
    let active = true;
    const assertActive = jest.fn(() => {
      if (!active) throw revoked;
    });
    jest
      .spyOn(service, 'produceWithQueueFullRetry')
      .mockImplementationOnce(async () => {
        active = false;
        throw new Error('Broker: Unknown topic or partition');
      });
    const reconnect = jest.spyOn(service, 'reconnectProducer');

    await expect(
      service.sendWithRetry(
        'update.message',
        Buffer.from('payload'),
        undefined,
        undefined,
        assertActive,
        0,
        firstProducer
      )
    ).rejects.toBe(revoked);

    expect(reconnect).not.toHaveBeenCalled();
    expect(service.produceWithQueueFullRetry).toHaveBeenCalledTimes(1);
  });
});
