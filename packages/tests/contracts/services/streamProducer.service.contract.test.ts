import 'reflect-metadata';
import { container } from 'tsyringe';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

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

  it('ensures worker topic and retries once when produce fails with unknown topic', async () => {
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
        'worker.w1.send.message',
        Buffer.from('payload'),
        undefined,
        undefined,
        0,
        firstProducer
      )
    ).resolves.toBeUndefined();

    expect(ensureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'worker.w1.send.message',
      1,
      2
    );
    expect(service.produceWithQueueFullRetry).toHaveBeenCalledTimes(2);
    expect(service.produceWithQueueFullRetry).toHaveBeenLastCalledWith(
      recoveredProducer,
      'worker.w1.send.message',
      Buffer.from('payload'),
      undefined,
      undefined
    );
  });
});
