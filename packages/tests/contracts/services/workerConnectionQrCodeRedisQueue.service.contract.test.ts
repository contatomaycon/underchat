import 'reflect-metadata';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('WorkerConnectionQrCodeRedisQueueService', () => {
  it('enqueues runtime generation and request expiry metadata', async () => {
    const redis = {
      xgroup: jest
        .fn(async (..._args: unknown[]) => 'OK')
        .mockRejectedValueOnce(
          new Error('BUSYGROUP Consumer Group name exists')
        )
        .mockRejectedValueOnce(
          new Error('BUSYGROUP Consumer Group name exists')
        ),
      xadd: jest.fn(async (..._args: unknown[]) => '1710000000000-0'),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.enqueue({
        request_id: 'request-1',
        connection_attempt_id: 'attempt-1',
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
    expect(redis.xgroup).toHaveBeenCalledTimes(2);
    expect(redis.xgroup).toHaveBeenNthCalledWith(
      1,
      'CREATE',
      `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      '0',
      'MKSTREAM'
    );
    expect(redis.xgroup).toHaveBeenNthCalledWith(
      2,
      'CREATE',
      `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      '0',
      'MKSTREAM'
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
    for (const workerTypeId of [
      EWorkerType.baileys,
      EWorkerType.wwebjs,
      EWorkerType.whatsmeow,
    ]) {
      expect(redis.xgroup).toHaveBeenCalledWith(
        'CREATE',
        `connection:qrcode:${workerTypeId}:worker-1:requests`,
        `connection:qrcode:${workerTypeId}:worker-1:group`,
        '0',
        'MKSTREAM'
      );
    }
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

  it('repairs a missing consumer group during XREADGROUP without a restart', async () => {
    const streamRedis = {
      status: 'ready',
      xreadgroup: jest
        .fn(async (..._args: unknown[]) => null)
        .mockRejectedValueOnce(
          new Error('NOGROUP No such key or consumer group')
        ),
    };
    const redis = {
      duplicate: jest.fn(() => streamRedis),
      xgroup: jest.fn(async (..._args: unknown[]) => 'OK'),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.readNew('worker-1', EWorkerType.baileys, 'consumer-1')
    ).resolves.toEqual([]);

    expect(streamRedis.xreadgroup).toHaveBeenCalledTimes(2);
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE',
      `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      '0',
      'MKSTREAM'
    );
  });

  it('writes QR cache through an atomic active-attempt compare-and-set', async () => {
    const redis = {
      eval: jest.fn(async (..._args: unknown[]) => 1),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);
    const payload = {
      request_id: 'request-1',
      connection_attempt_id: 'attempt-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 7,
      source: 'manager' as const,
      requested_at: '2026-08-09T12:00:00.000Z',
    };

    await expect(
      service.cacheAttemptStateIfActive(payload, '{"qrcode":"value"}', 90)
    ).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', KEYS[2]"),
      2,
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`,
      `connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`,
      'attempt-1',
      EWorkerType.baileys,
      '7',
      '{"qrcode":"value"}',
      '90'
    );
  });

  it('does not recreate QR cache after the active attempt was invalidated', async () => {
    const redis = {
      eval: jest.fn(async (..._args: unknown[]) => 0),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.cacheAttemptStateIfActive(
        {
          request_id: 'request-1',
          connection_attempt_id: 'removed-attempt',
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          runtime_generation: 8,
          source: 'manager',
          requested_at: '2026-08-09T12:00:00.000Z',
        },
        '{"qrcode":"stale"}',
        90
      )
    ).resolves.toBe(false);
  });

  it('repairs a missing consumer group during XAUTOCLAIM without a restart', async () => {
    const streamRedis = {
      status: 'ready',
      xautoclaim: jest
        .fn(async (..._args: unknown[]) => ['0-0', []])
        .mockRejectedValueOnce(
          new Error('NOGROUP No such key or consumer group')
        ),
    };
    const redis = {
      duplicate: jest.fn(() => streamRedis),
      xgroup: jest.fn(async (..._args: unknown[]) => 'OK'),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.claimPending('worker-1', EWorkerType.wwebjs, 'consumer-1')
    ).resolves.toEqual([]);

    expect(streamRedis.xautoclaim).toHaveBeenCalledTimes(2);
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE',
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:requests`,
      `connection:qrcode:${EWorkerType.wwebjs}:worker-1:group`,
      '0',
      'MKSTREAM'
    );
  });

  it('propagates unexpected Redis cleanup failures after restoring typed groups', async () => {
    const redis = {
      scan: jest.fn(async (..._args: unknown[]) => ['0', [] as string[]]),
      xgroup: jest.fn(async (...args: unknown[]) => {
        if (args[0] === 'DESTROY') {
          return 1;
        }
        return 'OK';
      }),
      del: jest.fn(async (..._args: unknown[]) => {
        throw new Error('READONLY Redis replica cannot delete keys');
      }),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.invalidateWorkerState('worker-1', {
        accountId: 'account-1',
        workerTypeId: EWorkerType.whatsmeow,
        reason: 'connection_removed',
      })
    ).rejects.toThrow(
      'Unable to fully invalidate and recover the QR Redis stream state'
    );

    for (const workerTypeId of [
      EWorkerType.baileys,
      EWorkerType.wwebjs,
      EWorkerType.whatsmeow,
    ]) {
      expect(redis.xgroup).toHaveBeenCalledWith(
        'CREATE',
        `connection:qrcode:${workerTypeId}:worker-1:requests`,
        `connection:qrcode:${workerTypeId}:worker-1:group`,
        '0',
        'MKSTREAM'
      );
    }
  });

  it('only ignores the benign missing-stream error while destroying groups', async () => {
    const redis = {
      scan: jest.fn(async (..._args: unknown[]) => ['0', [] as string[]]),
      xgroup: jest.fn(async (...args: unknown[]) => {
        if (args[0] === 'DESTROY') {
          throw new Error('ERR no such key');
        }
        return 'OK';
      }),
      del: jest.fn(async (..._args: unknown[]) => 0),
    };
    const service = new WorkerConnectionQrCodeRedisQueueService(redis as never);

    await expect(
      service.invalidateWorkerState('worker-1', {
        workerTypeId: EWorkerType.baileys,
        reason: 'connection_removed',
      })
    ).resolves.toMatchObject({
      group_destroy_count: 4,
      group_destroy_timeout_count: 0,
      scan_timeout_count: 0,
      delete_timeout_count: 0,
    });
  });
});
