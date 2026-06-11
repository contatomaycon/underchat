import 'reflect-metadata';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('WorkerConnectionQrCodeRedisQueueService', () => {
  it('enqueues runtime generation and request expiry metadata', async () => {
    const redis = {
      xadd: jest.fn(async (..._args: unknown[]) => '1710000000000-0'),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.enqueue({
        request_id: 'request-1',
        connection_attempt_id: 'attempt-1',
        connection_lifecycle_id: 'lifecycle-1',
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 7,
        source: 'manager',
        requested_at: '2026-06-11T10:00:00.000Z',
        expires_at: '2026-06-11T10:01:35.000Z',
      })
    ).resolves.toBe('1710000000000-0');

    expect(redis.xadd.mock.calls[0]).toEqual(
      expect.arrayContaining([
        `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
        'runtime_generation',
        7,
        'expires_at',
        '2026-06-11T10:01:35.000Z',
      ])
    );
  });

  it('invalidates legacy and typed QR state for every QR runtime', async () => {
    const redis = {
      scan: jest
        .fn(async (..._args: unknown[]) => ['0', [] as string[]])
        .mockResolvedValueOnce([
          '0',
          [`connection:qrcode:${EWorkerType.wwebjs}:worker-1:processed:old`],
        ])
        .mockResolvedValueOnce([
          '0',
          ['connection:qrcode:worker-1:processed:legacy'],
        ]),
      xgroup: jest.fn(async (..._args: unknown[]) => 1),
      del: jest.fn(async (..._args: unknown[]) => 14),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    const result = await service.invalidateWorkerState('worker-1', {
      accountId: 'account-1',
      workerTypeId: EWorkerType.wwebjs,
      previousWorkerTypeId: EWorkerType.baileys,
      reason: 'type_changed',
      source: 'test',
    });

    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'connection:qrcode:*:worker-1:processed:*',
      'COUNT',
      WorkerConnectionQrCodeRedisQueueService.INVALIDATE_SCAN_COUNT
    );
    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'connection:qrcode:worker-1:processed:*',
      'COUNT',
      WorkerConnectionQrCodeRedisQueueService.INVALIDATE_SCAN_COUNT
    );
    expect(redis.xgroup).toHaveBeenCalledWith(
      'DESTROY',
      'connection:qrcode:worker-1:requests',
      'connection:qrcode:worker-1:group'
    );
    expect(redis.xgroup).toHaveBeenCalledWith(
      'DESTROY',
      `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:requests`,
      `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:group`
    );
    expect(redis.del.mock.calls[0]).toEqual(
      expect.arrayContaining([
        'connection:qrcode:worker-1:attempt',
        'connection:qrcode:worker-1:active_attempt',
        'connection:qrcode:worker-1:requests',
        `connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`,
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`,
        `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`,
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:active_attempt`,
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:requests`,
        `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:attempt`,
        `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:active_attempt`,
        `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:requests`,
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:processed:old`,
        'connection:qrcode:worker-1:processed:legacy',
      ])
    );
    expect(result).toMatchObject({
      deleted_keys: 14,
      scanned_processed_keys: 2,
    });
  });

  it('uses Redis UNLINK for QR state invalidation when available', async () => {
    const redis = {
      scan: jest.fn(async (..._args: unknown[]) => ['0', [] as string[]]),
      xgroup: jest.fn(async (..._args: unknown[]) => 1),
      unlink: jest.fn(async (..._args: unknown[]) => 12),
      del: jest.fn(async (..._args: unknown[]) => 12),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.invalidateWorkerState('worker-1', {
        accountId: 'account-1',
        workerTypeId: EWorkerType.wwebjs,
        reason: 'recreate_requested',
      })
    ).resolves.toMatchObject({
      deleted_keys: 12,
      scanned_processed_keys: 0,
    });

    expect(redis.unlink.mock.calls[0]).toEqual(
      expect.arrayContaining([
        'connection:qrcode:worker-1:requests',
        `connection:qrcode:${EWorkerType.wwebjs}:worker-1:requests`,
      ])
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('reads QR stream messages through a dedicated Redis duplicate', async () => {
    const streamRedis = {
      status: 'ready',
      xreadgroup: jest.fn(async (..._args: unknown[]) => null),
    };
    const redis = {
      duplicate: jest.fn(() => streamRedis),
      xreadgroup: jest.fn((..._args: unknown[]) => undefined),
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
