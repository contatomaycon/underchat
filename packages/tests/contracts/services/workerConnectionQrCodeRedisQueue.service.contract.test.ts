import 'reflect-metadata';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('WorkerConnectionQrCodeRedisQueueService', () => {
  it('reads QR stream messages through a dedicated Redis duplicate', async () => {
    const streamRedis = {
      status: 'ready',
      xreadgroup: jest.fn(async () => null),
    };
    const redis = {
      duplicate: jest.fn(() => streamRedis),
      xreadgroup: jest.fn(),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.readNew('worker-1', EWorkerType.baileys, 'consumer-1')
    ).resolves.toEqual([]);

    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(redis.xreadgroup).not.toHaveBeenCalled();
    expect(streamRedis.xreadgroup).toHaveBeenCalledWith(
      'GROUP',
      `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      'consumer-1',
      'COUNT',
      WorkerConnectionQrCodeRedisQueueService.READ_COUNT,
      'BLOCK',
      WorkerConnectionQrCodeRedisQueueService.READ_BLOCK_MS,
      'STREAMS',
      `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      '>'
    );
  });
});
