import 'reflect-metadata';
import { StreamProducerService } from '@core/services/streamProducer.service';
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

jest.mock('@core/plugins/telemetry/messageLifecycleDebug', () => ({
  buildMessageLifecycleContext: jest.fn(),
  getMessageLifecycleContext: jest.fn(() => null),
  injectKafkaTraceHeaders: jest.fn((headers) => headers),
  isMessageLifecycleDebugEnabled: jest.fn(() => false),
  runWithMessageLifecycleContext: jest.fn((_, fn) => fn()),
}));

describe('StreamProducerService topic recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
