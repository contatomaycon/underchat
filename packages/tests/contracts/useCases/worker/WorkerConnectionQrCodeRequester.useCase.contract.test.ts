import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid-mock') }));

import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';

const t = ((key: string) => {
  const messages: Record<string, string> = {
    worker_not_found: 'Worker not found!',
    worker_qrcode_not_ready: 'Worker not ready!',
    worker_type_invalid: 'Worker type invalid!',
  };
  return messages[key] ?? key;
}) as never;

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _ex?: string,
        _ttl?: number,
        nx?: string
      ) => {
        if (nx === 'NX' && store.has(key)) {
          return null;
        }
        store.set(key, value);
        return 'OK';
      }
    ),
    del: jest.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  };
}

function makeUseCase(
  overrides: {
    workerStatusId?: EWorkerStatus;
    workerTypeId?: EWorkerType | string;
    redisInitial?: Record<string, string>;
    enqueueError?: Error;
    runtimeGeneration?: number;
  } = {}
) {
  const workerTypeId = overrides.workerTypeId ?? EWorkerType.baileys;
  const workerStatusId = overrides.workerStatusId ?? EWorkerStatus.disponible;
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Worker',
      number: null,
      status: {
        id: workerStatusId,
        name: 'Disponivel',
      },
      type: { id: workerTypeId, name: 'Type' },
      server: { id: 'server-1', name: 'Server' },
      connection_date: null,
      created_at: null,
      updated_at: null,
    })),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
  };
  const redis = makeRedis(overrides.redisInitial);
  const workerRuntimeRepository = overrides.runtimeGeneration
    ? {
        viewByWorkerId: jest.fn(async () => ({
          worker_id: 'worker-1',
          session_volume_name: 'worker-1',
          runtime_generation: overrides.runtimeGeneration,
        })),
      }
    : undefined;
  const redisQueueService = {
    streamKey: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:requests`;
    }),
    consumerGroup: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:group`;
    }),
    enqueue: jest.fn(async (_payload: IWorkerConnectionQrCodeQueueMessage) => {
      if (overrides.enqueueError) {
        throw overrides.enqueueError;
      }
      return '1710000000000-0';
    }),
  };

  const useCase = new WorkerConnectionQrCodeRequesterUseCase(
    workerService as never,
    centrifugoService as never,
    redis as never,
    redisQueueService as never,
    workerRuntimeRepository as never
  );

  return {
    useCase,
    workerService,
    centrifugoService,
    redis,
    redisQueueService,
    workerRuntimeRepository,
  };
}

describe('WorkerConnectionQrCodeRequesterUseCase', () => {
  beforeEach(() => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'false';
  });

  it('enqueues a QR request in Redis Streams and publishes pending state', async () => {
    const deps = makeUseCase();

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'uuid-mock',
      connection_lifecycle_id: expect.any(String),
      qr_pending: true,
      reason: 'queued',
    });
    expect(response.qrcode).toBeUndefined();
    expect(response.pairing_code).toBeUndefined();

    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'uuid-mock',
        connection_attempt_id: response.connection_attempt_id,
        connection_lifecycle_id: response.connection_lifecycle_id,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        source: 'manager',
        requested_at: expect.any(String),
      })
    );
    expect(deps.redis.set).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`,
      expect.stringContaining(
        `"stream_key":"connection:qrcode:${EWorkerType.baileys}:worker-1:requests"`
      ),
      'EX',
      expect.any(Number),
      'NX'
    );
    expect(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toContain('"stream_id":"1710000000000-0"');
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      response
    );
  });

  it('enqueues while worker is still creating because Redis Streams is durable', async () => {
    const deps = makeUseCase({ workerStatusId: EWorkerStatus.creating });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      worker_status_id: EWorkerStatus.creating,
      qr_pending: true,
      reason: 'queued',
    });
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('includes runtime generation in the pending response, active attempt and stream payload', async () => {
    const deps = makeUseCase({ runtimeGeneration: 3 });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.runtime_generation).toBe(3);
    expect(deps.workerRuntimeRepository?.viewByWorkerId).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        expires_at: expect.any(String),
      })
    );

    const activeAttempt = JSON.parse(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      ) ?? '{}'
    );
    expect(activeAttempt).toMatchObject({
      runtime_generation: 3,
      ack: expect.objectContaining({
        runtime_generation: 3,
      }),
    });
  });

  it('does not enqueue when worker status cannot request QR', async () => {
    const deps = makeUseCase({ workerStatusId: EWorkerStatus.offline });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('returns an active attempt without duplicating the Redis stream message', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
        connection_attempt_id: 'attempt-1',
        connection_lifecycle_id: 'lifecycle-1',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      ...activeAttempt.ack,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        connection_attempt_id: 'attempt-1',
        qr_pending: true,
      })
    );
  });

  it('returns a cached QR code without duplicating the Redis stream message', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-cached',
      connection_lifecycle_id: 'lifecycle-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
      reason: 'cached_qr_available',
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`]:
          JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-cached',
      connection_lifecycle_id: 'lifecycle-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_pending: false,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        qrcode: 'data:image/png;base64,cached',
        qr_pending: false,
      })
    );
  });

  it('does not reuse cached QR from a previous worker type', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-baileys-cache',
      connection_lifecycle_id: 'lifecycle-baileys-cache',
      qrcode: 'data:image/png;base64,baileys',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`]:
          JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.qrcode).toBeUndefined();
    expect(response.worker_type_id).toBe(EWorkerType.wwebjs);
    expect(response.connection_attempt_id).not.toBe('attempt-baileys-cache');
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an already processed active QR attempt', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-processed',
        connection_lifecycle_id: 'lifecycle-processed',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:processed:attempt-processed`]:
          '1',
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).not.toBe('attempt-processed');
    expect(deps.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
    );
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an old pending active QR attempt without a QR', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-old',
        connection_lifecycle_id: 'lifecycle-old',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date(Date.now() - 121_000).toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).not.toBe('attempt-old');
    expect(deps.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
    );
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('clears active attempt when Redis Stream enqueue fails', async () => {
    const deps = makeUseCase({
      enqueueError: new Error('xadd failed'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('xadd failed');

    expect(deps.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
    );
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
